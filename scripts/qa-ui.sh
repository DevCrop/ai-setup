#!/usr/bin/env bash
# UI QA: starts a private dashboard server, drives headless Chrome through every tab, dialog, layout width, color check
# and the live-update path (changed state, offline, recovery). Needs node 22+ and Chrome or Edge. Reads only; touches no config.
set -u
repo="$(cd "$(dirname "$0")/.." && pwd)"
port="${QA_UI_PORT:-29300}"
while curl -s -o /dev/null --max-time 1 "http://127.0.0.1:$port/"; do port=$((port + 1)); done  # never test a stale server that is already listening
py="$(command -v python3 || command -v python)"
export PROJECT_DIRS="${PROJECT_DIRS:-$repo}"  # the project-dialog checks need one project even on a machine with no session logs
chrome="${CHROME_BIN:-}"
for c in "/c/Program Files/Google/Chrome/Application/chrome.exe" "/c/Program Files (x86)/Google/Chrome/Application/chrome.exe" "/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" "$(command -v google-chrome)" "$(command -v google-chrome-stable)" "$(command -v chromium)" "$(command -v chromium-browser)"; do
  [ -z "$chrome" ] && [ -n "$c" ] && [ -x "$c" ] && chrome="$c"
done
[ -n "$chrome" ] || { echo "FAIL  no Chrome or Edge found (set CHROME_BIN)"; exit 1; }
command -v node >/dev/null || { echo "FAIL  node not found"; exit 1; }
"$py" "$repo/scripts/dashboard/server.py" --port "$port" >/dev/null 2>&1 &
srv=$!
trap 'kill $srv 2>/dev/null' EXIT
for _ in $(seq 1 30); do curl -s -o /dev/null "http://127.0.0.1:$port/" && break; sleep 0.5; done
if command -v cygpath >/dev/null; then chrome_arg="$(cygpath -w "$chrome")"; script="$(cygpath -w "$repo/scripts/qa-ui.mjs")"; else chrome_arg="$chrome"; script="$repo/scripts/qa-ui.mjs"; fi
node "$script" "http://127.0.0.1:$port" "$chrome_arg"
