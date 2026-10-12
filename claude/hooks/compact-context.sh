#!/usr/bin/env bash
# SessionStart hook (matcher "compact"): after a compaction, put the project's handoff note back into Claude's context.
# Plain stdout of a SessionStart hook is added as context; output over 10,000 characters is moved to a file Claude is not asked to read
# (https://code.claude.com/docs/en/hooks), so the note is cut at 8,000 bytes without splitting a UTF-8 character.
# The start folder is the input's cwd, which follows Claude into a worktree, else ${CLAUDE_PROJECT_DIR}, which stays at the launch folder.
# The search goes up to the first .claude/handoff.md and stops at the home folder (compared with -ef, so a symlinked or differently
# spelled home is still the home folder), which is never a project. Never blocks: always exit 0, nothing on stderr.
max=8000
{
input="$(cat)"
dir=""
if command -v jq >/dev/null; then
  dir="$(printf '%s' "$input" | jq -r 'if type == "object" and (.cwd | type) == "string" then .cwd else empty end')"
fi
[ -n "$dir" ] || dir="${CLAUDE_PROJECT_DIR:-}"
# Git Bash: C:\x\y comes in Windows form; cygpath makes it /c/x/y so dirname can walk it.
case "$dir" in *\\*|?:*) command -v cygpath >/dev/null && dir="$(cygpath -u "$dir")" ;; esac
note=""
d="$dir"
while [ -n "$d" ] && [ "$d" != "." ] && [ -d "$d" ] && ! [ "$d" -ef "$HOME" ]; do
  if [ -f "$d/.claude/handoff.md" ]; then note="$d/.claude/handoff.md"; break; fi
  p="$(dirname "$d")"
  [ "$p" = "$d" ] && break
  d="$p"
done
if [ -n "$note" ] && [ -r "$note" ]; then
  size="$(wc -c < "$note" | tr -d ' ')"
  when="$(date -r "$note" '+%Y-%m-%d %H:%M' || echo 'unknown time')"
  if [ "${size:-0}" -gt "$max" ]; then
    printf 'Context was compacted. Handoff note %s, last written %s (first %s of %s bytes; read the file for the rest). Check that it is about the current task:\n' "$note" "$when" "$max" "$size"
    # iconv -c drops a UTF-8 character cut in half at the end; without iconv the last, partial line is dropped instead
    if command -v iconv >/dev/null; then head -c "$max" "$note" | iconv -c -f UTF-8 -t UTF-8; else head -c "$max" "$note" | sed '$d'; fi
  else
    printf 'Context was compacted. Handoff note %s, last written %s. Check that it is about the current task:\n' "$note" "$when"
    cat "$note"
  fi
  printf '\n'
else
  printf '%s\n' "Context was compacted. Keep the list of modified files, the test and check commands, and the open issues (global CLAUDE.md, Context and handoff)."
fi
} 2>/dev/null
exit 0
