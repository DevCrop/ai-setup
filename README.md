# claude-global

Source of truth for the global Claude Code setup (`~/.claude` on each machine).

## Layout

- `claude/CLAUDE.md` — global rules, copied to `~/.claude/CLAUDE.md`
- `claude/settings.json` — global settings, copied to `~/.claude/settings.json`
- `claude/RTK.md`, `claude/agents/`, `claude/skills/` — RTK note, subagents (`explorer`, `reviewer`, `worker`, `publisher`, `frontend`, `backend`, `qa`) and skills (`orchestrate`, `project-setup`, `spec-writing`, `design-spec`, `ui-baseline`), copied to `~/.claude/`
- `claude/hooks/secret-guard.sh` — PreToolUse hook: blocks `git add/stage/commit/push/update-index/mv/apply --index/am` of secret-looking files (the list is `is_secret` in the script); fails closed when it cannot judge
- `claude/routines/`, `claude/scheduled-tasks/` — daily update routine and the scheduled task body
- `docs/GUIDE.md` — start here: quick path for a new machine (15 min), claude-mem setup, project setup, per-task flow
- `docs/NEXT-MACHINE.md` — full handoff: decisions, links, routine, remaining work, setup order for a new machine
- `state/last-seen.json` — per-machine baseline for the daily routine (gitignored, created by the routine)
- `scripts/apply.sh` — merges `claude/` into `~/.claude/` (settings.json key by key, no backup: git is the history)
- `scripts/verify.sh` — read-only checks: repo, `--live` for this machine's applied state, `--full` adds the deny/ask QA
- `scripts/docs-watch.sh` — diffs the official docs pages this setup depends on (used by the daily routine)
- `scripts/qa-hooks.sh` — unit tests for the hook with no model calls (pass a mutated copy to prove the checks discriminate)
- `scripts/dashboard/` — local dashboard (`server.py` + `ui/` ES modules), `http://127.0.0.1:8787`
- `scripts/setup-claude-mem.sh` — machine-local claude-mem settings (cheap observer model, redaction on)
- `scripts/qa-dashboard.sh`, `scripts/qa-ui.sh`, `scripts/qa-role-agents.sh`, `scripts/qa-project-setup.sh` — dashboard API/UI checks and role-agent QA
- `scripts/qa-deny.sh` — checks that the deny rules still block dangerous commands on this machine, with hooks such as rtk active

Runtime data (credentials, session history, auto-memory, plugins, caches) is never stored here. See `.gitignore`.

## Applying

Run `bash scripts/apply.sh` (macOS bash or Git Bash on Windows). On Windows, Git Bash `$HOME` must equal `%USERPROFILE%`; otherwise set `CLAUDE_CONFIG_DIR` to `%USERPROFILE%\.claude`. It needs `jq`. It copies `CLAUDE.md`, `RTK.md`, `settings.json`, `statusline.sh`, `agents/`, `hooks/`, `routines/` and the listed `skills/*` into `~/.claude/` (or `CLAUDE_CONFIG_DIR`). `settings.json` is merged key by key: the keys this repo owns (permissions, `autoMode`, hooks, status line, marketplaces) take the repo value, keys that only exist on the machine are kept and reported, and files that an earlier apply copied but the repo no longer has are removed. Nothing else in that directory is touched. To go back, check out the older commit and run `apply.sh` again. Update with `git pull && bash scripts/apply.sh`. The status line in `settings.json` needs `jq` on PATH.

Scope: local machines only. Cloud sessions read the project's own `.claude/`, not `~/.claude/`.

## Verifying

Run `bash scripts/qa-deny.sh` on each machine after `apply.sh`. It first checks without the CLI that every Bash deny pattern has an `rtk ` twin, then needs the `claude` CLI, uses a throwaway repo with no remote and the haiku model, and prints PASS or FAIL per command. Undo an apply by checking out the older commit and running `apply.sh` again (there is no backup; see docs/GUIDE.md).

## Status

Applied and checked on the first machine (Windows Git Bash); a fresh clone of `main` also passed the QA scripts on Windows on 2026-10-11 (PRs up to #69). Earlier, 2026-10-10 after PRs #28 to #33: `apply.sh`, then `verify.sh --live` with 0 FAIL, and a real `claude -p` session in `bypassPermissions` with RTK on had `git add -A` blocked by the secret-guard hook. Not yet run on macOS (bash 3.2, BSD tools) or on a second machine. On each machine run the steps in `docs/GUIDE.md` and `bash scripts/verify.sh --live`.
