# Account disallows device authentication

## Symptom
ChatGPT device-code login fails with a request to enable device-code authentication in account security settings. UI labels differ between versions.

## Cause
The account's security settings do not allow device-code authentication.

## Fix
Read the CLI error without collecting codes or authorization parameters and follow the current [official login instructions](https://learn.chatgpt.com/docs/auth). The user enables the account setting and starts a new device login. An agent never changes account security settings itself. Old codes expire and are never reused; record only that the user acted, never a code.

## Check
Browser authorization succeeds, and local login status is confirmed separately in the terminal.
