# Opt-in local viewer. No startup registration, hook or scheduled task is added.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$ReportsDir,
    [switch]$NoOpen
)
$ErrorActionPreference = 'Stop'
$reportRoot = (Resolve-Path -LiteralPath $ReportsDir).Path
$readyPath = Join-Path $reportRoot '.rtk-live-ready.json'
$serverScript = Join-Path $PSScriptRoot 'rtk_dashboard.py'
$ready = $null
if (Test-Path -LiteralPath $readyPath -PathType Leaf) {
    try {
        $candidate = Get-Content -LiteralPath $readyPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($candidate.url -match '^http://127\.0\.0\.1:[0-9]+/rtk-efficiency\.html$') {
            $healthURL = $candidate.url.Replace('/rtk-efficiency.html', '/api/health')
            $health = Invoke-RestMethod -Uri $healthURL -TimeoutSec 2
            if ($health.viewer -eq 'TRACE RTK' -and
                $health.instance_id -eq $candidate.instance_id -and $health.pid -eq $candidate.pid) {
                $ready = $candidate
            }
        }
    } catch { $ready = $null }
}
if ($null -eq $ready) {
    $pythonExe = (Get-Command python -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
    $arguments = '-B "{0}" --reports-dir "{1}" --ready-file "{2}"' -f $serverScript, $reportRoot, $readyPath
    $process = Start-Process -FilePath $pythonExe -ArgumentList $arguments -WindowStyle Hidden -PassThru
    $deadline = [DateTime]::UtcNow.AddSeconds(10)
    while ([DateTime]::UtcNow -lt $deadline -and $null -eq $ready) {
        Start-Sleep -Milliseconds 150
        $process.Refresh()
        if ($process.HasExited) { throw 'RTK live viewer could not start. Check Python and report paths.' }
        if (Test-Path -LiteralPath $readyPath -PathType Leaf) {
            try {
                $candidate = Get-Content -LiteralPath $readyPath -Raw -Encoding UTF8 | ConvertFrom-Json
                if ($candidate.pid -eq $process.Id -and $candidate.url -match '^http://127\.0\.0\.1:[0-9]+/rtk-efficiency\.html$') {
                    $ready = $candidate
                }
            } catch { }
        }
    }
    if ($null -eq $ready) { throw 'RTK live viewer readiness is unknown. Do not start another copy until checked.' }
}
if (-not $NoOpen) { Start-Process -FilePath $ready.url }
$ready | ConvertTo-Json -Compress
