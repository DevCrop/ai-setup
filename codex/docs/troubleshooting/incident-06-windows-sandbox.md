# workspace-write request renders read-only

## Symptom
On Windows, a session that requests `workspace-write` shows read-only permissions in the effective rendered configuration.

## Cause
With `windows.sandbox` unspecified, Codex CLI 0.154.0 rendered workspace-write as read-only; selecting `unelevated` or `elevated` rendered workspace-write. A managed marker in the config does not by itself mean an enterprise policy requires it. Check whether the installed CLI behaves the same before acting.

## Fix
Compare the effective rendered configuration without model calls or permission changes, and keep rendered permissions separate from actual tool enforcement. If the installed CLI shows the same behavior, propose `windows.sandbox = "unelevated"` with the other restrictions unchanged, check it against the current docs and apply it only with the user's authorization. Never relax permissions or choose `elevated` automatically.

## Check
The rendered configuration shows workspace-write and a small authorized write succeeds. If not, revert only the changed setting.

Sources: [config/mod.rs](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/core/src/config/mod.rs), [config/permissions.rs](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/core/src/config/permissions.rs).
