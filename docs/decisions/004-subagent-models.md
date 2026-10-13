# Decision 004: subagent model defaults

Approved by the user on 2026-10-12. The parent model stays the user's choice (decision 001); TRACE now also sets the default for spawned agents.

- `[agents] default_subagent_model = "gpt-6.1-sol"`, `default_subagent_reasoning_effort = "medium"`: code-changing children run on Sol, which the Models page describes as near-Astra performance at lower cost for repeated, long-running work.
- `agents/explorer.toml`: a read-only `explorer` custom agent on `gpt-6-luna` at `high`. The Models page lists Luna for focused, high-volume tasks such as extraction, classification, transformation and structured summaries, and suggests starting it at High. It replaces the built-in `explorer`, as the Subagents page says a same-name custom agent does.
- Mirrors the Claude setup (Opus orchestrates, Haiku executes) with the documented role of each Codex model. This is a user operating choice, not a measured ranking; no benchmark was run (repository rule).
- Undo: remove the two keys from `global/config.base.toml` and `manifest.json` `agent_settings`, remove the `explorer` entry and file, then `setup.py apply`. TRACE restores the user's original `[agents]` values it recorded.

Sources: [Models](https://learn.chatgpt.com/docs/models), [Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents), both read 2026-10-12.
