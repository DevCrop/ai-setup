# Optional model profiles

The user chooses the parent model and effort. TRACE does not auto-switch models or claim a measured model ranking. The optional CLI presets are `sol` (GPT-6.1 Sol medium), `astra` (Astra medium), and `astra-deep` (Astra high). Select with `codex --profile sol`; profiles do not select the app composer model or overwrite existing base choices.

Official guidance recommends GPT-6.1 Sol for complex coding when available, keeping Astra for the most demanding work. Start with the client's default effort and adjust for the task; Medium here is a convenience preset, not a measured optimum. Light/Low suits scoped tasks. Higher effort can increase time and tokens. Credit rates do not establish exact included-subscription savings. Standard speed remains the economical starting point; Fast consumes included usage at a higher rate. Do not silently lower checks or change effort after repeated failures.

Check host model availability before using a preset; report unsupported choices rather than silently substituting. Subagents inherit resolved parent settings unless an explicit spawn value, agents default, or custom-agent configuration overrides them. TRACE sets the agents default to GPT-6.1 Sol medium and a read-only `explorer` custom agent to GPT-6.1 Sol high (user choice, decision 004). Inspect existing overrides during migration.

Sources: [Models](https://learn.chatgpt.com/docs/models), [Pricing](https://learn.chatgpt.com/docs/pricing), [Profiles](https://learn.chatgpt.com/docs/config-file/config-advanced), [Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents). Preset choices are user convenience policy, not official optimal-effort recommendations.

## Host defaults

For new work, prefer GPT-6.1 Sol when available to the account and client. Keep
Astra for user-selected tasks. To choose a host default, explicitly review that
host's base model setting; an existing base choice takes precedence. TRACE does
not force this preference onto another host or change an existing conversation.
Source: [Current model recommendations](https://learn.chatgpt.com/docs/models),
reviewed 2026-10-01.
