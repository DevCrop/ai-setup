# Installs the monitor status bar for the current user: a Startup shortcut to scripts\monitor-bar.vbs, then starts it once.
# Idempotent (the shortcut is rewritten in place; the bar and the watcher refuse to run twice). -DryRun prints only.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\monitor-install.ps1 [-DryRun] [-NoStart]
# To remove: delete "Claude monitor.lnk" from the Startup folder (shell:startup).
param([switch]$DryRun, [switch]$NoStart)
$ErrorActionPreference = 'Stop'

$vbs = Join-Path $PSScriptRoot 'monitor-bar.vbs'
if (-not (Test-Path -LiteralPath $vbs)) { Write-Host "monitor-bar.vbs not found next to this script"; exit 1 }
$startup = [Environment]::GetFolderPath('Startup')
$lnk = Join-Path $startup 'Claude monitor.lnk'
$wscript = Join-Path $env:SystemRoot 'System32\wscript.exe'

if ($DryRun) {
    Write-Host "[dry-run] write shortcut $lnk -> $wscript `"$vbs`""
    if (-not $NoStart) { Write-Host "[dry-run] start the status bar" }
    exit 0
}
$sh = New-Object -ComObject WScript.Shell
$s = $sh.CreateShortcut($lnk)
$s.TargetPath = $wscript
$s.Arguments = "`"$vbs`""
$s.WorkingDirectory = Split-Path $PSScriptRoot
$s.Description = 'Claude setup monitor status bar'
$s.Save()
Write-Host "shortcut: $lnk"
if (-not $NoStart) { Start-Process -FilePath $wscript -ArgumentList "`"$vbs`""; Write-Host 'status bar started' }
