#!/usr/bin/env bash
# ConfigChange hook (matchers user_settings, skills): append one line per change to <config dir>/config-changes.log so that
# `bash scripts/verify.sh --live` can name edits made to the global config outside this repo. The hooks guide says ConfigChange fires
# when an external process or editor modifies a configuration file. Its stdout and systemMessage are not shown
# (https://code.claude.com/docs/en/hooks), so the log is the only output. The skills matcher also fires for a project's .claude/skills/,
# so only paths inside the config dir are logged. It never blocks: Claude Code itself and this repo's apply.sh write settings too.
# Always exit 0, nothing on stderr.
# Line format: <epoch seconds> TAB <UTC time> TAB <source> TAB <file_path>. The log keeps its last 500 lines once it passes 256 KB.
{
cfg="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
cfg="${cfg%/}"
log="$cfg/config-changes.log"
input="$(cat)"
[ -d "$cfg" ] || exit 0
command -v jq >/dev/null || exit 0
src="$(printf '%s' "$input" | jq -r 'select(type == "object" and (.source | type) == "string") | .source' | tr -d '\t\r\n')" || exit 0
[ -n "$src" ] || exit 0
path="$(printf '%s' "$input" | jq -r '.file_path // "" | tostring' | tr -d '\t\r\n')"
if [ -n "$path" ]; then
  # Compare in one form: Git Bash gets C:\... from Claude Code and /c/... in $HOME; case is folded for Windows and macOS.
  norm() { case "$1" in *\\*|?:*) command -v cygpath >/dev/null && { cygpath -u "$1"; return; } ;; esac; printf '%s' "$1"; }
  p="$(norm "$path" | tr '[:upper:]' '[:lower:]')"
  c="$(norm "$cfg" | tr '[:upper:]' '[:lower:]')"
  r="$(cd "$cfg" && pwd -P | tr '[:upper:]' '[:lower:]')"  # a symlinked config dir may be reported by its real path
  case "$p" in "$c"/*|"$r"/*) ;; *) exit 0 ;; esac
fi
printf '%s\t%s\t%s\t%s\n' "$(date -u +%s)" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$src" "$path" >> "$log" || exit 0
size="$(wc -c < "$log" | tr -d ' ')"
if [ "${size:-0}" -gt 262144 ]; then
  tail -n 500 "$log" > "$log.tmp.$$" && mv -f "$log.tmp.$$" "$log"
  rm -f "$log.tmp.$$"
fi
} 2>/dev/null
exit 0
