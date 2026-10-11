# claude-global

Source of truth for the global Claude Code setup. `claude/` is copied into `~/.claude` by `bash scripts/apply.sh`. Edit `claude/`, never `~/.claude` directly.

## Commands
- Apply: `bash scripts/apply.sh` (backs up first, copies CLAUDE.md, RTK.md, settings.json, statusline.sh, agents/, hooks/, routines/ and the five listed skills; never scheduled-tasks/ or runtime data).
- Check deny rules on this machine: `bash scripts/qa-deny.sh` (needs the claude CLI, uses haiku). Run it after any change to `permissions.deny` or hooks, and on every machine where RTK is installed.
- Dashboard UI check: `bash scripts/qa-ui.sh` (headless Chrome through every tab, layout widths, palette, live updates; needs node 22+). The UI is ES modules in `scripts/dashboard/ui/`: a screen is a `Tab` subclass registered in `ui/tabs/index.js`, built from `ui/components.js`.
- Syntax: `bash -n scripts/*.sh` and `python3 -c "import json;json.load(open('claude/settings.json'))"`.

## Rules
- Permission rules are evaluated on the input a PreToolUse hook returns. RTK rewrites `git ...` to `rtk git ...`, so every Bash deny pattern has an `rtk `-prefixed copy. Add both when you add a pattern.
- Keep `claude/CLAUDE.md` under 200 lines. Do not add lines that only repeat what deny rules, settings or `RTK.md` already enforce; safety rules that steer the model and the auto-mode classifier (which reads this file) stay.
- Never commit `reports/`, credentials, or `.env*`. `state/` holds the daily routine's per-machine baseline and is gitignored, so it never blocks `git pull` and values from one machine never mix with another.
- Changes go through a branch and a PR, and a person merges. Decisions and history are in `docs/NEXT-MACHINE.md`.
