# Account disallows device authentication

## Symptoms and environment
ChatGPT account device-code login; version-specific UI labels may differ.

## Confirmed cause and limits
The user reported an explicit request to enable device-code authentication in account security settings. This establishes the account setting issue for that attempt.

## Non-destructive diagnosis
Read the CLI error without collecting codes or authorization parameters; verify the current official login instructions.

## Resolution
The user enables the relevant account setting and starts a new supported device login. An agent must not silently alter account security preferences.

## Verification
The user later reported successful browser authorization; confirm local login status separately.

## Effects and rollback
Changes an account setting. Record only the fact of user action, never a one-time code. Old codes expire and must not be reused.

## Evidence and last review
User transcript and historical inventory/S4-container-auth.md. Last evidence review: 2026-09-14. https://learn.chatgpt.com/docs/auth

