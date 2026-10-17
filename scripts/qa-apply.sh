#!/usr/bin/env bash
# Scenario tests for scripts/apply.sh. No model calls, no network.
# Every run happens in a scratch directory: HOME and CLAUDE_CONFIG_DIR both point under it, and the script refuses to start when the
# target is not under that directory.
# Usage: bash scripts/qa-apply.sh
set -u
repo="$(cd "$(dirname "$0")/.." && pwd)"
command -v jq >/dev/null 2>&1 || { echo "needs jq" >&2; exit 2; }
base="$(mktemp -d "${TMPDIR:-/tmp}/qa-apply.XXXXXX")" || exit 2
[ -n "$base" ] && [ -d "$base" ] || exit 2
trap 'rm -rf "$base"' EXIT
fail=0
pass() { echo "PASS  $*"; }
bad() { echo "FAIL  $*"; fail=$((fail + 1)); }

n=0
newcfg() { n=$((n + 1)); cfg="$base/s$n/.claude"; mkdir -p "$base/s$n"; }
apply() { # runs apply.sh against $cfg (path given to CLAUDE_CONFIG_DIR as is, so a trailing slash can be tested)
  case "${1:-$cfg}" in "$base"/*) ;; *) echo "refusing to apply outside $base: ${1:-$cfg}" >&2; exit 2 ;; esac
  HOME="$base/s$n" CLAUDE_CONFIG_DIR="${1:-$cfg}" bash "$repo/scripts/apply.sh" 2>&1
}
dryrun() { HOME="$base/s$n" CLAUDE_CONFIG_DIR="$cfg" bash "$repo/scripts/apply.sh" --dry-run 2>&1; }
live() { jq -r "$1" "$cfg/settings.json"; }
sorted() { jq -S . "$1"; }

# 1. fresh machine: everything is applied and settings.json equals the repo
newcfg; out="$(apply)"
[ -f "$cfg/hooks/config-audit.sh" ] && [ -f "$cfg/agents/reviewer.md" ] && [ -f "$cfg/.ai-setup-manifest" ] \
  && [ "$(sorted "$cfg/settings.json")" = "$(sorted "$repo/claude/settings.json")" ] \
  && pass "1 fresh install: files, manifest and settings equal the repo" || bad "1 fresh install ($out)"
if ! printf '%s' "$out" | grep -qi "backup"; then pass "1 no backup is made"; else bad "1 apply mentions a backup"; fi
ls -d "$base"/s1/*backup* "$base"/s1/.claude-backup* >/dev/null 2>&1 && bad "1 a backup directory exists" || pass "1 no backup directory exists"

# 2. second run changes nothing and reports nothing to fix
cp "$cfg/settings.json" "$base/before.json"; cp "$cfg/.ai-setup-manifest" "$base/before.manifest"
out="$(apply)"
cmp -s "$base/before.json" "$cfg/settings.json" && cmp -s "$base/before.manifest" "$cfg/.ai-setup-manifest" \
  && ! printf '%s' "$out" | grep -qE "^(settings.json: |removed|kept)" && pass "2 second run is idempotent and quiet" || bad "2 second run changed something: $out"

# 3. stale file from an earlier apply is removed; a user file and a tampered manifest line are not
mkdir -p "$base/outside" "$cfg/projects" "$base/s$n/outside"; echo keep > "$base/outside/victim"; echo keep > "$base/s$n/outside/victim2"; echo keep > "$cfg/projects/x.jsonl"
echo y > "$cfg/agents/old-agent.md"; echo y > "$cfg/agents/mine.md"
# manifest lines that must never delete anything: parent traversal, an absolute path, and a real file outside the managed items
{ cat "$cfg/.ai-setup-manifest"; echo "agents/old-agent.md"; echo "../outside/victim"; echo "agents/../../outside/victim2"; echo "/etc/hostname"; echo "projects/x.jsonl"; } > "$base/m"; cp "$base/m" "$cfg/.ai-setup-manifest"
out="$(apply)"
[ ! -e "$cfg/agents/old-agent.md" ] && [ -e "$cfg/agents/mine.md" ] && [ -e "$base/outside/victim" ] && [ -e "$base/s$n/outside/victim2" ] && [ -e "$cfg/projects/x.jsonl" ] \
  && printf '%s' "$out" | grep -q "kept (not from this repo): agents/mine.md" \
  && printf '%s' "$out" | grep -q "removed (no longer in the repo): agents/old-agent.md" \
  && pass "3 stale file removed; user file kept and reported; unsafe manifest lines ignored" || bad "3 stale handling ($out)"

# 3b. a symlinked directory inside a managed folder is never followed out of the config dir, and a directory line in the manifest is skipped
newcfg; apply >/dev/null; mkdir -p "$base/out/dir"; echo keep > "$base/out/victim"; echo keep > "$base/out/dir/inner"
ln -s "$base/out" "$cfg/agents/linkdir"; mkdir -p "$cfg/agents/realdir"; echo y > "$cfg/agents/stale.md"
{ cat "$cfg/.ai-setup-manifest"; echo "agents/linkdir/victim"; echo "agents/linkdir/dir/inner"; echo "agents/realdir"; echo "agents/stale.md"; } > "$base/m"; cp "$base/m" "$cfg/.ai-setup-manifest"
out="$(apply)"; rc=$?
[ -e "$base/out/victim" ] && [ -e "$base/out/dir/inner" ] && [ -d "$cfg/agents/realdir" ] && [ ! -e "$cfg/agents/stale.md" ] && [ -f "$cfg/.ai-setup-manifest" ] \
  && pass "3b symlinked dir not followed, directory line skipped, later stale file still removed" || bad "3b symlink/directory handling ($out)"

# 3c. a manifest line naming settings.json (merged, not copied) never deletes the live settings
newcfg; apply >/dev/null; echo settings.json >> "$cfg/.ai-setup-manifest"
out="$(apply)"
[ -s "$cfg/settings.json" ] && ! printf '%s' "$out" | grep -q "removed.*settings.json" \
  && pass "3c settings.json in the manifest is never removed" || bad "3c settings.json removed ($out)"

# 4. machine-only keys survive and are reported
newcfg; apply >/dev/null
jq '.enabledPlugins["foo@bar"]=true | .env={"X":"1"} | .someAppKey="v"' "$cfg/settings.json" > "$base/x" && cp "$base/x" "$cfg/settings.json"
out="$(apply)"
[ "$(live '.enabledPlugins["foo@bar"]')" = true ] && [ "$(live .env.X)" = 1 ] && [ "$(live .someAppKey)" = v ] \
  && printf '%s' "$out" | grep -q "kept machine-only" && pass "4 machine-only keys kept and reported" || bad "4 machine-only keys ($out)"

# 5. rules added by hand do not survive: allow, autoMode.allow, an extra hook event, an extra marketplace, changed values
jq '.permissions.allow=["Bash(*)"] | .permissions.deny=["Bash(ls)"] | .autoMode.allow=["x"] | .hooks.Stop=[{"hooks":[{"type":"command","command":"x"}]}]
    | .extraKnownMarketplaces.evil={"source":{"source":"github","repo":"evil/evil"}} | .permissions.defaultMode="default" | .permissions.disableBypassPermissionsMode="x" | .skillOverrides={}' "$cfg/settings.json" > "$base/x" && cp "$base/x" "$cfg/settings.json"
out="$(apply)"
if [ "$(sorted "$cfg/settings.json" | jq -c '[.permissions.allow, has("autoMode"), (.hooks|has("Stop")), (.extraKnownMarketplaces|has("evil")), .permissions.defaultMode, .permissions.disableBypassPermissionsMode]')" = '[[],false,false,false,"bypassPermissions",null]' ] \
   && [ "$(live '.permissions|has("deny")')" = false ] \
   && [ "$(live 'has("skillOverrides")')" = false ] && printf '%s' "$out" | grep -q "replaced live value of"; then
  pass "5 hand-added allow/autoMode/hook/marketplace/mode and a hand-set deny or bypass lock are replaced by the repo values and reported"
else bad "5 owned keys not restored ($out)"; fi

# 6. keys listed in scripts/removed-keys.json are deleted
jq '.enabledPlugins["superpowers@claude-plugins-official"]=true | .skipDangerousModePermissionPrompt=true' "$cfg/settings.json" > "$base/x" && cp "$base/x" "$cfg/settings.json"
out="$(apply)"
[ "$(live '.enabledPlugins | has("superpowers@claude-plugins-official")')" = false ] && [ "$(live .skipDangerousModePermissionPrompt)" = true ] \
  && printf '%s' "$out" | grep -q "removed from settings.json" && pass "6 removed-keys are deleted and reported; the accepted bypass warning is kept" || bad "6 removed-keys ($out)"

# 6b. the repo owns a key by being the source: a repo without permissions.allow deletes the live one (scratch copy of the repo)
r2="$base/repo2"; mkdir -p "$r2/scripts" "$r2/claude"; cp "$repo/scripts/apply.sh" "$repo/scripts/removed-keys.json" "$repo/scripts/owned-keys.json" "$r2/scripts/"; cp -R "$repo/claude/." "$r2/claude/"
jq 'del(.permissions.allow) | del(.skillOverrides)' "$repo/claude/settings.json" > "$r2/claude/settings.json"
newcfg; apply >/dev/null; jq '.permissions.allow=["Bash(*)"] | .skillOverrides={"x":"y"}' "$cfg/settings.json" > "$base/x" && cp "$base/x" "$cfg/settings.json"
HOME="$base/s$n" CLAUDE_CONFIG_DIR="$cfg" bash "$r2/scripts/apply.sh" >/dev/null 2>&1
[ "$(live '.permissions | has("allow")')" = false ] && [ "$(live 'has("skillOverrides")')" = false ] && pass "6b a key the repo lacks is deleted from the owned set" || bad "6b owned key missing in the repo stayed live"

# 6c. what else changes is reported: a repo-valued key (theme) and a forced enabledPlugins value
newcfg; apply >/dev/null
jq '.theme="light" | .enabledPlugins["ponytail@ponytail"]=false' "$cfg/settings.json" > "$base/x" && cp "$base/x" "$cfg/settings.json"
out="$(apply)"
printf '%s' "$out" | grep "replaced live value of" | grep -q "theme" && printf '%s' "$out" | grep "replaced live value of" | grep -q "enabledPlugins.ponytail@ponytail" \
  && [ "$(live .theme)" = dark ] && pass "6c replaced non-owned keys are reported too" || bad "6c report of replaced keys ($out)"

# 6d. a live settings.json that is empty counts as {}; one that is JSON but not an object is refused
newcfg; mkdir -p "$cfg"; : > "$cfg/settings.json"; out="$(apply)"
[ -s "$cfg/settings.json" ] && [ "$(live .permissions.defaultMode)" = bypassPermissions ] && pass "6d empty live settings.json is treated as {}" || bad "6d empty settings.json ($out)"
for bodytxt in '[]' '"str"' 'null' '5'; do
  newcfg; mkdir -p "$cfg"; printf '%s' "$bodytxt" > "$cfg/settings.json"
  out="$(HOME="$base/s$n" CLAUDE_CONFIG_DIR="$cfg" bash "$repo/scripts/apply.sh" 2>&1)"; rc=$?
  [ "$rc" = 1 ] && [ "$(cat "$cfg/settings.json")" = "$bodytxt" ] && [ ! -e "$cfg/CLAUDE.md" ] || bad "6d live settings.json $bodytxt: rc=$rc ($out)"
done
pass "6d JSON that is not an object is refused with exit 1 and nothing written (four shapes)"

# 6e. a repo item that is missing is found before anything is written
r3="$base/repo3"; mkdir -p "$r3/scripts" "$r3/claude"; cp "$repo/scripts/apply.sh" "$repo/scripts/removed-keys.json" "$repo/scripts/owned-keys.json" "$r3/scripts/"; cp -R "$repo/claude/." "$r3/claude/"; rm "$r3/claude/statusline.sh"
newcfg; mkdir -p "$cfg"; echo '{"keep":"me"}' > "$cfg/settings.json"; cp "$cfg/settings.json" "$base/b6e"
out="$(HOME="$base/s$n" CLAUDE_CONFIG_DIR="$cfg" bash "$r3/scripts/apply.sh" 2>&1)"; rc=$?
[ "$rc" = 2 ] && cmp -s "$base/b6e" "$cfg/settings.json" && [ ! -e "$cfg/CLAUDE.md" ] && pass "6e missing repo item: exit 2 before anything is written" || bad "6e preflight (rc=$rc; $out)"

# 7. trailing slash in the config directory
newcfg; out="$(apply "$cfg/")"
[ -f "$cfg/settings.json" ] && [ -f "$cfg/CLAUDE.md" ] && [ -z "$(find "$base/s$n" -mindepth 1 -maxdepth 1 ! -name .claude)" ] && pass "7 trailing slash: applied into the directory, nothing next to it" || bad "7 trailing slash ($out; $(ls -A "$base/s$n"))"

# 8. no jq: refuse, change nothing
newcfg; mkdir -p "$cfg"; echo '{"keep":"me"}' > "$cfg/settings.json"; cp "$cfg/settings.json" "$base/b8"
nojq="$base/nojq"; mkdir "$nojq"; for t in bash dirname cat; do ln -s "$(command -v $t)" "$nojq/$t"; done
out="$(PATH="$nojq" HOME="$base/s$n" CLAUDE_CONFIG_DIR="$cfg" "$(command -v bash)" "$repo/scripts/apply.sh" 2>&1)"; rc=$?
[ "$rc" = 2 ] && cmp -s "$base/b8" "$cfg/settings.json" && [ ! -e "$cfg/CLAUDE.md" ] && pass "8 no jq: exit 2, nothing written" || bad "8 no jq (rc=$rc; $out)"

# 9. invalid live settings.json: refuse, change nothing
newcfg; mkdir -p "$cfg"; echo '{bad' > "$cfg/settings.json"; cp "$cfg/settings.json" "$base/b9"
out="$(HOME="$base/s$n" CLAUDE_CONFIG_DIR="$cfg" bash "$repo/scripts/apply.sh" 2>&1)"; rc=$?
[ "$rc" = 1 ] && cmp -s "$base/b9" "$cfg/settings.json" && [ ! -e "$cfg/CLAUDE.md" ] && pass "9 invalid live JSON: exit 1, nothing written" || bad "9 invalid JSON (rc=$rc; $out)"

# 11. --dry-run writes nothing, reports what would change, and says unchanged once applied
newcfg; out="$(dryrun || true)"
[ ! -e "$cfg" ] && printf '%s' "$out" | grep -q "^would write: settings.json" && printf '%s' "$out" | grep -q "^dry run: nothing was written" \
  && pass "11 dry run on a fresh machine: nothing written, every item reported" || bad "11 dry run fresh ($out)"
apply >/dev/null; out="$(dryrun)"
! printf '%s' "$out" | grep -q "^would " && pass "11 dry run after apply: everything unchanged" || bad "11 dry run after apply ($out)"
echo changed >> "$cfg/agents/reviewer.md"; echo stale > "$cfg/hooks/old.sh"; echo hooks/old.sh >> "$cfg/.ai-setup-manifest"; cp "$cfg/agents/reviewer.md" "$base/b11"
echo '{"theme":"light"}' > "$base/live.json"; jq -s '.[0] * .[1]' "$cfg/settings.json" "$base/live.json" > "$base/set11" && cp "$base/set11" "$cfg/settings.json"
cp "$cfg/.ai-setup-manifest" "$base/m11"
out="$(dryrun)"
printf '%s' "$out" | grep -q "^would write: agents (1 files)" && printf '%s' "$out" | grep -q "^would remove (no longer in the repo): hooks/old.sh" \
  && cmp -s "$base/b11" "$cfg/agents/reviewer.md" && [ -f "$cfg/hooks/old.sh" ] && pass "11 dry run: names a changed file and a stale one, touches neither" || bad "11 dry run drift ($out)"
cmp -s "$base/set11" "$cfg/settings.json" && cmp -s "$base/m11" "$cfg/.ai-setup-manifest" \
  && pass "11 dry run: settings.json with a changed key and the manifest are byte for byte unchanged" || bad "11 dry run touched settings.json or the manifest"
out="$(HOME="$base/s$n" CLAUDE_CONFIG_DIR="$cfg" bash "$repo/scripts/apply.sh" --bogus 2>&1)"; rc=$?
[ "$rc" = 2 ] && pass "11 unknown argument: exit 2" || bad "11 unknown argument (rc=$rc)"

# 12. a skill dropped from the copy list: its files are reported (dry run and apply) and kept, and stay listed until removed by hand
newcfg; apply >/dev/null
mkdir -p "$cfg/skills/oldskill"; echo old > "$cfg/skills/oldskill/SKILL.md"; echo skills/oldskill/SKILL.md >> "$cfg/.ai-setup-manifest"
out="$(dryrun)"
printf '%s' "$out" | grep -q "dropped from the copy list.*skills/oldskill/SKILL.md" && pass "12 dry run names a file of a dropped skill" || bad "12 dry run dropped skill ($out)"
out="$(apply)"
printf '%s' "$out" | grep -q "dropped from the copy list.*skills/oldskill/SKILL.md" && [ -f "$cfg/skills/oldskill/SKILL.md" ] \
  && pass "12 apply names a file of a dropped skill and keeps it" || bad "12 apply dropped skill ($out)"
out="$(apply)"
printf '%s' "$out" | grep -q "dropped from the copy list.*skills/oldskill/SKILL.md" && pass "12 the report repeats until the file is removed" || bad "12 second apply ($out)"
rm "$cfg/skills/oldskill/SKILL.md"; out="$(apply)"
! printf '%s' "$out" | grep -q "oldskill" && ! grep -q oldskill "$cfg/.ai-setup-manifest" && pass "12 once removed by hand it leaves the manifest" || bad "12 after removal ($out)"

# 13. a manifest under the pre-rename name is moved once: the dry run only reports it, apply renames it and still removes stale files
old=".claude-global-manifest"  # the name apply.sh migrates from
newcfg; apply >/dev/null; cp "$cfg/.ai-setup-manifest" "$base/m13"
echo y > "$cfg/agents/stale13.md"; { cat "$base/m13"; echo agents/stale13.md; } > "$cfg/$old"; rm "$cfg/.ai-setup-manifest"; cp "$cfg/$old" "$base/o13"
out="$(dryrun)"
printf '%s' "$out" | grep -q "^would rename: $old -> .ai-setup-manifest" && printf '%s' "$out" | grep -q "^would remove (no longer in the repo): agents/stale13.md" \
  && cmp -s "$base/o13" "$cfg/$old" && [ ! -e "$cfg/.ai-setup-manifest" ] && [ -f "$cfg/agents/stale13.md" ] \
  && pass "13 dry run reports the rename and reads the old manifest, writes nothing" || bad "13 dry run migration ($out)"
out="$(apply)"
[ ! -e "$cfg/$old" ] && cmp -s "$base/m13" "$cfg/.ai-setup-manifest" && [ ! -e "$cfg/agents/stale13.md" ] \
  && printf '%s' "$out" | grep -q "^renamed: $old -> .ai-setup-manifest" && printf '%s' "$out" | grep -q "^removed (no longer in the repo): agents/stale13.md" \
  && pass "13 apply moves the old manifest to the new name and still removes stale files" || bad "13 migration ($out)"
echo agents/x.md > "$cfg/$old"; out="$(apply)"
[ "$(cat "$cfg/$old")" = agents/x.md ] && cmp -s "$base/m13" "$cfg/.ai-setup-manifest" && ! printf '%s' "$out" | grep -q "renamed" \
  && pass "13 when both exist the new manifest wins and the old one is left alone" || bad "13 both manifests ($out)"

echo "failures: $fail"
[ "$fail" -eq 0 ]
