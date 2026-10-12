#!/usr/bin/env bash
# SessionStart hook (matcher "compact"): after a compaction, put the project's handoff note back into Claude's context.
# Plain stdout of a SessionStart hook is added as context; output over 10,000 characters is moved to a file Claude is not asked to read
# (https://code.claude.com/docs/en/hooks), so the note is cut at 8,000 bytes without splitting a UTF-8 character.
# The search starts at the input's cwd, which follows Claude into a worktree; when that finds nothing (a cwd outside the project, or a
# removed one), it starts again at ${CLAUDE_PROJECT_DIR}, which stays at the launch folder; not when the cwd's project has no note.
# The search goes up to the first .claude/handoff.md, stops at the nearest project mark (.git, CLAUDE.md, AGENTS.md, .claude) that has
# no note (a linked worktree, whose .git is a file, is not a stop), and stops at the home folder (compared with -ef, so a symlinked or differently
# spelled home is still the home folder), which is never a project. Never blocks: always exit 0, nothing on stderr.
max=8000
{
input="$(cat)"
cwd=""
if command -v jq >/dev/null; then
  cwd="$(printf '%s' "$input" | jq -r 'if type == "object" and (.cwd | type) == "string" then .cwd else empty end')"
fi
# find_note <dir>: the first .claude/handoff.md at or above <dir>, below the home folder. A level that does not exist (a removed
# worktree) is skipped, not an end. Returns 2 when a project mark without a note ended the walk, so the caller does not fall back. Git Bash: C:\x\y comes in Windows form; cygpath makes it /c/x/y so dirname can walk it.
find_note() {
  local d="$1" p
  case "$d" in *\\*|?:*) command -v cygpath >/dev/null && d="$(cygpath -u "$d")" ;; esac
  while [ -n "$d" ] && [ "$d" != "." ] && ! [ "$d" -ef "$HOME" ]; do
    if [ -f "$d/.claude/handoff.md" ]; then printf '%s' "$d/.claude/handoff.md"; return; fi
    # a project mark without a note ends the walk: a nested project never gets its parent's note (project rule, global CLAUDE.md).
    # A linked git worktree (.git is a file) is the same project as its main checkout, so the walk goes on to it.
    if ! [ -f "$d/.git" ] && { [ -d "$d/.git" ] || [ -f "$d/CLAUDE.md" ] || [ -f "$d/AGENTS.md" ] || [ -d "$d/.claude" ]; }; then return 2; fi
    p="$(dirname "$d")"
    [ "$p" = "$d" ] && return
    d="$p"
  done
}
note=""; stop=0
if [ -n "$cwd" ]; then note="$(find_note "$cwd")" || stop=$?; fi
# the cwd's own project has no note: never borrow the launch folder's (a parent project) note
[ -z "$note" ] && [ "$stop" != 2 ] && [ -n "${CLAUDE_PROJECT_DIR:-}" ] && note="$(find_note "$CLAUDE_PROJECT_DIR")"
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
