#!/usr/bin/env bash
# Unit-test scripts/setup-claude-mem.sh on a scratch CLAUDE_MEM_DIR: no plugin, no network.
# Usage: bash scripts/qa-setup-claude-mem.sh
set -u
repo="$(cd "$(dirname "$0")/.." && pwd)"
t="$(mktemp -d)"; trap 'rm -rf "$t"' EXIT
fail=0
pass() { echo "PASS  $1"; }
bad() { echo "FAIL  $1"; fail=$((fail+1)); }
mem="$t/mem"; mkdir "$mem"
printf '{"CLAUDE_MEM_MODEL":"old","X":"1"}' > "$mem/settings.json"
run() { CLAUDE_MEM_DIR="$mem" bash "$repo/scripts/setup-claude-mem.sh" "$@" 2>&1; }
out="$(run --check)"; rc=$?
[ "$rc" = 2 ] && grep -q '"old"' "$mem/settings.json" && pass "--check reports a difference and changes nothing" || bad "--check (rc=$rc; $out)"
# a backup that cannot be made must stop the change (cp shimmed to fail)
mkdir "$t/shim"; printf '#!/bin/sh\nexit 1\n' > "$t/shim/cp"; chmod +x "$t/shim/cp"
out="$(PATH="$t/shim:$PATH" run)"; rc=$?
[ "$rc" != 0 ] && grep -q '"old"' "$mem/settings.json" && pass "a failed backup leaves settings.json unchanged" || bad "failed backup still changed the file (rc=$rc; $out)"
out="$(run)"; rc=$?
[ "$rc" = 0 ] && [ "$(jq -r .CLAUDE_MEM_REDACT_ENABLED "$mem/settings.json")" = true ] && [ "$(jq -r .X "$mem/settings.json")" = 1 ] \
  && ls "$mem"/settings.json.bak-* >/dev/null 2>&1 && pass "apply sets the two keys, keeps the rest, leaves a backup" || bad "apply (rc=$rc; $out)"
out="$(run)"; rc=$?
[ "$rc" = 0 ] && printf '%s' "$out" | grep -q "already set" && pass "second run: already set" || bad "second run (rc=$rc; $out)"

# scripts/install-plugins.sh (Windows claude-plugins module) with a stub claude that logs its calls.
# Its live settings are a temp copy, never the real ~/.claude.
mkdir "$t/cl" "$t/cfg"; log="$t/claude.log"; export CLAUDE_CONFIG_DIR="$t/cfg"
printf '{"model":"opus","env":{"KEEP":"1"}}' > "$t/cfg/settings.json"
stub() { printf '#!/bin/sh
echo "$*" >> "%s"
%s
' "$log" "$1" > "$t/cl/claude"; chmod +x "$t/cl/claude"; : > "$log"; }
# A stub python3 logs its module calls, so tokeneconomizer's pip install and config step run offline.
printf '#!/bin/sh
[ "$1" = -m ] && echo "py $*" >> "%s"
exit 0
' "$log" > "$t/cl/python3"; chmod +x "$t/cl/python3"
te_sha="$(jq -r '.extraKnownMarketplaces.tokeneconomizer.source.plugins[0].source.sha' "$repo/claude/settings.json")"
stub 'exit 0'
out="$(PATH="$t/cl:$PATH" bash "$repo/scripts/install-plugins.sh" 2>&1)"; rc=$?
want="$(printf 'plugin marketplace list
-p ok
plugin install ponytail@ponytail
plugin update ponytail@ponytail
plugin install claude-mem@thedotmack
plugin update claude-mem@thedotmack
plugin install tokeneconomizer@tokeneconomizer
plugin update tokeneconomizer@tokeneconomizer
py -m pip install --user --quiet tokeneconomizer @ git+https://github.com/microsoft/TokenEconomizer.git@%s
py -m tokeneconomizer.plugin.cli config set toolprune=propose --global' "$te_sha")"
[ "$rc" = 0 ] && [ "$(cat "$log")" = "$want" ] && pass "install-plugins: registers marketplaces, installs and updates all three, pins the core, proposes tool pruning" || bad "install-plugins order (rc=$rc; $(cat "$log"); $out)"
stub '[ "$1 $2 $3" = "plugin marketplace list" ] && echo tokeneconomizer; exit 0'
PATH="$t/cl:$PATH" bash "$repo/scripts/install-plugins.sh" >/dev/null 2>&1
[ "$(cat "$log")" = "$(printf '%s
' "$want" | grep -v '^-p ok')" ] && pass "install-plugins: no headless session when already registered, both still installed" || bad "install-plugins registered path ($(cat "$log"))"
stub '[ "$2" = install ] && exit 1; exit 0'
PATH="$t/cl:$PATH" bash "$repo/scripts/install-plugins.sh" >/dev/null 2>&1; rc=$?
[ "$rc" != 0 ] && pass "install-plugins: a failed install exits non-zero" || bad "install-plugins: failed install hidden (rc=$rc)"
# Without a usable Python (both names fail the version check) tokeneconomizer is skipped and the script still succeeds.
for n in python3 python; do printf '#!/bin/sh\nexit 1\n' > "$t/cl/$n"; chmod +x "$t/cl/$n"; done
stub 'exit 0'
out="$(PATH="$t/cl:$PATH" bash "$repo/scripts/install-plugins.sh" 2>&1)"; rc=$?
[ "$rc" = 0 ] && ! grep -q tokeneconomizer@ "$log" && grep -q 'plugin update claude-mem@thedotmack' "$log" && printf '%s' "$out" | grep -q 'tokeneconomizer: skipped' \
  && pass "install-plugins: no Python skips tokeneconomizer and exits 0" || bad "install-plugins no Python (rc=$rc; $(cat "$log"); $out)"
# A refused pip install (PEP 668) warns and exits 0 without the config step.
printf '#!/bin/sh
[ "$1" = -m ] && echo "py $*" >> "%s" && [ "$2" = pip ] && exit 1
exit 0
' "$log" > "$t/cl/python3"
out="$(PATH="$t/cl:$PATH" bash "$repo/scripts/install-plugins.sh" 2>&1)"; rc=$?
[ "$rc" = 0 ] && ! grep -q 'config set' "$log" && printf '%s' "$out" | grep -q 'pip install of its core failed' \
  && pass "install-plugins: a refused pip install warns and exits 0" || bad "install-plugins pip refused (rc=$rc; $(cat "$log"); $out)"
# The real interpreter path goes to env.TE_PYTHON in the live settings, keeping every other key.
[ "$(jq -c . "$t/cfg/settings.json")" = '{"model":"opus","env":{"KEEP":"1"}}' ] && pass "install-plugins: no interpreter path, live settings untouched" || bad "install-plugins touched settings ($(cat "$t/cfg/settings.json"))"
printf '#!/bin/sh
[ "$1" = -m ] && exit 0
case "$2" in *executable*) echo C:/py/python.exe ;; esac
exit 0
' > "$t/cl/python3"
PATH="$t/cl:$PATH" bash "$repo/scripts/install-plugins.sh" >/dev/null 2>&1; rc=$?
[ "$rc" = 0 ] && [ "$(jq -c . "$t/cfg/settings.json")" = '{"model":"opus","env":{"KEEP":"1","TE_PYTHON":"C:/py/python.exe"}}' ] \
  && pass "install-plugins: sets env.TE_PYTHON and keeps the rest" || bad "install-plugins TE_PYTHON (rc=$rc; $(cat "$t/cfg/settings.json"))"
echo "failures: $fail"
[ "$fail" -eq 0 ]
