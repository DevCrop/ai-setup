#!/usr/bin/env bash
# Apply the managed files from claude/ into the Claude config directory.
# Works on macOS bash 3.2 and Git Bash on Windows. Needs jq. Never touches credentials, projects/, sessions/, plugins/ or any other
# runtime data. There is no backup: git is the history. To go back, check out the older commit and run this script again.
#
# settings.json is merged key by key, not replaced:
#   - this repo owns permissions.{defaultMode,deny,ask,allow}, autoMode, hooks, statusLine, extraKnownMarketplaces and skillOverrides:
#     the live value is replaced by the repo value (a key the repo lacks is deleted), so a rule added by hand on a machine cannot stay;
#   - every other key present in the repo (model, effortLevel, ...) takes the repo value;
#   - keys that only exist on the machine (env, a plugin enabled by "claude plugin install", app settings) are kept and reported;
#   - scripts/removed-keys.json lists keys that are deleted from the live file.
# Files in the managed folders are tracked in $dest/.claude-global-manifest: a file this script copied earlier and the repo no longer
# has is deleted; a file that never came from this repo is kept and reported.
set -eu

repo="$(cd "$(dirname "$0")/.." && pwd)"
src="$repo/claude"
dest="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
dest="${dest%/}"
[ -n "$dest" ] || { echo "apply: the config directory resolves to an empty path" >&2; exit 2; }

# Files and directories copied. scheduled-tasks/ is excluded: it is created in the app.
# Skills are listed one by one: other skills (for example archify) live in the same directory.
items="CLAUDE.md RTK.md settings.json statusline.sh agents hooks routines skills/orchestrate skills/project-setup skills/spec-writing skills/design-spec skills/ui-baseline"

command -v jq >/dev/null 2>&1 || { echo "apply: jq is required (settings.json is merged key by key). macOS: brew install jq   Windows: winget install jqlang.jq" >&2; exit 2; }
[ -f "$repo/scripts/removed-keys.json" ] || { echo "apply: scripts/removed-keys.json is missing" >&2; exit 2; }
live="$dest/settings.json"
if [ -f "$live" ] && ! jq empty "$live" >/dev/null 2>&1; then
  echo "apply: $live is not valid JSON. Fix or move it; nothing was changed." >&2
  exit 1
fi

mkdir -p "$dest"
tmp="$(mktemp -d "${TMPDIR:-/tmp}/apply.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT

