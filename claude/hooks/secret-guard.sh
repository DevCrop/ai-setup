#!/usr/bin/env bash
# PreToolUse hook (Bash, and GitHub MCP file writes): block git add/stage/commit/push (and update-index, mv, apply --index, am) when a secret-looking file would be
# staged, committed or pushed. Blocks with exit 2 + stderr (https://code.claude.com/docs/en/hooks).
# Fail-closed: when a command that could stage files cannot be judged (jq or git missing, unreadable hook input) it is blocked with exit 2.
# Commands without a git word are never touched. settings.json gives this hook "onFailure": "block" and a 30 s timeout, so a crash or a
# timeout blocks the call too (a huge repo can make `git status`-like calls slow).
# Limit: it reads the command string. Not seen: aliases, scripts that call git, git itself or the staging verb held only in a variable (git $v -A), brace expansion, eval, a path
# with a space given as one quoted argument, an apply/am patch that adds a secret name when the work tree has none. A variable, $() or
# xargs/find -exec as an argument of add/stage/update-index/apply/am/mv is read as "everything pending" (judged like git add -A).
input="$(cat)"
is_secret() {
  case "$1" in .aws/credentials|*/.aws/credentials) return 0 ;; esac  # the file is just called "credentials": judge it by its directory
  # pure bash, no process per file: a broad add can list tens of thousands of paths inside the 30 s hook timeout
  b="${1%/}"; b="${b##*/}"
  shopt -s nocasematch
  case "$b" in
    *.example|*.sample|*.template|id_rsa*.pub|id_ed25519*.pub|id_ecdsa*.pub|id_dsa*.pub) shopt -u nocasematch; return 1 ;;
    .credentials*|.env|.env.*|.claude.json|history.jsonl|*.pem|*.pem.*|id_rsa*|id_ed25519*|id_ecdsa*|id_dsa*) shopt -u nocasematch; return 0 ;;
    *.key|*.p12|*.pfx|*.jks|*.keystore|credentials.json|*credentials*.json|.npmrc|.netrc|.pypirc|.pgpass|.htpasswd|.git-credentials|*.tfstate|secrets.yaml|secrets.yml) shopt -u nocasematch; return 0 ;;
  esac
  shopt -u nocasematch
  return 1
}
# GitHub MCP file writes (push_files, create_or_update_file; matcher in settings.json): judge the paths they carry. A commit made this way
# never passes through git on this machine, so the Bash checks below cannot see it.
mcpre='^mcp__.*github.*__(push_files|create_or_update_file)$'
# The branch is chosen from the decoded tool_name (an escaped name or an extra key in a Bash call cannot switch it); grep on the raw
# input only decides when jq is missing or the input is not JSON, and that case blocks below.
# tn is the name only for one JSON object with a string tool_name; any other shape is a non-empty marker that matches nothing
tn=""; jqok=0
# no pipe after jq: the assignment's status must be jq's, so a failed parse leaves jqok=0
if command -v jq >/dev/null 2>&1 && tn="$(printf '%s' "$input" | jq -r 'if type == "object" and (.tool_name | type) == "string" then .tool_name else "(bad-shape)" end' 2>/dev/null)"; then jqok=1; fi
tn="${tn//$'\r'/}"
# an odd shape (no jq, not JSON, a non-string name, several objects) that still names a GitHub write is judged as one
odd=0; { [ "$jqok" = 0 ] || [ "$tn" = "(bad-shape)" ] || [[ "$tn" == *$'\n'* ]]; } && odd=1
if [[ "$tn" =~ $mcpre ]] || { [ "$odd" = 1 ] && printf '%s' "$input" | grep -Eq 'mcp__[^"]*github[^"]*__(push_files|create_or_update_file)'; }; then
  command -v jq >/dev/null 2>&1 || { echo "secret-guard: blocked, jq not found, so this GitHub file write cannot be checked for secret files." >&2; exit 2; }
  # every path, also from nested arrays; a path that is not a string cannot be judged and blocks
  mpaths="$(printf '%s' "$input" | jq -r '
    ([.tool_input.files] | flatten | map(select(. != null)) | if all(type == "object") then map(.path) else error("non-object file") end) + [.tool_input.path]
    | map(select(. != null)) | if all(type == "string") then .[] else error("non-string path") end' 2>/dev/null)" \
    || { echo "secret-guard: blocked, unreadable hook input for a GitHub file write." >&2; exit 2; }
  mhits=""
  while IFS= read -r f; do [ -n "$f" ] && is_secret "$f" && mhits="$mhits $f"; done <<< "$(printf '%s' "$mpaths" | tr -d '\r')"
  if [ -n "$mhits" ]; then
    echo "secret-guard: blocked. This GitHub write would commit secret-looking files:$mhits" >&2
    echo "Leave them out of the write. *.example, *.sample, *.template are allowed." >&2
    exit 2
  fi
  [ "$odd" = 1 ] || exit 0  # an odd shape may also carry a Bash command: the checks below still run
