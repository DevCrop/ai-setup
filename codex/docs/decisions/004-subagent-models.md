# Decision 004: subagent model defaults

Approved by the user on 2026-10-12. The parent model stays the user's choice (decision 001); TRACE sets the default for spawned agents.

- `[agents] default_subagent_model = "gpt-6.1-sol"`, `default_subagent_reasoning_effort = "medium"`: code-changing children run on Sol, which the Models page describes as near-Astra performance at lower cost for repeated, long-running work.
- `agents/explorer.toml`: an `explorer` custom agent on `gpt-6.1-sol` at `high`. It sets no `sandbox_mode`: a custom agent file cannot set it, so read-only behaviour comes from its instructions and the parent sandbox (2026-10-16). Every Codex child runs on Sol (user choice); Astra is used only through the optional `astra` and `astra-deep` CLI profiles. Whether it replaces the built-in `explorer` is not confirmed on the Subagents page.
- Mirrors the Claude setup (Opus orchestrates, Haiku executes) with the documented role of each Codex model. This is a user operating choice, not a measured ranking; no benchmark was run (repository rule).
- Undo: remove the two keys from `global/config.base.toml` and `manifest.json` `agent_settings`, remove the `explorer` entry and file, then `setup.py apply`. TRACE restores the user's original `[agents]` values it recorded.

Sources: [Models](https://learn.chatgpt.com/docs/models), [Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents), both read 2026-10-12.
