# ai-setup

Source of truth for the global Claude Code setup: `claude/` is copied into `~/.claude` by `bash scripts/apply.sh`. Edit `claude/`, never `~/.claude` directly.

## Commands
- Apply: `bash scripts/apply.sh` (`--dry-run` previews). It merges `settings.json` key by key and copies CLAUDE.md, RTK.md, statusline.sh, agents/, hooks/ and the six listed skills; no backup, git is the history.
- Checks (no model): `bash scripts/qa-apply.sh`, `bash scripts/qa-hooks-session.sh`, `bash scripts/qa-statusline.sh`, `bash scripts/qa-setup-claude-mem.sh`, `bash scripts/qa-monitor.sh`, `QA_MODE=selftest bash scripts/qa-role-agents.sh "$(mktemp -d)"`.
- Syntax: `bash -n scripts/*.sh claude/*.sh claude/hooks/*.sh` and `jq empty claude/settings.json`.

## Rules
- Scope is Ponytail, RTK, claude-mem, subagents (Opus plans and verifies, Sonnet and Haiku execute) and their skills, two session hooks and the status line. Do not add tooling outside that without the user asking.
- Keep `claude/CLAUDE.md` under 200 lines.
- Never commit credentials or `.env*`.
- Every commit has a body that gives the reason and how the change was checked.
- Changes go through a branch and a PR; merge once CI is green and the reviewer subagent has no open findings.
- The pre-slim setup (AO, Codex, dashboard, routine, deny rules, secret guard) is at tag `legacy-full`.
