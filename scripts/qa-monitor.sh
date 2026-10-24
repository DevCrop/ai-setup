#!/usr/bin/env bash
# Model-free tests for scripts/monitor.mjs (transcript parsing, routing verdicts, token sums, privacy). Needs node 20+.
# Usage: bash scripts/qa-monitor.sh   (without node: SKIP locally, but exit 1 when CI is set so CI cannot pass silently)
set -u
repo="$(cd "$(dirname "$0")/.." && pwd)"
if ! command -v node >/dev/null 2>&1; then
  [ -n "${CI:-}" ] && { echo "FAIL  node not found"; exit 1; }
  echo "SKIP  node not found"; exit 0
fi
node --test "$repo/scripts/monitor.test.mjs"
