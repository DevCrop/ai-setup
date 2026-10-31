#!/usr/bin/env bash
# Apply the managed files from claude/ into the Claude config directory.
# Works in Git Bash on Windows (and bash on the linux CI runner). Needs jq. Never touches credentials, projects/, sessions/, plugins/ or any other
# runtime data. There is no backup: git is the history. To go back, check out the older commit and run this script again.
#
# settings.json is merged key by key, not replaced:
#   - this repo owns the keys in scripts/owned-keys.json (top-level keys and permissions.* keys):
#     the live value is replaced by the repo value (a key the repo lacks is deleted), so a rule added by hand on a machine cannot stay;
#     of modelSettings only the fields the repo sets are owned (levels saved for other models and other fields of the same entry stay);
#   - every other key present in the repo (model, effortLevel, ...) takes the repo value;
#   - keys that only exist on the machine (a plugin enabled by "claude plugin install", app settings) are kept and reported;
#     env is merged per variable like enabledPlugins: repo variables win, machine-only variables stay; names are reported, never values;
#   - scripts/removed-keys.json lists keys that are deleted from the live file.
# Files in the managed folders are tracked in $dest/.ai-setup-manifest: a file this script copied earlier and the repo no longer
# has is deleted; a file that never came from this repo is kept and reported. One-time migration: a manifest under the name used
# before the ai-setup rename (.claude-global-manifest) is moved to the new name when the new one does not exist yet; PCs applied
# before the rename still need it, so it stays until every PC has run apply.sh once.
# --dry-run writes nothing: it prints what would be written, replaced in settings.json and removed, then exits 0.
set -eu
dry=0
case "${1:-}" in --dry-run) dry=1 ;; "") ;; *) echo "usage: bash scripts/apply.sh [--dry-run]" >&2; exit 2 ;; esac

repo="$(cd "$(dirname "$0")/.." && pwd)"
src="$repo/claude"
dest="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
dest="${dest%/}"
[ -n "$dest" ] || { echo "apply: the config directory resolves to an empty path" >&2; exit 2; }

# Files and directories copied. scheduled-tasks/ is excluded: it is created in the app.
# Skills are listed one by one: skills from other sources live in the same directory.
items="CLAUDE.md RTK.md settings.json statusline.sh agents hooks skills/orchestrate skills/project-setup skills/spec-writing skills/design-spec skills/ui-baseline skills/frontend-design skills/publishing skills/developing"

command -v jq >/dev/null 2>&1 || { echo "apply: jq is required (settings.json is merged key by key). Windows: winget install jqlang.jq" >&2; exit 2; }
[ -f "$repo/scripts/removed-keys.json" ] || { echo "apply: scripts/removed-keys.json is missing" >&2; exit 2; }
jq -e '(.top | type) == "array" and (.permissions | type) == "array"' "$repo/scripts/owned-keys.json" >/dev/null 2>&1 \
  || { echo "apply: scripts/owned-keys.json is missing or has no top/permissions lists" >&2; exit 2; }
missing=""
for item in $items; do [ -e "$src/$item" ] || missing="$missing $item"; done
[ -z "$missing" ] || { echo "apply: the repo has no claude/{$missing }; nothing was changed." >&2; exit 2; }
live="$dest/settings.json"
# An empty file counts as {}; anything else must be a JSON object. Nothing is written before this passes.
if [ -s "$live" ] && ! jq -e 'type == "object"' "$live" >/dev/null 2>&1; then
  echo "apply: $live is not a valid JSON object. Fix or move it; nothing was changed." >&2
  exit 1
fi

[ "$dry" = 1 ] || mkdir -p "$dest"
tmp="$(mktemp -d "${TMPDIR:-/tmp}/apply.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT

