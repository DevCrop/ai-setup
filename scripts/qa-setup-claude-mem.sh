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
mkdir "$t/cl" "$t/cfg" "$t/home"; log="$t/claude.log"; export CLAUDE_CONFIG_DIR="$t/cfg"
export HOME="$t/home" # the venv fallback must never reach the real home
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
want="$(printf -- '-p ok
plugin install ponytail@ponytail
plugin update ponytail@ponytail
plugin install claude-mem@thedotmack
plugin update claude-mem@thedotmack
plugin install tokeneconomizer@tokeneconomizer
plugin update tokeneconomizer@tokeneconomizer
py -m pip install --user --quiet tokeneconomizer @ git+https://github.com/microsoft/TokenEconomizer.git@%s
py -m tokeneconomizer.plugin.cli config set toolprune=propose --global' "$te_sha")"
[ "$rc" = 0 ] && [ "$(cat "$log")" = "$want" ] && pass "install-plugins: registers marketplaces, installs and updates all three, pins the core, proposes tool pruning" || bad "install-plugins order (rc=$rc; $(cat "$log"); $out)"
mkdir "$t/cfg/plugins"; known="$t/cfg/plugins/known_marketplaces.json"
jq .extraKnownMarketplaces "$repo/claude/settings.json" > "$known"
stub 'exit 0'
PATH="$t/cl:$PATH" bash "$repo/scripts/install-plugins.sh" >/dev/null 2>&1
[ "$(cat "$log")" = "$(printf '%s
' "$want" | grep -v '^-p ok')" ] && pass "install-plugins: no headless session when the registered pins match, all still installed" || bad "install-plugins registered path ($(cat "$log"))"
# A bumped pin stays unseen by `plugin update` ("already at the latest") until a session refreshes the registered copy.
jq '.ponytail.source.plugins[0].source.sha = "old"' "$known" > "$known.x" && mv "$known.x" "$known"
stub 'exit 0'
PATH="$t/cl:$PATH" bash "$repo/scripts/install-plugins.sh" >/dev/null 2>&1
[ "$(cat "$log")" = "$want" ] && pass "install-plugins: a pin differing from the registered copy opens a session before updating" || bad "install-plugins stale pin ($(cat "$log"))"
rm -f "$known"
stub '[ "$2" = install ] && exit 1; exit 0'
PATH="$t/cl:$PATH" bash "$repo/scripts/install-plugins.sh" >/dev/null 2>&1; rc=$?
[ "$rc" != 0 ] && pass "install-plugins: a failed install exits non-zero" || bad "install-plugins: failed install hidden (rc=$rc)"
# Without a usable Python (both names fail the version check) tokeneconomizer is skipped and the script still succeeds.
for n in python3 python; do printf '#!/bin/sh\nexit 1\n' > "$t/cl/$n"; chmod +x "$t/cl/$n"; done
stub 'exit 0'
export AI_SETUP_BREW_PYTHONS=/nonexistent # a real Homebrew Python on this machine must not count
out="$(PATH="$t/cl:$PATH" bash "$repo/scripts/install-plugins.sh" 2>&1)"; rc=$?
[ "$rc" = 0 ] && ! grep -q tokeneconomizer@ "$log" && grep -q 'plugin update claude-mem@thedotmack' "$log" && printf '%s' "$out" | grep -q 'tokeneconomizer: skipped' \
  && pass "install-plugins: no Python skips tokeneconomizer and exits 0" || bad "install-plugins no Python (rc=$rc; $(cat "$log"); $out)"
# A pip failure that is not PEP 668 shows pip's error, warns and exits 0, with no venv and no config step.
printf '#!/bin/sh
[ "$1" = -m ] && echo "py $*" >> "%s" && [ "$2" = pip ] && { echo "ERROR: could not reach the index" >&2; exit 1; }
exit 0
' "$log" > "$t/cl/python3"
out="$(PATH="$t/cl:$PATH" bash "$repo/scripts/install-plugins.sh" 2>&1)"; rc=$?
[ "$rc" = 0 ] && ! grep -q 'config set' "$log" && ! grep -q -- '-m venv' "$log" && [ ! -e "$t/home/.tokeneconomizer" ] && printf '%s' "$out" | grep -q 'pip install of its core failed' \
  && printf '%s' "$out" | grep -q 'could not reach the index' \
  && pass "install-plugins: a failed pip install shows its error, warns and exits 0" || bad "install-plugins pip failed (rc=$rc; $(cat "$log"); $out)"
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
# Unreadable live settings, or a mv that fails: warn, leave the file and no temp copy, exit 0.
printf '{bad' > "$t/cfg/settings.json"
out="$(PATH="$t/cl:$PATH" bash "$repo/scripts/install-plugins.sh" 2>&1)"; rc=$?
[ "$rc" = 0 ] && [ "$(cat "$t/cfg/settings.json")" = '{bad' ] && ! ls "$t/cfg"/*.te.* >/dev/null 2>&1 && printf '%s' "$out" | grep -q 'TE_PYTHON not set' \
  && pass "install-plugins: bad live settings are left alone" || bad "install-plugins bad settings (rc=$rc; $out)"
printf '{}' > "$t/cfg/settings.json"; printf '#!/bin/sh\nexit 1\n' > "$t/cl/mv"; chmod +x "$t/cl/mv"
out="$(PATH="$t/cl:$PATH" bash "$repo/scripts/install-plugins.sh" 2>&1)"; rc=$?
rm -f "$t/cl/mv"
[ "$rc" = 0 ] && [ "$(cat "$t/cfg/settings.json")" = '{}' ] && ! ls "$t/cfg"/*.te.* >/dev/null 2>&1 \
  && pass "install-plugins: a failed mv exits 0 and cleans up" || bad "install-plugins mv fail (rc=$rc; $out)"
# Homebrew Python (PEP 668): --user is refused, so the core goes to a private venv and TE_PYTHON names its interpreter.
# Matched by suffix: Git Bash rewrites the /tmp path it passes to jq.exe into C:/... form.
printf '#!/bin/sh
[ "$1" = -m ] && echo "venv $*" >> "%s" && exit 0
case "$2" in *executable*) echo "$0" ;; esac
exit 0
' "$log" > "$t/venvpy"; chmod +x "$t/venvpy"
printf '#!/bin/sh
[ "$1" = -m ] && echo "py $*" >> "%s"
[ "$1 $2" = "-m pip" ] && { echo "error: externally-managed-environment" >&2; exit 1; }
[ "$1 $2" = "-m venv" ] && [ -z "${VENV_FAILS:-}" ] && mkdir -p "$4/bin" && rm -f "$4/bin/python" && cp "%s" "$4/bin/python"
[ "$1 $2" = "-m venv" ] && [ -n "${VENV_FAILS:-}" ] && exit 1
exit 0
' "$log" "$t/venvpy" > "$t/cl/python3"
# A venv that cannot be created warns and exits 0, with the live settings untouched.
printf '{"k":1}' > "$t/cfg/settings.json"; : > "$log"
out="$(VENV_FAILS=1 PATH="$t/cl:$PATH" bash "$repo/scripts/install-plugins.sh" 2>&1)"; rc=$?
[ "$rc" = 0 ] && ! grep -q 'config set' "$log" && [ "$(jq -c . "$t/cfg/settings.json")" = '{"k":1}' ] && printf '%s' "$out" | grep -q 'pip install of its core failed' \
  && pass "install-plugins: a venv that cannot be created warns and exits 0" || bad "install-plugins venv create fail (rc=$rc; $(cat "$log"); $out)"
printf '{}' > "$t/cfg/settings.json"; : > "$log"
out="$(PATH="$t/cl:$PATH" bash "$repo/scripts/install-plugins.sh" 2>&1)"; rc=$?
venv="$t/home/.tokeneconomizer/venv"
[ "$rc" = 0 ] && grep -qF "py -m venv --clear $venv" "$log" \
  && grep -qF "venv -m pip install --quiet tokeneconomizer @ git+https://github.com/microsoft/TokenEconomizer.git@$te_sha" "$log" \
  && grep -q '^venv -m tokeneconomizer.plugin.cli config set toolprune=propose --global' "$log" \
  && jq -r .env.TE_PYTHON "$t/cfg/settings.json" | grep -q '/home/.tokeneconomizer/venv/bin/python' && ! printf '%s' "$out" | grep -q 'failed' \
  && pass "install-plugins: a refused --user install falls back to a private venv" || bad "install-plugins venv fallback (rc=$rc; $(cat "$log"); $out)"
# A working venv is reused; one whose interpreter stopped working (Python upgraded) is recreated.
: > "$log"
PATH="$t/cl:$PATH" bash "$repo/scripts/install-plugins.sh" >/dev/null 2>&1; rc=$?
[ "$rc" = 0 ] && ! grep -q -- '-m venv' "$log" && grep -q '^venv -m pip install' "$log" \
  && pass "install-plugins: a working venv is reused" || bad "install-plugins venv reuse (rc=$rc; $(cat "$log"))"
printf '#!/bin/sh\nexit 1\n' > "$venv/bin/python"; : > "$log"
PATH="$t/cl:$PATH" bash "$repo/scripts/install-plugins.sh" >/dev/null 2>&1; rc=$?
[ "$rc" = 0 ] && grep -qF "py -m venv --clear $venv" "$log" && grep -q '^venv -m pip install' "$log" \
  && pass "install-plugins: a broken venv is recreated" || bad "install-plugins broken venv (rc=$rc; $(cat "$log"))"
# A venv left without pip by an interrupted creation: the interpreter runs, pip does not.
printf '#!/bin/sh\n[ "$1" = -m ] && exit 1\nexit 0\n' > "$venv/bin/python"; : > "$log"
PATH="$t/cl:$PATH" bash "$repo/scripts/install-plugins.sh" >/dev/null 2>&1; rc=$?
[ "$rc" = 0 ] && grep -qF "py -m venv --clear $venv" "$log" && grep -q '^venv -m pip install' "$log" \
  && pass "install-plugins: a venv without pip is recreated" || bad "install-plugins venv without pip (rc=$rc; $(cat "$log"))"
# /usr/bin/python3 is too old and comes first on PATH; the Homebrew Python is still found.
for n in python3 python; do printf '#!/bin/sh\nexit 1\n' > "$t/cl/$n"; chmod +x "$t/cl/$n"; done
mkdir "$t/brew"; printf '#!/bin/sh
[ "$1" = -m ] && echo "brew $*" >> "%s"
exit 0
' "$log" > "$t/brew/python3"; chmod +x "$t/brew/python3"; : > "$log"
out="$(AI_SETUP_BREW_PYTHONS="/nonexistent $t/brew/python3" PATH="$t/cl:$PATH" bash "$repo/scripts/install-plugins.sh" 2>&1)"; rc=$?
[ "$rc" = 0 ] && grep -q '^brew -m pip install --user' "$log" && grep -q 'plugin update tokeneconomizer@tokeneconomizer' "$log" \
  && pass "install-plugins: finds a Homebrew Python that is not first on PATH" || bad "install-plugins Homebrew lookup (rc=$rc; $(cat "$log"); $out)"
echo "failures: $fail"
[ "$fail" -eq 0 ]
