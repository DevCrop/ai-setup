#!/usr/bin/env bash
# Copy the managed files from claude/ into the Claude config directory.
# Works on macOS bash and Git Bash on Windows. Never touches credentials,
# projects/, sessions/, plugins/ or any other runtime data.
set -eu

repo="$(cd "$(dirname "$0")/.." && pwd)"
src="$repo/claude"
dest="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
stamp="$(date +%Y%m%d-%H%M%S)"
backup="$dest-backup-$stamp"

# Files and directories copied. scheduled-tasks/ is excluded: it is created in the app.
# Skills are listed one by one: other skills (for example archify) live in the same directory.
items="CLAUDE.md RTK.md settings.json statusline.sh agents hooks routines skills/orchestrate skills/project-setup skills/spec-writing skills/design-spec skills/ui-baseline"

mkdir -p "$dest"

for item in $items; do
  if [ -e "$dest/$item" ]; then
    mkdir -p "$backup/$(dirname "$item")"
    cp -R "$dest/$item" "$backup/$(dirname "$item")/"
  fi
done
[ -d "$backup" ] && echo "backup: $backup"

# settings.json is replaced as a whole: say so when the live copy has changes the repo does not (for example
# enabledPlugins written by "claude plugin install"). Key order alone is not a difference.
# "env" is machine-local (for example CLAUDE_CODE_TMPDIR): it is kept from the live copy and ignored in the comparison.
local_env=""
if [ -f "$dest/settings.json" ] && command -v jq >/dev/null 2>&1; then
  local_env="$(jq -c '.env // empty' "$dest/settings.json" 2>/dev/null)"
fi
if [ -f "$dest/settings.json" ] && ! cmp -s "$src/settings.json" "$dest/settings.json"; then
  if command -v jq >/dev/null 2>&1      && [ "$(jq -S 'del(.env)' "$src/settings.json" 2>/dev/null)" = "$(jq -S 'del(.env)' "$dest/settings.json" 2>/dev/null)" ]; then
    :
  else
    echo "warning: $dest/settings.json differs from claude/settings.json and is about to be overwritten." >&2
    echo "  Keep any live change you want by moving it into claude/settings.json first; the old copy is in $backup." >&2
  fi
fi

for item in $items; do
  if [ -d "$src/$item" ]; then
    mkdir -p "$dest/$item"
    cp -R "$src/$item/." "$dest/$item/"
  else
    cp "$src/$item" "$dest/$item"
  fi
  echo "applied: $item"
done

if [ -n "$local_env" ]; then
  jq --argjson e "$local_env" '.env = ((.env // {}) + $e)' "$dest/settings.json" > "$dest/settings.json.tmp" && mv "$dest/settings.json.tmp" "$dest/settings.json" \
    && echo "kept machine-local env: $local_env"
fi

if ! command -v rtk >/dev/null 2>&1; then
  echo "warning: rtk not found in PATH. settings.json hooks it; Bash still runs, RTK filtering is off." >&2
  echo "  macOS: brew install rtk    Windows: winget install rtk-ai.rtk" >&2
fi
