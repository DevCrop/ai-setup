#!/usr/bin/env bash
# PreToolUse hook (Bash): block git add/stage/commit/push (and update-index, mv, apply --index, am) when a secret-looking file would be
# staged, committed or pushed. Blocks with exit 2 + stderr (https://code.claude.com/docs/en/hooks).
# Fail-closed: when a command that could stage files cannot be judged (jq or git missing, unreadable hook input) it is blocked with exit 2.
# Commands without a git word are never touched. settings.json gives this hook "onFailure": "block" and a 30 s timeout, so a crash or a
# timeout blocks the call too (a huge repo can make `git status`-like calls slow).
# Limit: it reads the command string. Not seen: aliases, scripts that call git, git itself held in a variable, brace expansion, eval, a path
# with a space given as one quoted argument, an apply/am patch that adds a secret name when the work tree has none. A variable, $() or
# xargs/find -exec as an argument of add/stage/update-index/apply/am/mv is read as "everything pending" (judged like git add -A).
input="$(cat)"
# Cheap gate on the raw input: JSON escapes for newline, return and tab become spaces first (else "\ngit" reads as "ngit"), then quotes and
# backslashes are removed (g''it and g\it are git). No git word, nothing to check.
gate="$(printf '%s' "$input" | sed 's/\\[nrt]/ /g' | tr -d "\"'\\\\")"
# $'...' (ANSI-C quoting, $'\x67it') can hide the word, so it also passes the gate and is decoded below.
printf '%s' "$gate" | grep -Eq '(^|[^[:alnum:]_])git([^[:alnum:]_-]|$)' || printf '%s' "$input" | grep -Fq "\$'" || exit 0
verbs='add|stage|commit|push|update-index|mv|apply|am'
block_unjudgeable() { # reason: block only when the input mentions a staging verb, otherwise let it through
  if printf '%s' "$gate" | grep -Eq "(^|[^[:alnum:]_])($verbs)([^[:alnum:]_-]|\$)" || printf '%s' "$input" | grep -Fq "\$'"; then
    echo "secret-guard: blocked, $1, so this git command cannot be checked for secret files. Install it or fix the hook input." >&2
    exit 2
  fi
  exit 0
}
command -v jq >/dev/null 2>&1 || block_unjudgeable "jq not found"
command -v git >/dev/null 2>&1 || block_unjudgeable "git not found"
cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)" || block_unjudgeable "unreadable hook input"
cmd="$(printf '%s' "$cmd" | tr -d '\r')"
# Decode $'...' (\xHH, octal) so $'\x67it' reads as git. Escaped quotes inside are not handled.
while [[ "$cmd" == *"\$'"* ]]; do
  pre="${cmd%%\$\'*}"; rest="${cmd#*\$\'}"; body="${rest%%\'*}"
  [ "$rest" = "$body" ] && post="" || post="${rest#*\'}"
  body="$(printf '%s' "$body" | sed -E 's/\\([0-7]{3})/\\0\1/g')"
  printf -v dec '%b' "$body"
  cmd="$pre$dec$post"
done
cwd="$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null | tr -d '\r')"
[ -n "$cmd" ] || exit 0

# Fast path: no git word next to a staging verb means nothing to check.
flat="$(printf '%s' "$cmd" | tr -d "\"'\\\\")"
printf '%s' "$flat" | grep -Eq '(^|[^[:alnum:]_.-])git([^[:alnum:]_-]|$)' && printf '%s' "$flat" | grep -Eq "($verbs)" || exit 0

is_secret() {
  case "$1" in .aws/credentials|*/.aws/credentials) return 0 ;; esac  # the file is just called "credentials": judge it by its directory
  b="$(basename "$1" | tr '[:upper:]' '[:lower:]')"
  case "$b" in
    *.example|*.sample|*.template|id_rsa*.pub|id_ed25519*.pub|id_ecdsa*.pub|id_dsa*.pub) return 1 ;;
    .credentials*|.env|.env.*|.claude.json|history.jsonl|*.pem|*.pem.*|id_rsa*|id_ed25519*|id_ecdsa*|id_dsa*) return 0 ;;
    *.key|*.p12|*.pfx|*.jks|*.keystore|credentials.json|*credentials*.json|.npmrc|.netrc|.pypirc|.pgpass|.htpasswd|.git-credentials|*.tfstate|secrets.yaml|secrets.yml) return 0 ;;
  esac
  return 1
}
hits=""
# Reads NUL-separated paths from stdin (git ... -z), so spaces, quotes and non-ASCII names are not mangled.
judge() { while IFS= read -r -d '' f; do [ -n "$f" ] && is_secret "$f" && hits="$hits $f"; done; }
# g runs git in the directory the command would use, with its --git-dir/--work-tree options and GIT_DIR/GIT_WORK_TREE prefixes.
g() { env "${genv[@]}" git -C "$dir" "${gitopts[@]}" "$@"; }
pending() { g ls-files -z --modified --others --exclude-standard 2>/dev/null; }
absdir() { (cd "$1" 2>/dev/null && cd "$2" 2>/dev/null && pwd); }

