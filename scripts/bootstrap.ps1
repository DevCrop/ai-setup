# Windows entry for a new machine. Installs Git and Python 3.11+ with winget only when missing (asks y/N first),
# then runs scripts/bootstrap.py with the same arguments. Run it without changing the machine's execution policy:
#   powershell -ExecutionPolicy Bypass -File scripts\bootstrap.ps1 [check|install|apply|verify|autostart]
$ErrorActionPreference = 'Stop'

function Test-Python {
  # "python" may be the Microsoft Store stub, which prints nothing useful: ask for the version and check it.
  try { return ((& python --version 2>&1 | Out-String) -match 'Python 3\.(1[1-9]|[2-9][0-9])') } catch { return $false }
}

function Install-Missing($name, $wingetId) {
  $answer = Read-Host "$name is missing. Install it with: winget install --id $wingetId --exact ? [y/N]"
  if ($answer -notmatch '^(y|yes)$') { Write-Host "$name is required; stopping."; exit 1 }
  winget install --id $wingetId --exact
  if ($LASTEXITCODE -ne 0) { Write-Host "winget failed for $name (exit $LASTEXITCODE)."; exit 1 }
  # pick up the new PATH in this window
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Install-Missing 'Git' 'Git.Git' }
if (-not (Test-Python)) { Install-Missing 'Python 3.11+' 'Python.Python.3.13' }
if (-not (Test-Python)) { Write-Host 'Python 3.11+ is still not on PATH. Open a new terminal and run this again.'; exit 1 }

& python -B (Join-Path $PSScriptRoot 'bootstrap.py') @args
exit $LASTEXITCODE