fi
# Cheap gate on the raw input: JSON escapes for newline, return and tab become spaces first (else "\ngit" reads as "ngit"), then quotes and
# backslashes are removed (g''it and g\it are git). No git word, nothing to check. The word is matched in any case: a case-insensitive file
# system (Windows) runs GIT or Git.exe as git.
gate="$(printf '%s' "$input" | sed 's/\\[nrt]/ /g' | tr -d "\"'\\\\")"
# $'...' (ANSI-C quoting, $'\x67it') can hide the word, so it also passes the gate and is decoded below.
gitword='(^|[^[:alnum:]_])git([^[:alnum:]_-]|$)'
# A Windows backslash path (C:\Git\cmd\git.exe) is also read with backslashes as separators, since deleting them glues the words.
printf '%s' "$gate" | grep -Eiq "$gitword" || printf '%s' "$input" | tr '\\' ' ' | grep -Eiq "$gitword" || printf '%s' "$input" | grep -Fq "\$'" || exit 0
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
{ printf '%s' "$flat" | grep -Eiq '(^|[^[:alnum:]_.-])git([^[:alnum:]_-]|$)' || printf '%s' "$cmd" | tr '\\' ' ' | grep -Eiq "$gitword"; } \
  && printf '%s' "$flat" | grep -Eq "($verbs)" || exit 0

hits=""
# Reads NUL-separated paths from stdin (git ... -z), so spaces, quotes and non-ASCII names are not mangled.
judge() { while IFS= read -r -d '' f; do [ -n "$f" ] && is_secret "$f" && hits="$hits $f"; done; }
# g runs git in the directory the command would use, with its --git-dir/--work-tree options and GIT_DIR/GIT_WORK_TREE prefixes.
g() { env "${genv[@]}" git -C "$dir" "${gitopts[@]}" "$@"; }
# "$@" may be ':/' (the whole tree): add -A/-u/--all with no narrower pathspec stages files above a subdirectory too
pending() { shift; g ls-files -z --modified --others --exclude-standard "$@" 2>/dev/null; }  # $1 is the directory (g already uses $dir)
absdir() { (cd "$1" 2>/dev/null && cd "$2" 2>/dev/null && pwd); }
# Untracked files of a directory that is not a repo yet (git init in the same command), with its .gitignore applied: a throwaway bare
# git dir lends git's own listing. If even that fails, the add cannot be judged and is blocked.
tg=""; trap '[ -n "$tg" ] && rm -rf "$tg"' EXIT  # a timeout kill still removes the throwaway git dir
untracked_norepo() { # prints one path per line; fails when the listing cannot be made
  tg="$(mktemp -d 2>/dev/null)" && git init -q --bare "$tg" 2>/dev/null \
    && out="$(git --git-dir="$tg" --work-tree="$1" ls-files -z -o --exclude-standard 2>/dev/null | tr '\0' '\n'; exit "${PIPESTATUS[0]}")"
  rc=$?
  [ -n "$tg" ] && [ -d "$tg" ] && rm -rf "$tg"; tg=""
  [ "$rc" = 0 ] && printf '%s\n' "$out"
  return "$rc"
}

