#!/usr/bin/env bash
# PreToolUse hook (Bash): block git add/stage/commit/push (and update-index, mv, apply --index, am) when a secret-looking file would be
# staged, committed or pushed. Blocks with exit 2 + stderr (https://code.claude.com/docs/en/hooks).
# Fail-closed: when a command that could stage files cannot be judged (jq or git missing, unreadable hook input) it is blocked with exit 2.
# Commands without a git word are never touched. settings.json gives this hook "onFailure": "block" and a 30 s timeout, so a crash or a
# timeout blocks the call too (a huge repo can make `git status`-like calls slow).
# Limit: it reads the command string. Not seen: aliases, scripts that call git, variables, paths with spaces given as one quoted argument,
# brace expansion, eval, an apply/am patch that adds a secret name when the work tree has none.
input="$(cat)"
# Cheap gate on the raw input: JSON escapes for newline, return and tab become spaces first (else "\ngit" reads as "ngit"), then quotes and
# backslashes are removed (g''it and g\it are git). No git word, nothing to check.
gate="$(printf '%s' "$input" | sed 's/\\[nrt]/ /g' | tr -d "\"'\\\\")"
printf '%s' "$gate" | grep -Eq '(^|[^[:alnum:]_])git([^[:alnum:]_-]|$)' || exit 0
verbs='add|stage|commit|push|update-index|mv|apply|am'
block_unjudgeable() { # reason: block only when the input mentions a staging verb, otherwise let it through
  if printf '%s' "$gate" | grep -Eq "(^|[^[:alnum:]_])($verbs)([^[:alnum:]_-]|\$)"; then
    echo "secret-guard: blocked, $1, so this git command cannot be checked for secret files. Install it or fix the hook input." >&2
    exit 2
  fi
  exit 0
}
command -v jq >/dev/null 2>&1 || block_unjudgeable "jq not found"
command -v git >/dev/null 2>&1 || block_unjudgeable "git not found"
cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)" || block_unjudgeable "unreadable hook input"
cmd="$(printf '%s' "$cmd" | tr -d '\r')"
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
pending() { git -C "$1" ls-files -z --modified --others --exclude-standard 2>/dev/null; }
absdir() { (cd "$1" 2>/dev/null && cd "$2" 2>/dev/null && pwd); }

set -f
cur="${cwd:-.}"
# Backslash-newline joins lines; quotes and backslashes are deleted (g''it and g\it are git, "bash -c 'git add -A'" is seen); $ and
# backticks become the marker __EXP__ (an expansion we cannot evaluate), parens become spaces ($(git add -A) is seen); ; | & split segments.
segs="$(printf '%s\n' "$cmd" | sed -e ':a' -e '/\\$/N;s/\\\n/ /;ta' | tr -d "\"'\\\\" | sed -e 's/[$`]/ __EXP__ /g' | tr '()' '  ' | tr ';|&' '\n\n\n')"
while IFS= read -r seg; do
  # xargs and find -exec feed git paths we cannot see: treat an add through them as "everything pending".
  case " $seg " in *" xargs "*|*" -exec "*|*" -execdir "*) viaxargs=1 ;; *) viaxargs=0 ;; esac
  # shellcheck disable=SC2086
  set -- $seg
  [ "$#" -gt 0 ] || continue
  if [ "$1" = cd ] && [ -n "${2:-}" ]; then d="${2/#\~/$HOME}"; n="$(absdir "$cur" "$d")"; [ -n "$n" ] && cur="$n"; continue; fi
  while [ "$#" -gt 0 ] && [ "${1##*/}" != git ]; do shift; done
  [ "$#" -gt 0 ] || continue
  shift; dir="$cur"
  while [ "$#" -gt 0 ]; do
    case "$1" in
      -C) d="${2/#\~/$HOME}"; n="$(absdir "$dir" "$d")"; [ -n "$n" ] && dir="$n"; shift 2 || shift ;;
      -c) shift 2 || shift ;;
      -*) shift ;;
      *) break ;;
    esac
  done
  verb="${1:-}"; [ "$#" -gt 0 ] && shift
  case "$verb" in add|stage|commit|push|update-index|mv|apply|am) ;; *) continue ;; esac
  git -C "$dir" rev-parse --git-dir >/dev/null 2>&1 || continue
  broad=0; paths=""; dd=0
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
      judge < <(git -C "$dir" diff --cached --name-only -z 2>/dev/null)
      [ "$broad" = 1 ] && judge < <(git -C "$dir" diff --name-only -z 2>/dev/null) ;;
    push) # outgoing changes only; without an upstream, all tracked files
      if git -C "$dir" rev-parse '@{u}' >/dev/null 2>&1; then
        judge < <(git -C "$dir" diff --name-only -z '@{u}...HEAD' 2>/dev/null)
      else
        judge < <(git -C "$dir" ls-files -z 2>/dev/null)
      fi ;;
  esac
done <<< "$segs"

if [ -n "$hits" ]; then
  echo "secret-guard: blocked. Secret-looking files would be included:$hits" >&2
  echo "Remove them from the change or add them to .gitignore, then retry. *.example, *.sample, *.template are allowed." >&2
  exit 2
fi
exit 0
