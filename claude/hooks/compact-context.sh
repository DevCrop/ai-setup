#!/usr/bin/env bash
# SessionStart hook (matcher "compact"): after a compaction, put the project's handoff note back into Claude's context.
# Plain stdout of a SessionStart hook is added as context; output over 10,000 characters is moved to a file Claude is not asked to read
# (https://code.claude.com/docs/en/hooks), so the note is cut at 8,000 bytes. The project is ${CLAUDE_PROJECT_DIR} (set for command hooks),
# else the input's cwd; the search goes up to the first .claude/handoff.md and stops below the home folder, which is never a project.
# Never blocks and never fails the session: always exit 0, nothing on stderr.
max=8000
input="$(cat 2>/dev/null)"
dir="${CLAUDE_PROJECT_DIR:-}"
if [ -z "$dir" ] && command -v jq >/dev/null 2>&1; then
  dir="$(printf '%s' "$input" | jq -r 'if type == "object" and (.cwd | type) == "string" then .cwd else empty end' 2>/dev/null)"
fi
# Git Bash: C:\x\y comes in Windows form; cygpath makes it /c/x/y so dirname walks it and it compares with $HOME.
case "$dir" in *\\*|?:*) command -v cygpath >/dev/null 2>&1 && dir="$(cygpath -u "$dir" 2>/dev/null)" ;; esac
note=""
d="$dir"
while [ -n "$d" ] && [ "$d" != "$HOME" ] && [ "$d" != "." ]; do
  if [ -f "$d/.claude/handoff.md" ]; then note="$d/.claude/handoff.md"; break; fi
  p="$(dirname "$d")"
  [ "$p" = "$d" ] && break
  d="$p"
done
if [ -n "$note" ] && [ -r "$note" ]; then
  size="$(wc -c < "$note" 2>/dev/null | tr -d ' ')"
  if [ "${size:-0}" -gt "$max" ]; then
    printf 'Context was compacted. Handoff note %s (first %s of %s bytes; read the file for the rest):\n' "$note" "$max" "$size"
  else
    printf 'Context was compacted. Handoff note %s:\n' "$note"
  fi
  head -c "$max" "$note" 2>/dev/null
  printf '\n'
else
  printf '%s\n' "Context was compacted. Keep the list of modified files, the test and check commands, and the open issues (global CLAUDE.md, Context and handoff)."
fi
exit 0