set -f
cur="${cwd:-.}"
# Backslash-newline joins lines; quotes and backslashes are deleted (g''it and g\it are git, "bash -c 'git add -A'" is seen); $ and
# backticks become the marker __EXP__ (an expansion we cannot evaluate), parens become spaces ($(git add -A) is seen); ; | & split segments.
segs="$(printf '%s\n' "$cmd" | sed -e ':a' -e '/\\$/N;s/\\\n/ /;ta' | tr -d "\"'\\\\" | sed -e 's/[$`]{[^}]*}/ __EXP__ /g' -e 's/[$`]/ __EXP__ /g' | tr '()' '  ' | tr ';|&' '\n\n\n')"
while IFS= read -r seg; do
  # xargs and find -exec feed git paths we cannot see: treat an add through them as "everything pending".
  case " $seg " in *" xargs "*|*" -exec "*|*" -execdir "*) viaxargs=1 ;; *) viaxargs=0 ;; esac
  # shellcheck disable=SC2086
  set -- $seg
  [ "$#" -gt 0 ] || continue
  if [ "$1" = cd ] && [ -n "${2:-}" ]; then d="${2/#\~/$HOME}"; n="$(absdir "$cur" "$d")"; [ -n "$n" ] && cur="$n"; continue; fi
  genv=()
  while [ "$#" -gt 0 ] && [ "${1##*/}" != git ]; do
    case "$1" in GIT_DIR=*|GIT_WORK_TREE=*) genv+=("$1") ;; esac
    shift
  done
  [ "$#" -gt 0 ] || continue
  shift; dir="$cur"; gitopts=(); expverb=0
  while [ "$#" -gt 0 ]; do
    case "$1" in
      __EXP__) # an expansion where an option or the verb belongs (git${IFS}add, -C "$PWD" add): take the next staging verb, judge as add -A
        shift
        while [ "$#" -gt 0 ]; do case "$1" in add|stage|commit|push|update-index|mv|apply|am) break ;; esac; shift; done
        expverb=1; break ;;
      -C) if [ "${2:-}" = __EXP__ ]; then shift; continue; fi
          d="${2/#\~/$HOME}"; n="$(absdir "$dir" "$d")"; [ -n "$n" ] && dir="$n"; shift 2 || shift ;;
      -c) shift 2 || shift ;;
      --git-dir=*|--work-tree=*) gitopts+=("$1"); shift ;;
      --git-dir|--work-tree) gitopts+=("$1" "${2:-}"); shift 2 || shift ;;
      -*) shift ;;
      *) break ;;
    esac
  done
  verb="${1:-}"; [ "$#" -gt 0 ] && shift
  case "$verb" in add|stage|commit|push|update-index|mv|apply|am) ;; *) continue ;; esac
  g rev-parse --git-dir >/dev/null 2>&1 || continue
  broad=0; paths=""; dd=0; [ "$expverb" = 1 ] && broad=1
  for t in "$@"; do
    # commit: words before -- are message text, not paths (staged files are judged from git instead)
    [ "$verb" = commit ] && [ "$dd" = 0 ] && case "$t" in --) dd=1; continue ;; -*) ;; *) broad=1; continue ;; esac
    case "$t" in
      --all|--update|--force|--pathspec-from-file*) broad=1 ;;
      -*) case "$verb" in
            add|stage) printf '%s' "$t" | grep -Eq '^-[a-zA-Z]*[Aufp][a-zA-Z]*$' && broad=1 ;;
            commit) printf '%s' "$t" | grep -Eq '^-[a-zA-Z]*a[a-zA-Z]*$' && broad=1 ;;
            update-index) case "$t" in --stdin|--index-info|--cacheinfo) broad=1 ;; esac ;;
            apply) case "$t" in --index|--cached|-3|--3way) broad=1 ;; esac ;;
          esac ;;
      .|./|:/|:/*|*[\*\?\[]*) broad=1 ;;
      __EXP__) case "$verb" in add|stage|update-index|apply|am|mv) broad=1 ;; esac ;;
      *) paths="$paths $t"; [ -d "$dir/$t" ] && broad=1 ;;
    esac
  done
  [ "$verb" = am ] && broad=1
  case "$verb" in add|stage|update-index|apply|am) [ "$viaxargs" = 1 ] && broad=1 ;; esac
  for t in $paths; do is_secret "$t" && hits="$hits $t"; done
  case "$verb" in
    add|stage|update-index|apply|am) [ "$broad" = 1 ] && judge < <(pending "$dir") ;;
    commit)
      judge < <(g diff --cached --name-only -z 2>/dev/null)
      [ "$broad" = 1 ] && judge < <(g diff --name-only -z 2>/dev/null) ;;
    push) # outgoing changes only; without an upstream, all tracked files
      if g rev-parse '@{u}' >/dev/null 2>&1; then
        judge < <(g diff --name-only -z '@{u}...HEAD' 2>/dev/null)
      else
        judge < <(g ls-files -z 2>/dev/null)
      fi ;;
  esac
done <<< "$segs"

if [ -n "$hits" ]; then
  echo "secret-guard: blocked. Secret-looking files would be included:$hits" >&2
  echo "Remove them from the change or add them to .gitignore, then retry. *.example, *.sample, *.template are allowed." >&2
  exit 2
fi
exit 0