# ---- settings.json ----
if [ -s "$live" ]; then cp "$live" "$tmp/live.json"; else echo '{}' > "$tmp/live.json"; fi
jq -n --slurpfile l "$tmp/live.json" --slurpfile r "$src/settings.json" --slurpfile x "$repo/scripts/removed-keys.json" --slurpfile o "$repo/scripts/owned-keys.json" '
  def own_top: $o[0].top; def own_perm: $o[0].permissions;
  $l[0] as $l | $r[0] as $r | $x[0] as $x
  # a live value of the wrong type (permissions: ["x"]) would make the merge fail; it is replaced like a hand edit
  | ($l | .permissions |= (if type == "object" then . else {} end) | .enabledPlugins |= (if type == "object" then . else {} end)
        | .modelSettings |= (if type == "object" then . else {} end)) as $l
  | ($l * $r)
  | reduce own_top[] as $k (.; if ($r | has($k)) then .[$k] = $r[$k] else del(.[$k]) end)
  | .permissions = ((.permissions // {}) | reduce own_perm[] as $k (.; if (($r.permissions // {}) | has($k)) then .[$k] = $r.permissions[$k] else del(.[$k]) end))
  | reduce $x[] as $p (.; delpaths([$p]))' > "$tmp/merged.json"

# What the merge kept, replaced and removed (reported, never silent).
jq -n -r --slurpfile l "$tmp/live.json" --slurpfile r "$src/settings.json" --slurpfile x "$repo/scripts/removed-keys.json" --slurpfile o "$repo/scripts/owned-keys.json" '
  def own_top: $o[0].top; def own_perm: $o[0].permissions;
  $l[0] as $l | $r[0] as $r | $x[0] as $x
  | ([("permissions", "enabledPlugins", "modelSettings") as $k | select(($l | has($k)) and ($l[$k] | type) != "object") | $k + " (was not an object)"]) as $bad
  | ($l | .permissions |= (if type == "object" then . else {} end) | .enabledPlugins |= (if type == "object" then . else {} end)
        | .modelSettings |= (if type == "object" then . else {} end)) as $l
  | ($bad + [own_top[] as $k | select(($l | has($k)) and ($l[$k] != $r[$k])) | $k]
     + [own_perm[] as $k | select((($l.permissions // {}) | has($k)) and (($l.permissions // {})[$k] != ($r.permissions // {})[$k])) | "permissions." + $k]
     + [($r | keys[]) as $k | select(($k | IN(own_top[]) or $k == "permissions" or $k == "enabledPlugins" or $k == "modelSettings" or $k == "env") | not) | select(($l | has($k)) and $l[$k] != $r[$k]) | $k]
     + [($r.enabledPlugins // {} | to_entries[]) as $e | select((($l.enabledPlugins // {}) | has($e.key)) and (($l.enabledPlugins // {})[$e.key] != $e.value)) | "enabledPlugins." + $e.key]
     + [($r.env // {} | to_entries[]) as $e | select((($l.env // {}) | has($e.key)) and (($l.env // {})[$e.key] != $e.value)) | "env." + $e.key]
     + [($r.modelSettings // {} | to_entries[]) as $e | ($e.value | keys[]) as $f
        | (if ($l.modelSettings | type) == "object" then $l.modelSettings[$e.key] else $l.modelSettings end) as $le
        | select($le != null and (($le | type) != "object" or (($le | has($f)) and $le[$f] != $e.value[$f]))) | "modelSettings." + $e.key + "." + $f]) as $replaced
  | ($x | map(select(. as $p | ($l | getpath($p)) != null)) | map(join("."))) as $removed
  | (($l | keys) - ($r | keys) - own_top - ($x | map(select(length == 1) | .[0]))) as $only_top
  | ((($l.enabledPlugins // {}) | keys) - (($r.enabledPlugins // {}) | keys) - ($x | map(select(.[0] == "enabledPlugins" and length == 2) | .[1]))) as $only_plugins
  | (if ($r | has("env")) then ((($l.env // {}) | keys) - (($r.env // {}) | keys) - ($x | map(select(.[0] == "env" and length == 2) | .[1]))) else [] end) as $only_env
  | (if ($replaced | length) > 0 then "replaced live value of: " + ($replaced | join(", ")) else empty end),
    (if ($removed | length) > 0 then "removed from settings.json: " + ($removed | join(", ")) else empty end),
    (if ($only_top | length) > 0 then "kept machine-only keys: " + ($only_top | join(", ")) else empty end),
    (if ($only_plugins | length) > 0 then "kept machine-only enabledPlugins: " + ($only_plugins | join(", ")) else empty end),
    (if ($only_env | length) > 0 then "kept machine-only env: " + ($only_env | join(", ")) else empty end)' > "$tmp/report.txt"

# ---- file list and manifest helpers (read only) ----
: > "$tmp/new.list"
for item in $items; do
  [ "$item" = settings.json ] && continue
  if [ -d "$src/$item" ]; then (cd "$src" && find "$item" -type f) >> "$tmp/new.list"; else echo "$item" >> "$tmp/new.list"; fi
done
sort -o "$tmp/new.list" "$tmp/new.list"
manifest="$dest/.ai-setup-manifest"
old_manifest="$dest/.claude-global-manifest"  # one-time migration: the name before the ai-setup rename, moved to $manifest (below), never written
manifest_in="$manifest"  # the file the stale-file check reads; the old one in a dry run that would move it
if [ -f "$old_manifest" ] && [ ! -e "$manifest" ]; then migrate=1; manifest_in="$old_manifest"; else migrate=0; fi
managed() { for it in $items; do case "$1" in "$it"|"$it"/*) return 0 ;; esac; done; return 1; }
# A path from the manifest is deleted only when it stays inside $dest: no ".." component, no symlinked directory on the way (rm would
# follow it out of the config directory), and the last component is a regular file or a link (a link is removed, never followed).
removable() {
  case "/$1/" in */../*|*//*) return 1 ;; esac
  cur="$dest"; rest="$1"
  while :; do
    case "$rest" in */*) ;; *) break ;; esac
    cur="$cur/${rest%%/*}"; rest="${rest#*/}"
    [ -L "$cur" ] && return 1
  done
  [ -f "$dest/$1" ] || [ -L "$dest/$1" ]
}

# ---- dry run: compare and report, write nothing ----
if [ "$dry" = 1 ]; then
  for item in $items; do
    if [ "$item" = settings.json ]; then
      if [ -s "$live" ] && [ "$(jq -S . "$live")" = "$(jq -S . "$tmp/merged.json")" ]; then echo "unchanged: settings.json"; else echo "would write: settings.json"; fi
    elif [ -d "$src/$item" ]; then
      ch="$( (cd "$src/$item" && find . -type f) | while IFS= read -r f; do cmp -s "$src/$item/$f" "$dest/$item/$f" || echo x; done | wc -l | tr -d ' ')"
      if [ "$ch" = 0 ]; then echo "unchanged: $item"; else echo "would write: $item ($ch files)"; fi
    elif cmp -s "$src/$item" "$dest/$item"; then echo "unchanged: $item"
    else echo "would write: $item"
    fi
  done
  sed 's/^/settings.json: /' "$tmp/report.txt"
  [ "$migrate" = 1 ] && echo "would rename: ${old_manifest##*/} -> ${manifest##*/}"
  if [ -f "$manifest_in" ]; then
    grep -vxFf "$tmp/new.list" "$manifest_in" | while IFS= read -r p; do
      [ -n "$p" ] || continue
      case "$p" in /*) continue ;; esac
      [ "$p" = settings.json ] && continue
      if managed "$p"; then removable "$p" && echo "would remove (no longer in the repo): $p"
      elif removable "$p"; then echo "kept (dropped from the copy list; remove it by hand if unused): $p"; fi
    done || true
  fi
  echo "dry run: nothing was written"
  exit 0
fi

# ---- one-time migration: manifest rename ----
if [ "$migrate" = 1 ]; then
  mv "$old_manifest" "$manifest"
  echo "renamed: ${old_manifest##*/} -> ${manifest##*/}"
fi

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

# ---- manifest: drop files the repo no longer has, report files it never had (file list built above) ----
if [ -f "$manifest" ]; then
  grep -vxFf "$tmp/new.list" "$manifest" > "$tmp/stale.list" || true
  while IFS= read -r p; do
    [ -n "$p" ] || continue
    case "$p" in /*) continue ;; esac
    [ "$p" = settings.json ] && continue  # merged, never deleted
    # an item dropped from $items (a retired skill): not deleted, since items outside the list are never touched, but reported each run
    if ! managed "$p"; then removable "$p" && echo "kept (dropped from the copy list; remove it by hand if unused): $p" && echo "$p" >> "$tmp/dropped.list"; continue; fi
    removable "$p" || continue
    rm -f "$dest/$p" || continue
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
  sort "$tmp/foreign.list" | head -n 20 | sed 's/^/kept (not from this repo): /'
  [ "$(wc -l < "$tmp/foreign.list")" -gt 20 ] && echo "kept (not from this repo): ... and $(( $(wc -l < "$tmp/foreign.list") - 20 )) more"
fi
[ -f "$tmp/dropped.list" ] && sort -u "$tmp/dropped.list" >> "$tmp/new.list"  # keep reporting them until removed by hand
cp "$tmp/new.list" "$manifest.new" && mv "$manifest.new" "$manifest"

if ! command -v rtk >/dev/null 2>&1; then
  echo "warning: rtk not found in PATH. settings.json hooks it; Bash still runs, RTK filtering is off." >&2
  echo "  Windows: winget install rtk-ai.rtk" >&2
fi