set -f
cur="${cwd:-.}"; lost=0
# Backslash-newline joins lines; quotes and backslashes are deleted (g''it and g\it are git, "bash -c 'git add -A'" is seen); $ and
# backticks become the marker __EXP__ (an expansion we cannot evaluate), parens become spaces ($(git add -A) is seen); ; | & split segments.
# A backslash right before git becomes a slash first, so C:\Git\cmd\git.exe keeps git.exe as its last path part.
segs="$(printf '%s\n' "$cmd" | sed -e ':a' -e '/\\$/N;s/\\\n/ /;ta' | sed 's/\\\([Gg][Ii][Tt]\)/\/\1/g' | tr -d "\"'\\\\" | sed -e 's/[$`]{[^}]*}/ __EXP__ /g' -e 's/[$`]/ __EXP__ /g' | tr '()' '  ' | tr ';|&' '\n\n\n')"
while IFS= read -r seg; do
  # xargs and find -exec feed git paths we cannot see: treat an add through them as "everything pending".
  case " $seg " in *" xargs "*|*" -exec "*|*" -execdir "*) viaxargs=1 ;; *) viaxargs=0 ;; esac
  # shellcheck disable=SC2086
  set -- $seg
  [ "$#" -gt 0 ] || continue
  [ "$1" = builtin ] && shift && [ "$#" -gt 0 ] || [ "$#" -gt 0 ] || continue
  [ "$1" = popd ] && { lost=1; continue; }  # the directory stack is not tracked
  if [ "$1" = cd ] || [ "$1" = pushd ]; then
    verbcd="$1"; nochange=0; shift
    while [ "$#" -gt 0 ]; do case "$1" in --) shift; break ;; -n) nochange=1; shift ;; -[LPe@]*) shift ;; *) break ;; esac; done
    # a target the hook cannot follow (an expansion, a missing directory, cd -, pushd +N, a bare pushd) leaves the directory unknown:
    # broad staging is then blocked. A bare cd goes home.
    if [ "$nochange" = 0 ]; then
      if [ -z "${1:-}" ]; then
        if [ "$verbcd" = cd ]; then cur="$HOME"; else lost=1; fi
      else
        case "$1" in -|+[0-9]*|-[0-9]*) lost=1 ;;
          *) d="${1/#\~/$HOME}"; n="$(CDPATH='' absdir "$cur" "$d")"; if [ -n "$n" ]; then cur="$n"; else lost=1; fi ;;
        esac
      fi
    fi
    continue
  fi
  genv=()
  # git in any case, with or without .exe (Git Bash)
  while [ "$#" -gt 0 ]; do
    case "${1##*/}" in [Gg][Ii][Tt]|[Gg][Ii][Tt].[Ee][Xx][Ee]) break ;; esac
    case "$1" in GIT_DIR=|GIT_WORK_TREE=) ;; GIT_DIR=*|GIT_WORK_TREE=*) genv+=("$1") ;; esac
    shift
  done
  [ "$#" -gt 0 ] || continue
  shift; dir="$cur"; gitopts=(); expverb=0
  while [ "$#" -gt 0 ]; do
    case "$1" in
      __EXP__) # an expansion where an option or the verb belongs (git${IFS}add, -C "$PWD" add): take the next staging verb, judge as add -A
        shift
        while [ "$#" -gt 0 ]; do
          case "$1" in add|stage|commit|push|update-index|mv|apply|am|status|log|diff|show|branch|fetch|rev-parse|ls-files|remote|config|tag|stash|describe|blame|grep|reflog|checkout|switch|restore|reset|clean|merge|rebase|pull|clone|init|cherry-pick|revert|worktree|submodule|bisect|ls-tree|cat-file) break ;; esac
          shift
        done
        [ "$#" -gt 0 ] || set -- add  # no recognisable verb behind an expansion (git ${x:-add} -A): judge it as git add -A
        expverb=1; break ;;
      -C) if [ "${2:-}" = __EXP__ ]; then shift; continue; fi
          d="${2/#\~/$HOME}"; n="$(absdir "$dir" "$d")"; [ -n "$n" ] && dir="$n"; shift 2 || shift ;;
      -c) shift 2 || shift ;;
      --git-dir=|--work-tree=) shift ;;  # value was an expansion; the next word is __EXP__ and takes the verb scan
      --git-dir=*|--work-tree=*) gitopts+=("$1"); shift ;;
      --git-dir|--work-tree) if [ "${2:-}" = __EXP__ ]; then shift; else gitopts+=("$1" "${2:-}"); shift 2 || shift; fi ;;
      -*) shift ;;
      *) break ;;
    esac
  done
  verb="${1:-}"; [ "$#" -gt 0 ] && shift
  case "$verb" in add|stage|commit|push|update-index|mv|apply|am) ;; *) continue ;; esac
  # rev-parse fails outside a repo: git cannot list what is staged, so literal paths are judged below and a broad add is judged from the
  # files on disk (untracked_norepo).
  inrepo=1; g rev-parse --git-dir >/dev/null 2>&1 || inrepo=0
  broad=0; whole=0; paths=""; dd=0; [ "$expverb" = 1 ] && broad=1
  for t in "$@"; do
    # commit: words before -- are message text, not paths (staged files are judged from git instead)
    [ "$verb" = commit ] && [ "$dd" = 0 ] && case "$t" in --) dd=1; continue ;; -*) ;; *) broad=1; continue ;; esac
    case "$t" in
      --all|--update) broad=1; whole=1 ;;
      --force|--pathspec-from-file*) broad=1 ;;
      -*) case "$verb" in
            add|stage) printf '%s' "$t" | grep -Eq '^-[a-zA-Z]*[Aufp][a-zA-Z]*$' && broad=1
                       printf '%s' "$t" | grep -Eq '^-[a-zA-Z]*[Au][a-zA-Z]*$' && whole=1 ;;
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
  [ "$verb" = commit ] && [ "$broad" = 1 ] && [ "$lost" = 1 ] && { hits="$hits (a-cd-target-the-hook-cannot-follow)"; continue; }
  case "$verb" in
    add|stage|update-index|apply|am)
      if [ "$broad" = 1 ] && [ "$lost" = 1 ]; then hits="$hits (a-cd-target-the-hook-cannot-follow)"; continue; fi
      if [ "$broad" = 1 ] && [ "$inrepo" = 0 ]; then
        if lst="$(untracked_norepo "$dir")"; then
          while IFS= read -r f; do [ -n "$f" ] && is_secret "$f" && hits="$hits $f"; done <<< "$lst"
        else hits="$hits (untracked-files-not-listable)"; fi
      fi ;;
  esac
  [ "$inrepo" = 1 ] || continue
  case "$verb" in
    add|stage|update-index|apply|am)
      # ':/' is refused when the work tree is given by --work-tree/GIT_WORK_TREE from outside it; the plain listing then still runs
      if [ "$whole" = 1 ]; then judge < <(pending "$dir" -- ':/' || pending "$dir"); elif [ "$broad" = 1 ]; then judge < <(pending "$dir"); fi ;;
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
