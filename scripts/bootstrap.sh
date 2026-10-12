#!/usr/bin/env bash
# macOS / Linux entry for a new machine. Installs git and Python 3.11+ with Homebrew only when missing (asks y/N first),
# then runs scripts/bootstrap.py with the same arguments. Elsewhere it says what to install and stops.
# Usage: bash scripts/bootstrap.sh [check|install|clone|apply|verify|autostart]
set -eu
here="$(cd "$(dirname "$0")" && pwd)"

find_python() {
  for c in python3 python; do
    if command -v "$c" >/dev/null 2>&1 && "$c" -c 'import sys; sys.exit(sys.version_info < (3, 11))' 2>/dev/null; then echo "$c"; return; fi
  done
}

py="$(find_python)"
if [ -z "$py" ] || ! command -v git >/dev/null 2>&1; then
  if ! command -v brew >/dev/null 2>&1; then
    echo "Install git and Python 3.11+ with your package manager, then run this again." >&2
    exit 1
  fi
  if [ ! -t 0 ]; then echo "git or Python 3.11+ is missing and there is no terminal to ask; stopping." >&2; exit 1; fi
  printf 'Install the missing git / Python 3.11+ with: brew install git python@3.13 ? [y/N] '
  read -r answer
  case "$answer" in y|Y|yes) brew install git python@3.13 ;; *) echo "required; stopping." >&2; exit 1 ;; esac
  py="$(find_python)"
  [ -n "$py" ] || { echo "Python 3.11+ is still not on PATH. Open a new terminal and run this again." >&2; exit 1; }
fi

exec "$py" -B "$here/bootstrap.py" "$@"
