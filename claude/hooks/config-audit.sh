#!/usr/bin/env bash
# ConfigChange hook (matchers user_settings, skills): append one line per change to <config dir>/config-changes.log so that
# `bash scripts/verify.sh --live` can name edits made to ~/.claude outside this repo. A ConfigChange hook's stdout and systemMessage are
# not shown (https://code.claude.com/docs/en/hooks), so the log is the only output. It never blocks: Claude Code itself writes settings
# (theme, plugins), and this repo's apply.sh does too. Always exit 0, nothing on stderr.
# Line format: <epoch seconds> TAB <UTC time> TAB <source> TAB <file_path>. The log keeps its last 500 lines once it passes 256 KB.
log="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/config-changes.log"
input="$(cat 2>/dev/null)"
[ -d "${log%/*}" ] || exit 0
command -v jq >/dev/null 2>&1 || exit 0
row="$(printf '%s' "$input" | jq -r 'select(type == "object" and (.source | type) == "string") | [.source, (.file_path // "" | tostring)] | @tsv' 2>/dev/null)" || exit 0
[ -n "$row" ] || exit 0
printf '%s\t%s\t%s\n' "$(date -u +%s)" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$row" >> "$log" 2>/dev/null || exit 0
size="$(wc -c < "$log" 2>/dev/null | tr -d ' ')"
if [ "${size:-0}" -gt 262144 ]; then
  tail -n 500 "$log" > "$log.tmp" 2>/dev/null && mv -f "$log.tmp" "$log" 2>/dev/null
  rm -f "$log.tmp" 2>/dev/null
fi
exit 0
