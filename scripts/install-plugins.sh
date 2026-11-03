#!/usr/bin/env bash
# Install ponytail, claude-mem and tokeneconomizer at the versions claude/settings.json pins (Windows bootstrap: modules.json
# claude-plugins). Run after apply.sh. Same steps as the plugin part of bootstrap/setup-mac.sh, which does not install
# tokeneconomizer yet. Needs a logged-in claude, and jq and Python 3.10+ for tokeneconomizer.
# tokeneconomizer is optional: if its Python or pip step fails it is skipped with a warning and the script still succeeds, so the
# bootstrap steps after it (setup-claude-mem.sh) run. Its hooks fail open, so an enabled plugin without its core is inert.
set -eu
repo=$(cd "$(dirname "$0")/.." && pwd)
py=
# Homebrew's Python can sit behind an older /usr/bin/python3 on PATH, so its usual paths are tried last.
for c in python3 python ${AI_SETUP_BREW_PYTHONS:-/opt/homebrew/bin/python3 /usr/local/bin/python3}; do
  if command -v "$c" >/dev/null 2>&1 && "$c" -c 'import sys; sys.exit(sys.version_info < (3, 10))' 2>/dev/null; then py=$c; break; fi
done
plugins="ponytail@ponytail claude-mem@thedotmack"
if [ -n "$py" ]; then plugins="$plugins tokeneconomizer@tokeneconomizer"; else echo "tokeneconomizer: skipped, Python 3.10+ not found" >&2; fi
# Marketplaces declared in settings.json register, and their pins refresh, only when a session starts. Until then
# `plugin install` reports "not found in marketplace" and `plugin update` "already at the latest version" on the old pin.
# One one-word headless session does it (a few tokens); it is skipped only when the registered copies already match.
jq -e --slurpfile k "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plugins/known_marketplaces.json" \
  '.extraKnownMarketplaces | to_entries | all(.value.source == $k[0][.key].source)' "$repo/claude/settings.json" >/dev/null 2>&1 \
  || claude -p ok >/dev/null 2>&1 || true
for p in $plugins; do
  claude plugin install "$p"
  claude plugin update "$p" # install leaves an older copy alone; update moves it to the pinned version
done
[ -n "$py" ] || exit 0
# The plugin copy holds only the repo's plugin/ folder; its Python core is pip-installed from the same pinned commit.
te_sha=$(jq -r '.extraKnownMarketplaces.tokeneconomizer.source.plugins[0].source.sha' "$repo/claude/settings.json")
case $te_sha in [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]*) ;; *) echo "tokeneconomizer: no pinned sha in claude/settings.json" >&2; exit 1 ;; esac
te_pkg="tokeneconomizer @ git+https://github.com/microsoft/TokenEconomizer.git@$te_sha"
# A Homebrew or system Python refuses --user installs (PEP 668), so the core then goes to a private venv; TE_PYTHON below names it.
# It is recreated only when its pip stopped working (a brew upgrade of Python removes the interpreter it links to, or an earlier creation stopped halfway).
# shortcut: only the Mac and Linux venv layout (bin/python), upgrade if a Windows Python ever refuses --user.
# Any other pip failure shows pip's own error. Either way a failure only leaves tokeneconomizer inactive.
if ! pip_err=$("$py" -m pip install --user --quiet "$te_pkg" 2>&1); then
  venv="$HOME/.tokeneconomizer/venv"
  case $pip_err in
    *externally-managed-environment*)
      if { "$venv/bin/python" -m pip --version >/dev/null 2>&1 || "$py" -m venv --clear "$venv"; } && "$venv/bin/python" -m pip install --quiet "$te_pkg"; then
        py="$venv/bin/python"
      else
        echo "tokeneconomizer: pip install of its core failed; its hooks stay inactive" >&2; exit 0
      fi ;;
    *) printf '%s\n' "$pip_err" >&2; echo "tokeneconomizer: pip install of its core failed; its hooks stay inactive" >&2; exit 0 ;;
  esac
fi
# Tool pruning only proposes deny rules (applied with /tokeneconomizer:toolprune apply); the repo's own deny rules cover secret files only.
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
