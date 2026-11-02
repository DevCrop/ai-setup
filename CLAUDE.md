# ai-setup

Source of truth for the global Claude Code setup: `claude/` is copied into `~/.claude` by `bash scripts/apply.sh`. Edit `claude/`, never `~/.claude` directly.

## Commands
- Apply: `bash scripts/apply.sh` (`--dry-run` previews). It merges `settings.json` key by key and copies CLAUDE.md, RTK.md, statusline.sh, agents/, hooks/ and the eight listed skills; git is the history, and a managed file edited by hand since the last apply is first saved under `~/.claude/.ai-setup-local-edits/`.
- Checks (no model): `bash scripts/qa-apply.sh`, `bash scripts/qa-hooks-session.sh`, `bash scripts/qa-statusline.sh`, `bash scripts/qa-setup-claude-mem.sh`, `bash scripts/qa-setup-mac.sh`, `bash scripts/qa-monitor.sh`, `QA_MODE=selftest bash scripts/qa-role-agents.sh "$(mktemp -d)"`, `bash scripts/eval.sh selftest "$(mktemp -d)"`, `cd app && node --test`, `powershell -NoProfile -ExecutionPolicy Bypass -File bootstrap/test-setup.ps1` (dry-runs only; never run `bootstrap/setup.ps1` without `-DryRun` on a set-up PC).
- Eval (costs tokens, measures the live `~/.claude`): `bash scripts/eval.sh run <label> <dir>`, then `bash scripts/eval.sh judge <dir> <old> <new>`. A change to `claude/agents/` or `claude/skills/` merges only when its score and judge result are no worse than the baseline. Exception: a change no eval case can reach (today only project-setup, which has disable-model-invocation) skips eval; say why in the commit body and run qa-project-setup.sh. Eval measures the live setup, so apply the branch before running it. `bash scripts/qa-project-setup.sh "$(mktemp -d)"` grades the project-setup skill with `claude -p` (also costs tokens).
- Syntax and lint (same as CI): `bash -n scripts/*.sh claude/*.sh claude/hooks/*.sh`, `jq empty claude/settings.json scripts/owned-keys.json scripts/removed-keys.json`, `shellcheck -S warning scripts/*.sh bootstrap/*.sh claude/statusline.sh claude/hooks/*.sh`.

## Rules
- Scope is Ponytail, RTK, claude-mem, TokenEconomizer, subagents (Opus works inline; subagents for parallel parts, broad searches, verification, or on request) and their skills, two session hooks, the status line, the `agent-desktop` CLI (`docs/agent-desktop.md`), the Claude Monitor desktop app (`app/`, docs in `docs/*-claude-monitor.md`) and the new-PC installer (`bootstrap/`). The Codex setup belongs to DevCrop/codex-setup; this repo never edits `~/.codex`. The Monitor shows it and points there; its one write is what `AGENTS.md` allows (a stale table, after the user clicks apply). Do not add tooling outside that without the user asking.
- Keep `claude/CLAUDE.md` under 200 lines.
- Never commit credentials or `.env*`.
- Every commit has a body that gives the reason and how the change was checked.
- Changes go through a branch and a PR; merge once CI is green and the reviewer subagent has no open findings (a docs-only change needs CI only).
- The pre-slim setup (AO, Codex, dashboard, routine, secret guard) is at tag `legacy-full`.
