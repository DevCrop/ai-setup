# workspace-write request renders read-only

## Symptoms and environment
Historical Codex CLI 0.154.0 on Windows; debug prompt-input comparison.

## Confirmed cause and limits
With windows.sandbox unspecified, workspace-write rendered read-only. Selecting unelevated or elevated rendered workspace-write. The managed marker did not establish an enterprise policy mandate.

## Non-destructive diagnosis
Compare effective rendered configuration without model calls or permission changes. Separate rendered permissions from actual tool enforcement.

## Resolution
Historical proposal was selecting unelevated while retaining other restrictions. Do not apply that old setting to a new runtime without checking current docs and authorization.

## Verification
Historical three-way comparison exited 0 with no stderr. It did not establish every runtime read/write boundary.

## Effects and rollback
Do not relax permissions or choose elevated automatically. Revert only the changed managed setting if verification fails.

## Evidence and last review
TRACE historical inventory/S4-permission-root-cause.md. Sources: https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/core/src/config/mod.rs and https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/core/src/config/permissions.rs . Last evidence review: 2026-09-14.

