#!/usr/bin/env bash
# Scenario tests for scripts/apply.sh and the settings part of verify.sh --live. No model calls, no network.
# Every run happens in a scratch directory: HOME and CLAUDE_CONFIG_DIR both point under it, and the script refuses to start when the
# target is not under that directory (verify.sh runs this on real machines where CLAUDE_CONFIG_DIR may be set).
# Usage: bash scripts/qa-apply.sh
set -u
export QA_APPLY_RUNNING=1  # verify.sh skips its own qa-apply step when called from here (no recursion)
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
live() { jq -r "$1" "$cfg/settings.json"; }
sorted() { jq -S . "$1"; }

# 1. fresh machine: everything is applied and settings.json equals the repo
newcfg; out="$(apply)"
[ -f "$cfg/hooks/secret-guard.sh" ] && [ -f "$cfg/agents/reviewer.md" ] && [ -f "$cfg/.claude-global-manifest" ] \
  && [ "$(sorted "$cfg/settings.json")" = "$(sorted "$repo/claude/settings.json")" ] \
  && pass "1 fresh install: files, manifest and settings equal the repo" || bad "1 fresh install ($out)"
if ! printf '%s' "$out" | grep -qi "backup"; then pass "1 no backup is made"; else bad "1 apply mentions a backup"; fi
ls -d "$base"/s1/*backup* "$base"/s1/.claude-backup* >/dev/null 2>&1 && bad "1 a backup directory exists" || pass "1 no backup directory exists"

# 2. second run changes nothing and reports nothing to fix
cp "$cfg/settings.json" "$base/before.json"; cp "$cfg/.claude-global-manifest" "$base/before.manifest"
out="$(apply)"
cmp -s "$base/before.json" "$cfg/settings.json" && cmp -s "$base/before.manifest" "$cfg/.claude-global-manifest" \
  && ! printf '%s' "$out" | grep -qE "^(settings.json: |removed|kept)" && pass "2 second run is idempotent and quiet" || bad "2 second run changed something: $out"

# 3. stale file from an earlier apply is removed; a user file and a tampered manifest line are not
mkdir -p "$base/outside" "$cfg/projects" "$base/s$n/outside"; echo keep > "$base/outside/victim"; echo keep > "$base/s$n/outside/victim2"; echo keep > "$cfg/projects/x.jsonl"
echo y > "$cfg/agents/old-agent.md"; echo y > "$cfg/agents/mine.md"
# manifest lines that must never delete anything: parent traversal, an absolute path, and a real file outside the managed items
{ cat "$cfg/.claude-global-manifest"; echo "agents/old-agent.md"; echo "../outside/victim"; echo "agents/../../outside/victim2"; echo "/etc/hostname"; echo "projects/x.jsonl"; } > "$base/m"; cp "$base/m" "$cfg/.claude-global-manifest"
out="$(apply)"
[ ! -e "$cfg/agents/old-agent.md" ] && [ -e "$cfg/agents/mine.md" ] && [ -e "$base/outside/victim" ] && [ -e "$base/s$n/outside/victim2" ] && [ -e "$cfg/projects/x.jsonl" ] \
  && printf '%s' "$out" | grep -q "kept (not from this repo): agents/mine.md" \
  && printf '%s' "$out" | grep -q "removed (no longer in the repo): agents/old-agent.md" \
  && pass "3 stale file removed; user file kept and reported; unsafe manifest lines ignored" || bad "3 stale handling ($out)"

# 4. machine-only keys survive and are reported
newcfg; apply >/dev/null
jq '.enabledPlugins["foo@bar"]=true | .env={"X":"1"} | .someAppKey="v"' "$cfg/settings.json" > "$base/x" && cp "$base/x" "$cfg/settings.json"
out="$(apply)"
[ "$(live '.enabledPlugins["foo@bar"]')" = true ] && [ "$(live .env.X)" = 1 ] && [ "$(live .someAppKey)" = v ] \
  && printf '%s' "$out" | grep -q "kept machine-only" && pass "4 machine-only keys kept and reported" || bad "4 machine-only keys ($out)"

# 5. rules added by hand do not survive: allow, autoMode.allow, an extra hook event, an extra marketplace, changed values
jq '.permissions.allow=["Bash(*)"] | .permissions.deny=["Bash(ls)"] | .autoMode.allow=["x"] | .hooks.Stop=[{"hooks":[{"type":"command","command":"x"}]}]
    | .extraKnownMarketplaces.evil={"source":{"source":"github","repo":"evil/evil"}} | .permissions.defaultMode="bypassPermissions" | .skillOverrides={}' "$cfg/settings.json" > "$base/x" && cp "$base/x" "$cfg/settings.json"
out="$(apply)"
if [ "$(sorted "$cfg/settings.json" | jq -c '[.permissions.allow, (.autoMode|has("allow")), (.hooks|has("Stop")), (.extraKnownMarketplaces|has("evil")), .permissions.defaultMode]')" = '[[],false,false,false,"auto"]' ] \
   && [ "$(live '.permissions.deny|length')" = "$(jq '.permissions.deny|length' "$repo/claude/settings.json")" ] \
   && [ "$(live '.skillOverrides["auto-mode-setup"]')" = off ] && printf '%s' "$out" | grep -q "replaced live value of"; then
  pass "5 hand-added allow/autoMode/hook/marketplace/mode are replaced by the repo values and reported"
else bad "5 owned keys not restored ($out)"; fi

# 6. keys listed in scripts/removed-keys.json are deleted
jq '.enabledPlugins["superpowers@claude-plugins-official"]=true | .skipDangerousModePermissionPrompt=true' "$cfg/settings.json" > "$base/x" && cp "$base/x" "$cfg/settings.json"
out="$(apply)"
[ "$(live '.enabledPlugins | has("superpowers@claude-plugins-official")')" = false ] && [ "$(live 'has("skipDangerousModePermissionPrompt")')" = false ] \
  && printf '%s' "$out" | grep -q "removed from settings.json" && pass "6 removed-keys are deleted and reported" || bad "6 removed-keys ($out)"

# 6b. the repo owns a key by being the source: a repo without permissions.allow deletes the live one (scratch copy of the repo)
r2="$base/repo2"; mkdir -p "$r2/scripts" "$r2/claude"; cp "$repo/scripts/apply.sh" "$repo/scripts/removed-keys.json" "$r2/scripts/"; cp -R "$repo/claude/." "$r2/claude/"
jq 'del(.permissions.allow) | del(.skillOverrides)' "$repo/claude/settings.json" > "$r2/claude/settings.json"
newcfg; apply >/dev/null; jq '.permissions.allow=["Bash(*)"] | .skillOverrides={"x":"y"}' "$cfg/settings.json" > "$base/x" && cp "$base/x" "$cfg/settings.json"
HOME="$base/s$n" CLAUDE_CONFIG_DIR="$cfg" bash "$r2/scripts/apply.sh" >/dev/null 2>&1
[ "$(live '.permissions | has("allow")')" = false ] && [ "$(live 'has("skillOverrides")')" = false ] && pass "6b a key the repo lacks is deleted from the owned set" || bad "6b owned key missing in the repo stayed live"

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

# 10. verify.sh --live compares only the repo-owned keys: machine-only keys are fine, a changed owned key is a WARN
newcfg; apply >/dev/null
jq '.enabledPlugins["foo@bar"]=true | .env={"X":"1"}' "$cfg/settings.json" > "$base/x" && cp "$base/x" "$cfg/settings.json"
v="$(HOME="$base/s$n" CLAUDE_CONFIG_DIR="$cfg" bash "$repo/scripts/verify.sh" --live 2>&1)"
printf '%s' "$v" | grep -q "^PASS  in sync: settings.json" && ! printf '%s' "$v" | grep -qE "^(FAIL|WARN)  .*settings\.json" \
  && printf '%s' "$v" | grep -q "^INFO  machine-only settings.json keys" && pass "10 verify --live: machine-only keys are INFO, owned keys in sync" || bad "10 verify --live with machine-only keys ($(printf '%s' "$v" | grep -i settings))"
jq '.permissions.allow=["Bash(*)"] | .autoMode.environment=["only mine"]' "$cfg/settings.json" > "$base/x" && cp "$base/x" "$cfg/settings.json"
v="$(HOME="$base/s$n" CLAUDE_CONFIG_DIR="$cfg" bash "$repo/scripts/verify.sh" --live 2>&1)"
printf '%s' "$v" | grep -E "^WARN  settings.json differs" | grep -q "permissions.allow" && printf '%s' "$v" | grep -E "^WARN  settings.json differs" | grep -q "autoMode" && pass "10 verify --live: a hand-edited owned key is a WARN naming the key" || bad "10 verify --live drift WARN ($(printf '%s' "$v" | grep -i 'settings'))"
jq '.enabledPlugins["superpowers@claude-plugins-official"]=true' "$cfg/settings.json" > "$base/x" && cp "$base/x" "$cfg/settings.json"
v="$(HOME="$base/s$n" CLAUDE_CONFIG_DIR="$cfg" bash "$repo/scripts/verify.sh" --live 2>&1)"
printf '%s' "$v" | grep -q "^WARN  settings.json still has keys that scripts/removed-keys.json deletes" && pass "10 verify --live: a removed key still present is a WARN" || bad "10 verify --live removed-key WARN"

echo "failures: $fail"
[ "$fail" -eq 0 ]
