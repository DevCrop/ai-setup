# Relative script not found

## Symptoms and environment
PowerShell started outside the checkout; user transcript shows a Windows system directory.

## Confirmed cause and limits
A relative script path resolves from the current directory, not the intended repository. The failing invocation did not locate the script.

## Non-destructive diagnosis
Check the current directory and Test-Path -LiteralPath for the resolved script. Do not print authentication files.

## Resolution
Invoke the verified absolute script path or change to the verified checkout. Scripts must resolve internal resources from their own location.

## Verification
The next user invocation reached the script and failed later at CLI discovery, proving the original path obstacle was passed.

## Effects and rollback
No permissions change required. Do not hard-code the original user's home in shared instructions.

## Evidence and last review
User-provided PowerShell error sequence in this task. Last evidence review: 2026-09-14; no new reproduction.

