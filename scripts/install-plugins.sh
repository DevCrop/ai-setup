#!/usr/bin/env bash
# Install ponytail and claude-mem at the versions claude/settings.json pins (Windows bootstrap: modules.json claude-plugins).
# Same steps as the plugin part of bootstrap/setup-mac.sh. Needs a logged-in claude.
set -eu
# Marketplaces declared in settings.json register only when a session starts, and `plugin install` alone reports
# "not found in marketplace". One one-word headless session registers them (a few tokens).
claude plugin marketplace list 2>/dev/null | grep -q thedotmack || claude -p ok >/dev/null 2>&1 || true
for p in ponytail@ponytail claude-mem@thedotmack; do
  claude plugin install "$p"
  claude plugin update "$p" # install leaves an older copy alone; update moves it to the pinned version
done
