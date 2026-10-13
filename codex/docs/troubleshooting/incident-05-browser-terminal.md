# Browser success while terminal appears unchanged

## Symptoms and environment
Host or container login flow; credential storage belongs to that exact environment.

## Confirmed cause and limits
Browser completion alone does not establish that the initiating CLI stored usable credentials. Remaining containers alone do not prove failure.

## Non-destructive diagnosis
Use the resolved CLI's login status in the same CODEX_HOME/container identity; inspect process state without reading credentials.

## Resolution
Confirm status before restarting login. If unsuccessful, diagnose callback/process/network state and retry the official flow in the intended environment.

## Verification
Historical container status returned exit 0 and Logged in using ChatGPT. No model call was needed for that status check.

## Effects and rollback
Do not copy host credentials to a container or conflate separate homes. Stop only known owned stale login processes.

## Evidence and last review
TRACE historical inventory/S4-container-auth.md and user transcript. Last evidence review: 2026-09-14. https://learn.chatgpt.com/docs/auth

