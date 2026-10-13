param(
    [Parameter(Mandatory = $true)][string]$PythonPath,
    [Parameter(Mandatory = $true)][string]$Action,
    [Parameter(Mandatory = $true)][string]$Project
)
$ErrorActionPreference = 'Stop'
& $PythonPath -B (Join-Path $PSScriptRoot 'qa.py') $Action --project $Project
exit $LASTEXITCODE
