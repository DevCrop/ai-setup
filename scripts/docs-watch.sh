#!/usr/bin/env bash
# Prints which official Claude Code docs pages changed since the last --update run,
# with a short line diff of each. Read-only except for the local cache in reports/
# (gitignored), and only when --update is passed. Needs curl. Works on macOS bash and
# Git Bash on Windows.
set -eu

repo="$(cd "$(dirname "$0")/.." && pwd)"
cache="$repo/reports/docs-cache"
# Pages this setup depends on: CLAUDE.md and rules, skills, subagents, permissions, plugins, settings, hooks, best practices, permission modes, auto mode config, agent teams, monitoring, worktrees.
pages="best-practices memory skills sub-agents permissions plugins settings hooks hooks-guide permission-modes auto-mode-config model-config advisor agent-teams monitoring-usage worktrees"
# Model lineup and prices (platform docs): a new model, a price change or a retirement date changes the routing in claude/agents and docs/DECISIONS.md.
platform_pages="about-claude/models/overview about-claude/pricing"
update=0
[ "${1:-}" = "--update" ] && update=1

command -v curl >/dev/null 2>&1 || { echo "curl not found" >&2; exit 2; }
mkdir -p "$cache"
tmp="$(mktemp "${TMPDIR:-/tmp}/docs-watch.XXXXXX")"
trap 'rm -f "$tmp"' EXIT

for p in $pages $platform_pages; do
  case " $platform_pages " in
    *" $p "*) url="https://platform.claude.com/docs/en/$p.md"; p="platform-$(printf '%s' "$p" | tr '/' '-')" ;;
    *) url="https://code.claude.com/docs/en/$p.md" ;;
  esac
  if ! curl -fsSL -m 30 "$url" -o "$tmp" 2>/dev/null || [ ! -s "$tmp" ]; then
    echo "FETCH-FAIL $p ($url)"
    continue
  fi
  # An error page served with status 200 is HTML; the docs are markdown. Do not diff or cache it.
  if grep -m1 -v '^[[:space:]]*$' "$tmp" | grep -qi '^[[:space:]]*<'; then
    echo "FETCH-FAIL $p ($url returned HTML, not markdown)"
    continue
  fi
  old="$cache/$p.md"
  if [ ! -f "$old" ]; then
    echo "NEW      $p ($(wc -c < "$tmp" | tr -d ' ') bytes, baseline, no diff)"
  elif cmp -s "$old" "$tmp"; then
    echo "SAME     $p"
  else
    echo "CHANGED  $p ($url)"
    d="$(diff "$old" "$tmp" | grep '^[<>]' || true)"
    n="$(printf '%s\n' "$d" | wc -l | tr -d ' ')"
    printf '%s\n' "$d" | head -60 | sed 's/^/    /' | cut -c1-240
    [ "$n" -gt 60 ] && echo "    (diff truncated to 60 of $n lines)"
  fi
  [ "$update" -eq 1 ] && cp "$tmp" "$old"
done
exit 0
