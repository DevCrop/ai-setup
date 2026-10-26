#!/usr/bin/env bash
# Test bootstrap/setup-mac.sh on Linux with stub tools and a scratch HOME: no network, nothing installed.
# Usage: bash scripts/qa-setup-mac.sh
set -u
repo="$(cd "$(dirname "$0")/.." && pwd)"
s="$repo/bootstrap/setup-mac.sh"
t="$(mktemp -d)"; trap 'rm -rf "$t"' EXIT
fail=0
pass() { echo "PASS  $1"; }
bad() { echo "FAIL  $1"; fail=$((fail+1)); }

# A bin dir with only the core utils the script needs, so git/jq/node/rtk/claude/brew/curl count as missing.
mkdir "$t/core"
for c in bash uname dirname head grep mkdir cat; do ln -s "$(command -v "$c")" "$t/core/$c"; done

out="$(AI_SETUP_UNAME=Linux bash "$s" 2>&1)"; rc=$?
[ "$rc" = 2 ] && printf '%s' "$out" | grep -q "setup.ps1" && pass "not macOS: exit 2, points to setup.ps1" || bad "non-mac guard (rc=$rc; $out)"

out="$(bash "$s" --bogus 2>&1)"; rc=$?
[ "$rc" = 2 ] && pass "unknown option: exit 2" || bad "unknown option (rc=$rc)"

# Fresh Mac, dry run: every step planned, nothing written.
mkdir "$t/h1"
out="$(HOME="$t/h1" PATH="$t/core" AI_SETUP_UNAME=Darwin "$t/core/bash" "$s" --dry-run 2>&1)"; rc=$?
[ "$rc" = 0 ] && [ -z "$(ls -A "$t/h1")" ] && pass "fresh dry run: exit 0, HOME untouched" || bad "fresh dry run (rc=$rc; $(ls -A "$t/h1"); $out)"
ok=1
for p in "/bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\"" "brew install git" "brew install jq" "brew install node" "brew install rtk" \
         "curl -fsSL https://claude.ai/install.sh | bash" "git clone https://github.com/DevCrop/ai-setup.git $t/h1/project/ai-setup" \
         "claude plugin install ponytail@ponytail" "claude plugin install claude-mem@thedotmack"; do
  printf '%s' "$out" | grep -qF "[dry-run] $p" || { ok=0; echo "  missing: $p"; }
done
[ "$ok" = 1 ] && pass "fresh dry run lists brew, the four tools, claude, clone and both plugins" || bad "fresh dry run plan ($out)"
out_b="$(HOME="$t/h1" PATH="$t/core" AI_SETUP_UNAME=Darwin AI_SETUP_BRANCH=feat/x "$t/core/bash" "$s" --dry-run 2>&1)"
printf '%s' "$out_b" | grep -qF "[dry-run] git clone -b feat/x https://github.com/DevCrop/ai-setup.git" && pass "AI_SETUP_BRANCH clones that branch" || bad "AI_SETUP_BRANCH ($out_b)"
printf '%s' "$out" | grep -qE '^[a-z@-]+ +ok ' && bad "fresh dry run reports a planned step as ok ($out)" || pass "fresh dry run reports no step as ok"

# Set-up Mac, real run: stubs for brew/rtk/claude/curl/node, real git and jq, a local clone as the repo.
mkdir -p "$t/stub" "$t/h2/project" "$t/mem"
log="$t/calls.log"
for c in brew node rtk claude curl; do printf '#!/bin/sh\necho "%s $*" >> "%s"\n' "$c" "$log" > "$t/stub/$c"; chmod +x "$t/stub/$c"; done
# Origin is a one-commit snapshot of HEAD on branch main: CI checks out a shallow, detached merge ref, which can be
# neither pushed nor pulled with --ff-only. Everything stays offline; a missing fixture stops the test so the
# script under test never falls back to cloning from GitHub.
mkdir "$t/origin" && git -C "$repo" archive HEAD | tar -x -C "$t/origin" \
  && git -C "$t/origin" init -q -b main && git -C "$t/origin" add -A \
  && git -C "$t/origin" -c user.name=qa -c user.email=qa@example.invalid commit -q -m snapshot \
  && git clone -q -b main "$t/origin" "$t/h2/project/ai-setup" || { bad "could not build the clone fixture"; echo "failures: $fail"; exit 1; }
