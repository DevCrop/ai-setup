# ai-setup

Source of truth for the global agent setup: Claude Code (`claude/`, copied into `~/.claude` by `bash scripts/apply.sh`; edit `claude/`, never `~/.claude` directly), the Codex setup TRACE (`codex/`) and the Agent Orchestrator project setup (`ao/`).

## Commands
- Apply: `bash scripts/apply.sh` (merges settings.json key by key, no backup; copies CLAUDE.md, RTK.md, settings.json, statusline.sh, agents/, hooks/, routines/ and the five listed skills; never scheduled-tasks/ or runtime data).
- Machine setup: `python3 scripts/bootstrap.py check [--write]` (read-only; tools, versions, setup checkouts, project roots from `tools.json`; `--write` adds what it found to gitignored `state/machine.json`, where per-machine values go), then `install`, `apply`, `verify`, `autostart` (each write asks y/N and refuses without a terminal). Bare machine: `scripts/bootstrap.ps1`. Tests: `python3 scripts/qa-bootstrap.py`. Add a tool by adding one `tools.json` entry. `apply.sh --dry-run` previews an apply.
- Check deny rules on this machine: `bash scripts/qa-deny.sh` (needs the claude CLI, uses haiku). Run it after any change to `permissions.deny` or hooks, and on every machine where RTK is installed.
- Dashboard UI check: `bash scripts/qa-ui.sh` (headless Chrome through every tab, layout widths, palette, live updates; needs node 22+). The UI is ES modules in `scripts/dashboard/ui/`: a screen is a `Tab` subclass registered in `ui/tabs/index.js`, built from `ui/components.js`.
- Codex (TRACE): from `codex/`, `python -B scripts/setup.py plan`, then `apply` and `verify` (`codex/README.md`); tests `python -B -m unittest discover -s scripts -p 'test_*.py'`. AO: from `ao/`, `python -B setup.py register ...` and `apply` (`ao/README.md`); tests `python -B -m unittest test_qa`.
- Pinned versions: `python3 scripts/update-pins.py` previews the weekly update PR (`--write` edits the pins and `docs/tool-versions.json`; CI does that); tests `python3 scripts/qa-update-pins.py`.
- Syntax: `bash -n scripts/*.sh` and `python3 -c "import json;json.load(open('claude/settings.json'))"`.

## Rules
- Permission rules are evaluated on the input a PreToolUse hook returns. RTK rewrites `git ...` to `rtk git ...`, so every Bash deny pattern has an `rtk `-prefixed copy. Add both when you add a pattern.
- Keep `claude/CLAUDE.md` under 200 lines. Do not add lines that only repeat what deny rules, settings or `RTK.md` already enforce; safety rules that steer the model and the auto-mode classifier (which reads this file) stay.
- Never commit `reports/`, credentials, or `.env*`. `state/` holds per-machine values (`machine.json`, the daily routine's baseline) and is gitignored, so it never blocks `git pull` and values from one machine never mix with another.
- Every commit has a body that gives the reason and how the change was checked; fixes go in their own commits, never into a merge commit.
- Changes go through a branch and a PR, and Claude merges the PR once CI is green and the reviewer subagent has no open findings. Decisions are in `docs/DECISIONS.md` (measurements in `docs/evidence.md`); the runbook is `docs/GUIDE.md` (`codex/` and `ao/` keep their own: `operations.md` in `codex/docs/`, and `ao/README.md`); open work is in `docs/BACKLOG.md` (delete a row in the PR that does it).
