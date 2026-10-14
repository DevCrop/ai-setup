# CLI executable not found

## Symptom
On Windows PowerShell, a script that uses `Get-Command codex.exe` cannot resolve the CLI.

## Cause
The lookup cannot find codex.exe on PATH. The error alone does not prove Codex is uninstalled.

## Fix
Check `Get-Command codex -ErrorAction SilentlyContinue` or pass a verified executable path as a structured argument (for example `setup.py doctor --codex <executable-path>`). Do not recursively search for and execute matching files. Do not change system PATH or install a second CLI to bypass diagnosis; keep the selected runtime.

## Check
`<executable> --version` runs, and the login or doctor command reaches the resolved CLI.