# ---- settings.json ----
if [ -f "$live" ]; then cp "$live" "$tmp/live.json"; else echo '{}' > "$tmp/live.json"; fi
jq -n --slurpfile l "$tmp/live.json" --slurpfile r "$src/settings.json" --slurpfile x "$repo/scripts/removed-keys.json" '
  def own_top: ["autoMode","hooks","statusLine","extraKnownMarketplaces","skillOverrides"];
  def own_perm: ["defaultMode","deny","ask","allow"];
  $l[0] as $l | $r[0] as $r | $x[0] as $x
  | ($l * $r)
  | reduce own_top[] as $k (.; if ($r | has($k)) then .[$k] = $r[$k] else del(.[$k]) end)
  | .permissions = ((.permissions // {}) | reduce own_perm[] as $k (.; if (($r.permissions // {}) | has($k)) then .[$k] = $r.permissions[$k] else del(.[$k]) end))
  | reduce $x[] as $p (.; delpaths([$p]))' > "$tmp/merged.json"

# What the merge kept, replaced and removed (reported, never silent).
jq -n -r --slurpfile l "$tmp/live.json" --slurpfile r "$src/settings.json" --slurpfile x "$repo/scripts/removed-keys.json" '
  def own_top: ["autoMode","hooks","statusLine","extraKnownMarketplaces","skillOverrides"];
  def own_perm: ["defaultMode","deny","ask","allow"];
  $l[0] as $l | $r[0] as $r | $x[0] as $x
  | ([own_top[] as $k | select(($l | has($k)) and ($l[$k] != $r[$k])) | $k]
     + [own_perm[] as $k | select((($l.permissions // {}) | has($k)) and (($l.permissions // {})[$k] != ($r.permissions // {})[$k])) | "permissions." + $k]) as $replaced
  | ($x | map(select(. as $p | ($l | getpath($p)) != null)) | map(join("."))) as $removed
  | (($l | keys) - ($r | keys) - ($x | map(select(length == 1) | .[0]))) as $only_top
  | ((($l.enabledPlugins // {}) | keys) - (($r.enabledPlugins // {}) | keys) - ($x | map(select(.[0] == "enabledPlugins" and length == 2) | .[1]))) as $only_plugins
  | (if ($replaced | length) > 0 then "replaced live value of: " + ($replaced | join(", ")) else empty end),
    (if ($removed | length) > 0 then "removed from settings.json: " + ($removed | join(", ")) else empty end),
    (if ($only_top | length) > 0 then "kept machine-only keys: " + ($only_top | join(", ")) else empty end),
    (if ($only_plugins | length) > 0 then "kept machine-only enabledPlugins: " + ($only_plugins | join(", ")) else empty end)' > "$tmp/report.txt"

# ---- copy ----
for item in $items; do
  if [ "$item" = settings.json ]; then
    cp "$tmp/merged.json" "$dest/settings.json.new" && mv "$dest/settings.json.new" "$dest/settings.json"
  elif [ -d "$src/$item" ]; then
    mkdir -p "$dest/$item"
    cp -R "$src/$item/." "$dest/$item/"
  else
    cp "$src/$item" "$dest/$item"
  fi
  echo "applied: $item"
done
sed 's/^/settings.json: /' "$tmp/report.txt"

# ---- manifest: drop files the repo no longer has, report files it never had ----
: > "$tmp/new.list"
for item in $items; do
  [ "$item" = settings.json ] && continue
  if [ -d "$src/$item" ]; then (cd "$src" && find "$item" -type f) >> "$tmp/new.list"; else echo "$item" >> "$tmp/new.list"; fi
done
sort -o "$tmp/new.list" "$tmp/new.list"
manifest="$dest/.claude-global-manifest"
managed() { for it in $items; do case "$1" in "$it"|"$it"/*) return 0 ;; esac; done; return 1; }
if [ -f "$manifest" ]; then
  grep -vxFf "$tmp/new.list" "$manifest" > "$tmp/stale.list" || true
  while IFS= read -r p; do
    [ -n "$p" ] || continue
    case "$p" in /*|*..*) continue ;; esac
    managed "$p" || continue
    [ -e "$dest/$p" ] || continue
    rm -f "$dest/$p"
    (cd "$dest" && rmdir -p "$(dirname "$p")" 2>/dev/null) || true
    echo "removed (no longer in the repo): $p"
  done < "$tmp/stale.list"
fi
: > "$tmp/foreign.list"
for item in $items; do
  [ -d "$src/$item" ] || continue
  (cd "$dest" && find "$item" -type f 2>/dev/null) | grep -vxFf "$tmp/new.list" >> "$tmp/foreign.list" || true
done
if [ -s "$tmp/foreign.list" ]; then
  head -n 20 "$tmp/foreign.list" | sed 's/^/kept (not from this repo): /'
  [ "$(wc -l < "$tmp/foreign.list")" -gt 20 ] && echo "kept (not from this repo): ... and $(( $(wc -l < "$tmp/foreign.list") - 20 )) more"
fi
cp "$tmp/new.list" "$manifest.new" && mv "$manifest.new" "$manifest"

if ! command -v rtk >/dev/null 2>&1; then
  echo "warning: rtk not found in PATH. settings.json hooks it; Bash still runs, RTK filtering is off." >&2
  echo "  macOS: brew install rtk    Windows: winget install rtk-ai.rtk" >&2
fi
