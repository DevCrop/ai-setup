#!/usr/bin/env bash
# Install ponytail, claude-mem and tokeneconomizer at the versions claude/settings.json pins (Windows bootstrap: modules.json
# claude-plugins). Run after apply.sh. Same steps as the plugin part of bootstrap/setup-mac.sh, which does not install
# tokeneconomizer yet. Needs a logged-in claude, and jq and Python 3.10+ for tokeneconomizer.
set -eu
repo=$(cd "$(dirname "$0")/.." && pwd)
# Marketplaces declared in settings.json register only when a session starts, and `plugin install` alone reports
# "not found in marketplace". One one-word headless session registers them (a few tokens).
claude plugin marketplace list 2>/dev/null | grep -q tokeneconomizer || claude -p ok >/dev/null 2>&1 || true
for p in ponytail@ponytail claude-mem@thedotmack tokeneconomizer@tokeneconomizer; do
  claude plugin install "$p"
  claude plugin update "$p" # install leaves an older copy alone; update moves it to the pinned version
done
# The plugin copy holds only the repo's plugin/ folder; its Python core is pip-installed from the same pinned commit.
te_sha=$(jq -r '.extraKnownMarketplaces.tokeneconomizer.source.plugins[0].source.sha' "$repo/claude/settings.json")
py=
for c in python3 python; do
  if command -v "$c" >/dev/null 2>&1 && "$c" -c 'import sys; sys.exit(sys.version_info < (3, 10))' 2>/dev/null; then py=$c; break; fi
done
if [ -z "$py" ]; then echo "tokeneconomizer: Python 3.10+ not found; its hooks stay inactive" >&2; exit 1; fi
"$py" -m pip install --user --quiet "tokeneconomizer @ git+https://github.com/microsoft/TokenEconomizer.git@$te_sha"
# Tool pruning only proposes deny rules (applied with /tokeneconomizer:toolprune apply); the repo keeps no deny rules.
"$py" -m tokeneconomizer.plugin.cli config set toolprune=propose --global
