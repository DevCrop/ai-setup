# CLI executable not found

## Symptoms and environment
Windows PowerShell; login script used Get-Command codex.exe.

## Confirmed cause and limits
The script lookup could not resolve codex.exe. The error alone does not prove Codex was uninstalled.

## Non-destructive diagnosis
Check Get-Command codex -ErrorAction SilentlyContinue and an explicitly supplied CLI path. Check --version after resolution.

## Resolution
Use a verified executable supplied as a structured argument or available through PATH. Do not recursively search and execute arbitrary matching files.

## Verification
Later transcript reached the local login server and reported successful login. The exact historical resolver modification was not re-audited here.

## Effects and rollback
Do not change system PATH or install a second CLI merely to bypass diagnosis. Preserve the original selected runtime.

## Evidence and last review
User-provided login-s4.ps1 errors and later successful login transcript. Last evidence review: 2026-09-14; no new reproduction.

