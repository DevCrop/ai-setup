# ai-setup (for Codex and other agents)

Read `CLAUDE.md` in this folder first and follow it; it is the one source of the commands and rules here. This file only adds what differs for a non-Claude agent.

- This repo manages the Claude Code setup: `claude/` is copied into `~/.claude` by `bash scripts/apply.sh`. It does not manage `~/.codex`; never edit `~/.codex` from here.
- The Claude Monitor app (`app/`) reads `~/.codex` and may remove a stale table from `~/.codex/config.toml` only after the user clicks apply, with a backup first. Never read `~/.codex/auth.json`, `~/.codex/secrets/`, `~/.codex/.sandbox-secrets/` or session contents.
- "The reviewer subagent" in `CLAUDE.md` means an independent review pass; Codex can run one with its own subagents.
- Keep this file short; put shared rules in `CLAUDE.md`, not here.
