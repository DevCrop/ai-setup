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
echo "failures: $fail"
[ "$fail" -eq 0 ]
