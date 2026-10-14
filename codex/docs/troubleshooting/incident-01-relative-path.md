# Relative script not found

## Symptom
PowerShell reports that a TRACE script does not exist; the current directory is outside the checkout (for example a Windows system directory).

## Cause
A relative script path resolves from the current directory, not from the repository.

## Fix
Check the current directory and `Test-Path -LiteralPath` for the resolved script. Invoke the verified absolute script path, or change to the verified checkout first. Scripts resolve their own resources from their own location. Do not print authentication files.

## Check
The invocation reaches the script. No permission change is needed. Do not hard-code a user's home in shared instructions.
