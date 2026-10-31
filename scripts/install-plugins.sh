#!/usr/bin/env bash
# Install ponytail, claude-mem and tokeneconomizer at the versions claude/settings.json pins (Windows bootstrap: modules.json
# claude-plugins). Run after apply.sh. Same steps as the plugin part of bootstrap/setup-mac.sh, which does not install
# tokeneconomizer yet. Needs a logged-in claude, and jq and Python 3.10+ for tokeneconomizer.
# tokeneconomizer is optional: without Python or pip it is skipped with a warning and the script still succeeds, so the
# bootstrap steps after it (setup-claude-mem.sh) run. Its hooks fail open, so an enabled plugin without its core is inert.
set -eu
repo=$(cd "$(dirname "$0")/.." && pwd)
py=
for c in python3 python; do
  if command -v "$c" >/dev/null 2>&1 && "$c" -c 'import sys; sys.exit(sys.version_info < (3, 10))' 2>/dev/null; then py=$c; break; fi
done
plugins="ponytail@ponytail claude-mem@thedotmack"
if [ -n "$py" ]; then plugins="$plugins tokeneconomizer@tokeneconomizer"; else echo "tokeneconomizer: skipped, Python 3.10+ not found" >&2; fi
# Marketplaces declared in settings.json register only when a session starts, and `plugin install` alone reports
# "not found in marketplace". One one-word headless session registers them (a few tokens).
claude plugin marketplace list 2>/dev/null | grep -q tokeneconomizer || claude -p ok >/dev/null 2>&1 || true
for p in $plugins; do
  claude plugin install "$p"
  claude plugin update "$p" # install leaves an older copy alone; update moves it to the pinned version
done
[ -n "$py" ] || exit 0
# The plugin copy holds only the repo's plugin/ folder; its Python core is pip-installed from the same pinned commit.
te_sha=$(jq -r '.extraKnownMarketplaces.tokeneconomizer.source.plugins[0].source.sha' "$repo/claude/settings.json")
case $te_sha in [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]*) ;; *) echo "tokeneconomizer: no pinned sha in claude/settings.json" >&2; exit 1 ;; esac
# A Homebrew or system Python may refuse --user installs (PEP 668); that only leaves tokeneconomizer inactive.
if ! "$py" -m pip install --user --quiet "tokeneconomizer @ git+https://github.com/microsoft/TokenEconomizer.git@$te_sha"; then
  echo "tokeneconomizer: pip install of its core failed; its hooks stay inactive" >&2; exit 0
fi
# Tool pruning only proposes deny rules (applied with /tokeneconomizer:toolprune apply); the repo keeps no deny rules.
"$py" -m tokeneconomizer.plugin.cli config set toolprune=propose --global \
  || echo "tokeneconomizer: could not set toolprune=propose; run /tokeneconomizer:config set toolprune=propose --global" >&2
# Its hook launcher probes each candidate Python before use; on Windows `python3` is a WindowsApps alias and the probe
# costs ~0.2 s on every hook call (measured 456 -> 292 ms per tool call). TE_PYTHON names the real interpreter once, as
# a machine-only env value in the live settings (apply.sh keeps it); a stale path just falls back to the probe.
# Nothing below may stop the script: a failure only leaves TE_PYTHON unset. PYTHONUTF8 keeps a non-ASCII path intact.
exe=$(PYTHONUTF8=1 "$py" -c 'import sys; print(sys.executable)' 2>/dev/null | tr -d '\r') || exe=
case $exe in *\\*) { command -v cygpath >/dev/null 2>&1 && exe=$(cygpath -m "$exe"); } || exe= ;; esac
live="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json"
if [ -n "$exe" ] && [ -f "$live" ]; then
  tmp="$live.te.$$"
  if ! { jq --arg p "$exe" '.env.TE_PYTHON = $p' "$live" > "$tmp" && mv "$tmp" "$live"; }; then
    rm -f "$tmp"; echo "tokeneconomizer: TE_PYTHON not set" >&2
  fi
fi
