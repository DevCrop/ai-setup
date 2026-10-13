# Container device authentication transport failure

## Symptoms and environment
Historical fixed Node slim container and Codex CLI 0.154.0.

## Confirmed cause and limits
The historical report confirmed missing /etc/ssl/certs/ca-certificates.crt. Browser/Node connectivity alone did not establish Codex CA configuration.

## Non-destructive diagnosis
Inspect CA-file availability and the installed CLI's documented certificate settings. Keep TLS verification enabled.

## Resolution
Historical workaround supplied a public CA bundle derived from the pinned Node runtime through CODEX_CA_CERTIFICATE. Re-evaluate against the current image before use.

## Verification
The corrected invocation received the device-login instructions; a later login status reported Logged in using ChatGPT. This is not proof of model/tool connectivity.

## Effects and rollback
Container-specific workaround; do not apply globally or disable certificate verification. Remove only owned temporary certificate material when the login container ends.

## Evidence and last review
TRACE historical inventory/S4-container-auth.md. Last evidence review: 2026-09-14. Official authentication: https://learn.chatgpt.com/docs/auth

