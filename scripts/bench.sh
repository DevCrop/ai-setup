#!/usr/bin/env bash
# Same three tasks, three ways of running them, one comparison table: cost by kind (cache read, cache write, output, input),
# wall time, peak context and a hidden-test score. Details and limits: docs/GUIDE.md ("Benchmark: single vs subagents vs AO").
# Usage:
#   bash scripts/bench.sh run <work-dir> single|subagents [reps]   runs `claude -p` reps times (default 3) on a fresh copy each time
#   bash scripts/bench.sh prepare-ao <work-dir> [reps]             makes the AO run folders and prompts; you spawn the workers in AO
#   bash scripts/bench.sh report <work-dir>                        table on screen, JSON in reports/bench/latest.json (the dashboard reads it)
#   bash scripts/bench.sh selftest                                 synthetic logs, no model calls
# Run every arm on the same machine, with the same applied settings and Claude Code version, or the comparison mixes in the machine.
# Needs: git, python3; `run` also needs the claude CLI (logged in) and costs tokens. Writes only under <work-dir> and reports/bench/.
# Session transcripts must persist (no --no-session-persistence): the report finds each run's sessions by a marker in the prompt.
# `run` stops unless this repo is applied here (bash scripts/apply.sh): settings.json's hooks point into the config directory, and
# without them every Bash call is blocked and the run measures nothing. BENCH_SETTINGS=<file> replaces --settings and skips that
# check; it exists to test this harness only, and its numbers are not a baseline.
set -u
repo="$(cd "$(dirname "$0")/.." && pwd -W 2>/dev/null || pwd)"  # pwd -W: native Windows path for claude.exe (Git Bash)
bench="$repo/scripts/bench"
py="$(command -v python3 || command -v python)"  # Windows runners may only have python
cmd="${1:-}"; shift || true

fresh() { # arm rep -> prints the run dir: a committed copy of the fixture plus this repo's agents, and bench.json with a unique marker
  local d="$work/$1-r$2" marker
  if [ -e "$d" ] && [ -z "${BENCH_FORCE:-}" ]; then echo "$d exists (an earlier run); move it away or set BENCH_FORCE=1 to replace it" >&2; return 1; fi
  marker="BENCH-$1-r$2-$(date +%s)-$RANDOM$RANDOM"
  rm -rf "$d" && mkdir -p "$d" && cp -R "$bench/fixture" "$d/repo" && mkdir -p "$d/repo/.claude" && cp -R "$repo/claude/agents" "$d/repo/.claude/agents" || return 1
  ( cd "$d/repo" && git init -q -b main && git add -A && git -c user.name=bench -c user.email=bench@localhost commit -qm "bench fixture" ) || exit 1
  printf '{"arm": "%s", "rep": %s, "marker": "%s", "created": "%s"}\n' "$1" "$2" "$marker" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$d/bench.json"
  echo "$d"
}
marker_of() { "$py" -c 'import json,sys;print(json.load(open(sys.argv[1]))["marker"])' "$1/bench.json"; }

prompt() { # arm marker
  case "$1" in
    single) printf '[%s] Do the three tasks in TASKS.md yourself in this session, one after another. Do not use subagents. Write each task'"'"'s tests, run the full test command from TASKS.md until it passes, then commit. Do not push.' "$2" ;;
    subagents) printf '[%s] Do the three tasks in TASKS.md in parallel: launch three `worker` subagents in one message, one per task. They own different files, so no worktree is needed. Brief each with its section of TASKS.md, its two files, and the test command. When all three report, run the full test command from TASKS.md, fix what fails, then commit. Do not push.' "$2" ;;
    ao-*) printf '[%s] Do only task "%s" in TASKS.md: edit its module and its test file, nothing else. Run the full test command from TASKS.md until your tests pass, then commit on your branch. Never push.' "$2" "${1#ao-}" ;;
  esac
}

case "$cmd" in
  run)
    work="${1:?usage: bash scripts/bench.sh run <work-dir> single|subagents [reps]}"; arm="${2:?arm: single|subagents}"; reps="${3:-3}"
    case "$arm" in single|subagents) ;; *) echo "run takes single or subagents; for AO use prepare-ao" >&2; exit 2 ;; esac
    case "$reps" in ''|*[!0-9]*) echo "reps must be a number" >&2; exit 2 ;; esac
    command -v claude >/dev/null && command -v git >/dev/null || { echo "needs the claude CLI and git" >&2; exit 2; }
    settings="${BENCH_SETTINGS:-$repo/claude/settings.json}"
    if [ -z "${BENCH_SETTINGS:-}" ]; then
      cfg="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
      [ -f "$cfg/hooks/secret-guard.sh" ] && command -v rtk >/dev/null || { echo "this machine does not have the setup applied (missing $cfg/hooks/secret-guard.sh or rtk): run bash scripts/apply.sh first" >&2; exit 2; }
    else
      echo "BENCH_SETTINGS=$settings: harness test only, not a baseline" >&2
    fi
    mkdir -p "$work" && work="$(cd "$work" && pwd)" || exit 2
    to="$(command -v timeout || true)"  # without one, runs have no time limit
    [ -n "$to" ] || echo "no timeout: runs have no 30-minute limit" >&2
    for r in $(seq 1 "$reps"); do
      d="$(fresh "$arm" "$r")" || exit 1; m="$(marker_of "$d")"
      echo "== $arm r$r ($d)"
      # a parent Claude session's id must not leak in: with it, runs share one transcript
      ( cd "$d/repo" && env -u CLAUDE_CODE_SESSION_ID -u CLAUDE_CODE_REMOTE_SESSION_ID ${to:+"$to" 1800} claude -p "$(prompt "$arm" "$m")" --settings "$settings" --permission-mode auto \
          --output-format stream-json --verbose > "$d/stream.jsonl" 2> "$d/stream.err" ) || echo "   exit $? (see $d/stream.err)"
    done ;;
  prepare-ao)
    work="${1:?usage: bash scripts/bench.sh prepare-ao <work-dir> [reps]}"; reps="${2:-3}"
    case "$reps" in ''|*[!0-9]*) echo "reps must be a number" >&2; exit 2 ;; esac
    mkdir -p "$work" && work="$(cd "$work" && pwd)" || exit 2
    for r in $(seq 1 "$reps"); do
      d="$(fresh ao "$r")" || exit 1; m="$(marker_of "$d")"; mkdir -p "$d/prompts"
      for t in slug duration percentile; do prompt "ao-$t" "$m" > "$d/prompts/$t.txt"; done
      echo "== ao r$r: $d/repo, prompts in $d/prompts/"
    done
    cat <<EOF

Next, for each ao-r* folder (one at a time, so runs do not overlap):
  1. Register <folder>/repo as an AO project. Set the worker model to the one the other arms used (your default, see 'model' in
     claude/settings.json) and the permission to auto: round-trip 'ao project get <id> --json', then 'ao project set-config'.
  2. Spawn three workers at once, one per prompt file, each prompt pasted verbatim (it carries the marker the report looks for).
     Check 'ao spawn --help' for how your AO version takes the prompt.
  3. When all three are done, merge their branches into main in <folder>/repo (the score is read from main's working tree).
Then: bash scripts/bench.sh report $work
EOF
    ;;
  report)
    work="${1:?usage: bash scripts/bench.sh report <work-dir>}"
    "$py" "$bench/report.py" "$work" --out "$repo/reports/bench/latest.json" && echo "(JSON: reports/bench/latest.json)" ;;
  selftest)
    "$py" "$bench/selftest.py" ;;
  *) sed -n '2,13p' "$0"; exit 2 ;;
esac