printf '{"CLAUDE_MEM_MODEL":"old"}' > "$t/mem/settings.json"
run2() { HOME="$t/h2" CLAUDE_CONFIG_DIR="$t/h2/.claude" CLAUDE_MEM_DIR="$t/mem" PATH="$t/stub:$PATH" AI_SETUP_UNAME=Darwin bash "$s" "$@" 2>&1; }
# Set-up Mac, dry run first: the case where apply, git status and claude-mem could write.
idx="$(cksum < "$t/h2/project/ai-setup/.git/index")"; head0="$(git -C "$t/h2/project/ai-setup" rev-parse HEAD)"
out="$(run2 --dry-run)"; rc=$?
[ "$rc" = 0 ] && [ ! -e "$t/h2/.claude" ] && [ ! -e "$t/h2/.zprofile" ] && [ "$(jq -r .CLAUDE_MEM_MODEL "$t/mem/settings.json")" = old ] \
  && [ "$idx" = "$(cksum < "$t/h2/project/ai-setup/.git/index")" ] && [ "$head0" = "$(git -C "$t/h2/project/ai-setup" rev-parse HEAD)" ] \
  && ! grep -qE "install|^curl" "$log" 2>/dev/null && pass "set-up dry run: exit 0, writes nothing, installs nothing" || bad "set-up dry run (rc=$rc; $out)"
out="$(run2)"; rc=$?
[ "$rc" = 0 ] && [ -f "$t/h2/.claude/settings.json" ] && [ -f "$t/h2/.claude/CLAUDE.md" ] && pass "set-up Mac: exit 0, apply wrote ~/.claude" || bad "set-up run (rc=$rc; $out)"
grep -q "claude plugin install ponytail@ponytail" "$log" && grep -q "claude plugin install claude-mem@thedotmack" "$log" \
  && pass "both plugins installed through claude" || bad "plugin calls ($(cat "$log"))"
grep -q "^brew install" "$log" || grep -q "^curl" "$log" && bad "installed a tool that was already there ($(cat "$log"))" || pass "tools already on PATH are not reinstalled"
[ "$(jq -r .CLAUDE_MEM_REDACT_ENABLED "$t/mem/settings.json")" = true ] && pass "claude-mem settings applied" || bad "claude-mem settings"

# Local changes in the clone: not pulled, still applied.
echo x >> "$t/h2/project/ai-setup/README.md"
out="$(run2)"; rc=$?
printf '%s' "$out" | grep -q "has local changes; not pulled" && pass "a dirty clone is not pulled" || bad "dirty clone (rc=$rc; $out)"

# A clean clone on a branch with no upstream: not pulled, not a failure.
git -C "$t/h2/project/ai-setup" checkout -q -- README.md && git -C "$t/h2/project/ai-setup" checkout -q -b local-only
out="$(run2)"; rc=$?
[ "$rc" = 0 ] && printf '%s' "$out" | grep -q "no upstream branch; not pulled" && pass "a branch without upstream is not pulled, exit 0" || bad "no upstream (rc=$rc; $out)"

# A failed step makes the exit code 1.
printf '#!/bin/sh\nexit 1\n' > "$t/stub/claude"
out="$(run2)"; rc=$?
[ "$rc" = 1 ] && printf '%s' "$out" | grep -qE "ponytail@ponytail +failed" && pass "a failed plugin install: exit 1, row says failed" || bad "failure exit (rc=$rc; $out)"

echo "failures: $fail"
[ "$fail" -eq 0 ]
