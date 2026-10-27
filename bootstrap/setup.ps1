# One-shot bootstrap for a new Windows PC. Runs in Windows PowerShell 5.1 and pwsh 7.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File bootstrap\setup.ps1 [-DryRun] [-Only a,b] [-Skip a,b] [-NonInteractive]
# Idempotent: every step checks first. Modules come from modules.json; this file has no per-module code.
[CmdletBinding()]
param(
    [string]$RepoPath,
    [string]$WorkRoot,
    [switch]$DryRun,
    [string[]]$Only,
    [string[]]$Skip,
    [switch]$NonInteractive
)
Set-StrictMode -Version 2
# Process-only: Windows PowerShell 5.1 on some Windows 10 builds defaults to TLS 1.0, which GitHub and claude.ai refuse.
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$hasD = Test-Path 'D:\'
if (-not $RepoPath) { if ($hasD) { $RepoPath = 'D:\project\ai-setup' } else { $RepoPath = Join-Path $HOME 'project\ai-setup' } }
$RepoPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($RepoPath)
# "-Only a,b" through powershell -File arrives as one string
$Only = @($Only | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
$Skip = @($Skip | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })

$script:Rows = New-Object System.Collections.ArrayList
$script:Planned = @{}   # dry-run only: prerequisites it printed an install for; the repo step then plans a clone even if git is not on PATH yet

function Add-Row($step, $status, $note) {
    [void]$script:Rows.Add([pscustomobject]@{ Step = $step; Status = $status; Note = $note })
    Write-Host ("[step] {0}: {1} - {2}" -f $step, $status, $note)
}
function Test-Selected($name) {
    if ($Only.Count -gt 0 -and $Only -notcontains $name) { return $false }
    return ($Skip -notcontains $name)
}
function Write-Plan($text) { Write-Host "[dry-run] $text" }
function Get-App($name) { Get-Command $name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1 }
function Update-Path {
    $m = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $u = [Environment]::GetEnvironmentVariable('Path', 'User')
    $all = "$m;$u;$env:Path" -split ';' | Where-Object { $_ } | Select-Object -Unique
    $env:Path = $all -join ';'
}
function Get-ToolVersion($name) {
    $c = Get-App $name
    if (-not $c) { return $null }
    $v = $null
    try { $v = & $c.Source --version 2>&1 | Select-Object -First 1 } catch { $v = $null }
    if (-not $v) { return 'unknown' }
    return "$v"
}
# bash must be Git Bash; C:\Windows\System32\bash.exe is WSL.
function Get-GitBash {
    $cands = @()
    $g = Get-App 'git'
    if ($g) { $cands += Join-Path (Split-Path (Split-Path $g.Source)) 'bin\bash.exe' }
    $cands += "$env:ProgramFiles\Git\bin\bash.exe"
    $cands += "$env:LOCALAPPDATA\Programs\Git\bin\bash.exe"
    foreach ($c in $cands) { if (Test-Path -LiteralPath $c) { return $c } }
    return $null
}
# The repo copy wins; before the first clone the file next to this script is used.
function Find-ModFile {
    $f = Join-Path $RepoPath 'bootstrap\modules.json'
    if (-not (Test-Path -LiteralPath $f)) { $f = Join-Path $PSScriptRoot 'modules.json' }
    if (Test-Path -LiteralPath $f) { return $f }
    return $null
}
# Last useful line of git output; 2>&1 can add an empty-stderr placeholder record that stringifies to its class name.
function Get-LastLine($lines) {
    $l = @($lines | ForEach-Object { "$_".Trim() } | Where-Object { $_ -and $_ -ne 'System.Management.Automation.RemoteException' } | Select-Object -Last 1)
    if ($l.Count) { return $l[0] } else { return '' }
}

# Returns the first problem in a modules.json entry, or $null. Checked up front so StrictMode never fails halfway through a module.
function Get-ModuleError($m) {
    foreach ($k in 'name', 'description', 'check', 'optional', 'run') { if (-not $m.PSObject.Properties[$k]) { return "missing field '$k'" } }
    foreach ($k in 'name', 'description', 'check') { if ($m.$k -isnot [string]) { return "'$k' must be a string" } }
    if (-not $m.name) { return "'name' is empty" }
    if ($m.optional -isnot [bool]) { return "'optional' must be true or false" }
    if ($m.run -isnot [array] -or $m.run.Count -eq 0) { return "'run' must be a non-empty array" }
    foreach ($argv in $m.run) {
        if ($argv -isnot [array] -or $argv.Count -eq 0) { return "'run' entries must be non-empty arrays" }
        foreach ($a in $argv) { if ($a -isnot [string] -or -not $a) { return "'run' arguments must be non-empty strings" } }
    }
    return $null
}

$claudeInstall = '[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12; irm https://claude.ai/install.ps1 | iex'
$prereqs = @(
    @{ Name = 'git';    Id = 'Git.Git' },
    @{ Name = 'node';   Id = 'OpenJS.NodeJS.LTS' },
    @{ Name = 'jq';     Id = 'jqlang.jq' },
    @{ Name = 'rtk';    Id = 'rtk-ai.rtk' },
    @{ Name = 'bun';    Id = 'Oven-sh.Bun' },   # claude-mem needs it; without it its worker never starts
    @{ Name = 'claude'; Id = '' }
)

# ---- reject -Only/-Skip names that match no step (a typo would silently select nothing)
# Module names come from the local modules.json, else from GitHub (read in memory, nothing is written).
if ($Only.Count -gt 0 -or $Skip.Count -gt 0) {
    $known = @($prereqs | ForEach-Object { $_.Name }) + @('repo', 'workroot')
    $why = $null
    try {
        $early = Find-ModFile
        if ($early) { $parsed = Get-Content -LiteralPath $early -Raw | ConvertFrom-Json }
        else {
            $parsed = Invoke-RestMethod -Uri 'https://raw.githubusercontent.com/DevCrop/ai-setup/main/bootstrap/modules.json' -UseBasicParsing -TimeoutSec 15
            if ($parsed -is [string]) { $parsed = $parsed | ConvertFrom-Json }
        }
        foreach ($m in $parsed) { $known += $m.name }
    } catch { $why = $_.Exception.Message }
    $bad = @(@($Only) + @($Skip) | Where-Object { $known -notcontains $_ })
    if ($bad.Count -gt 0) {
        Write-Host ("Unknown step name(s): {0}" -f ($bad -join ', '))
        if ($why) { Write-Host "The module list could not be read ($why), so only these names are valid: $($known -join ', ')" }
        else { Write-Host ("Valid names: {0}" -f ($known -join ', ')) }
        exit 2
    }
}
# ---- 1. prerequisites
foreach ($p in $prereqs) {
    $n = $p.Name
    if (-not (Test-Selected $n)) { Add-Row $n 'skipped' 'not selected'; continue }
    try {
        $v = Get-ToolVersion $n
        if ($v) { Add-Row $n 'ok' "present $v"; continue }
        $wingetMissing = ($n -ne 'claude') -and -not (Get-App 'winget')
        if ($wingetMissing -and -not $DryRun) { Add-Row $n 'failed' 'winget not found: install App Installer from Microsoft Store'; continue }
        if ($n -eq 'claude') {
            $exe = 'powershell'
            $cargs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $claudeInstall)
        } else {
            $exe = 'winget'
            $cargs = @('install', '--id', $p.Id, '-e', '--source', 'winget', '--accept-package-agreements', '--accept-source-agreements')
        }
        if ($DryRun) {
            Write-Plan ("$exe " + ($cargs -join ' '))
            $note = "dry-run: would install $n"
            if ($wingetMissing) { Write-Warning 'winget not found: install App Installer from Microsoft Store'; $note += ' (winget not found now)' }
            $script:Planned[$n] = $true
            Add-Row $n 'ok' $note
            continue
        }
        & $exe @cargs | Out-Host
        $code = $LASTEXITCODE
        Update-Path
        $bin = Join-Path $env:USERPROFILE '.local\bin'
        if ($n -eq 'claude' -and (($env:Path -split ';') -notcontains $bin)) { $env:Path = "$env:Path;$bin" }
        $v = Get-ToolVersion $n
        if ($v) { Add-Row $n 'ok' "installed $v" }
        else { Add-Row $n 'failed' "installer exit $code, $n still not on PATH (open a new terminal and re-run)" }
    } catch {
        Add-Row $n 'failed' $_.Exception.Message
    }
}

# ---- 2. repo
$repoUrl = 'https://github.com/DevCrop/ai-setup.git'
if (-not (Test-Selected 'repo')) { Add-Row 'repo' 'skipped' 'not selected' }
else {
    try {
        $haveGit = Get-App 'git'
        if (-not $haveGit -and -not $script:Planned.ContainsKey('git')) { Add-Row 'repo' 'skipped' 'git missing' }
        elseif (-not (Test-Path -LiteralPath $RepoPath)) {
            if ($DryRun) { Write-Plan "git clone $repoUrl $RepoPath"; Add-Row 'repo' 'ok' "dry-run: would clone to $RepoPath" }
            else {
                & git clone $repoUrl $RepoPath | Out-Host
                if ($LASTEXITCODE -eq 0) { Add-Row 'repo' 'ok' "cloned to $RepoPath" } else { Add-Row 'repo' 'failed' "git clone exit $LASTEXITCODE" }
            }
        }
        elseif (-not (Test-Path -LiteralPath (Join-Path $RepoPath '.git'))) {
            Add-Row 'repo' 'failed' "$RepoPath exists but is not a git repo; not touched"
        }
        else {
            $dirty = @()
            $sc = 0
            if ($haveGit) { $dirty = @(& git --no-optional-locks -C $RepoPath status --porcelain 2>$null); $sc = $LASTEXITCODE }
            if ($sc -ne 0) { Add-Row 'repo' 'failed' "git status exit $sc" }
            elseif ($dirty.Count -gt 0) { Write-Warning 'local changes in the repo, not pulling'; Add-Row 'repo' 'skipped' 'local changes, not pulled' }
            elseif ($DryRun) { Write-Plan "git -C $RepoPath pull --ff-only"; Add-Row 'repo' 'ok' 'dry-run: would pull' }
            else {
                $before = "$(& git -C $RepoPath rev-parse HEAD 2>$null)".Trim()
                $o = @(& git -C $RepoPath pull --ff-only 2>&1 | ForEach-Object { "$_" })
                $code = $LASTEXITCODE
                $o | Out-Host
                # a failed pull (offline, no upstream) is reported but the existing checkout is still usable
                if ($code -eq 0) {
                    $after = "$(& git -C $RepoPath rev-parse HEAD 2>$null)".Trim()
                    if ($before -and $after -ne $before) { Add-Row 'repo' 'ok' ("pulled {0}..{1}" -f $before.Substring(0, 7), $after.Substring(0, 7)) } else { Add-Row 'repo' 'ok' 'up to date' }
                } else { Add-Row 'repo' 'failed' ("git pull exit ${code}: " + (Get-LastLine $o)) }
            }
        }
    } catch { Add-Row 'repo' 'failed' $_.Exception.Message }
}

# ---- 3. work root (per-machine config, never inside the repo)
if (-not (Test-Selected 'workroot')) { Add-Row 'workroot' 'skipped' 'not selected' }
else {
    try {
        $cfgFile = Join-Path (Join-Path $HOME '.ai-setup') 'machine.json'
        $cfg = $null
        $current = $null
        $unreadable = $false
        if (Test-Path -LiteralPath $cfgFile) {
            # only a single JSON object counts: not a scalar, an array, an empty file (pwsh 7 unrolls a one-item array, hence the text check)
            try { $raw = Get-Content -LiteralPath $cfgFile -Raw; $cfg = $raw | ConvertFrom-Json } catch { $cfg = $null; $raw = '' }
            if (($cfg -isnot [System.Management.Automation.PSCustomObject]) -or -not ("$raw".TrimStart().StartsWith('{'))) { $unreadable = $true }
            else {
                $pr = $cfg.PSObject.Properties['workRoot']
                if ($pr -and $pr.Value -is [string] -and $pr.Value) { $current = $pr.Value }
            }
        }
        if ($unreadable) { Add-Row 'workroot' 'failed' 'machine.json unreadable, not overwritten' }
        else {
            # order: explicit -WorkRoot, saved value, drive default
            if ($WorkRoot) { $default = $WorkRoot }
            elseif ($current) { $default = $current }
            elseif ($hasD) { $default = 'D:\work' }
            else { $default = Join-Path $HOME 'work' }
            $chosen = $default
            if (-not $NonInteractive -and -not $DryRun) {
                $ans = Read-Host "Work root [$default]"
                if ($ans -and $ans.Trim()) { $chosen = $ans.Trim() }
            }
            $chosen = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($chosen)
            $prefix = ''
            if ($DryRun) { $prefix = 'dry-run: would ' }
            if (-not (Test-Path -LiteralPath $chosen)) {
                if ($DryRun) { Write-Plan "mkdir $chosen" } else { [void](New-Item -ItemType Directory -Path $chosen -ErrorAction Stop) }
            }
            if ($current -ne $chosen) {
                if ($DryRun) { Write-Plan "write $cfgFile" }
                else {
                    [void](New-Item -ItemType Directory -Path (Split-Path $cfgFile) -Force -ErrorAction Stop)
                    if (-not $cfg) { $cfg = [pscustomobject]@{} }
                    $cfg | Add-Member -NotePropertyName workRoot -NotePropertyValue $chosen -Force
                    [IO.File]::WriteAllText($cfgFile, ($cfg | ConvertTo-Json -Depth 10), (New-Object System.Text.UTF8Encoding($false)))
                }
                Add-Row 'workroot' 'ok' ($prefix + "set work root $chosen")
            } else { Add-Row 'workroot' 'ok' "work root $chosen (unchanged)" }
        }
    } catch { Add-Row 'workroot' 'failed' $_.Exception.Message }
}

# ---- 4. modules
$modFile = Find-ModFile
if (-not $modFile) {
    if ($DryRun) { Add-Row 'modules' 'skipped' 'dry-run: modules.json arrives with the clone' }
    else { Add-Row 'modules' 'failed' 'modules.json not found' }
}
else {
    $mods = $null
    try { $mods = Get-Content -LiteralPath $modFile -Raw | ConvertFrom-Json } catch { Add-Row 'modules' 'failed' "modules.json unreadable: $($_.Exception.Message)" }
    $i = 0
    foreach ($m in $mods) {
        $i++
        $e = Get-ModuleError $m
        if ($e) {
            $label = "#$i"
            if ($m -is [System.Management.Automation.PSCustomObject] -and $m.PSObject.Properties['name'] -and $m.name -is [string] -and $m.name) { $label = $m.name }
            Add-Row 'modules' 'failed' "modules.json entry $label`: $e"
            $mods = $null
            break
        }
    }
    $repoPresent = Test-Path -LiteralPath $RepoPath
    # only an absent repo (or a folder that is not a git repo) blocks modules; a failed pull does not
    $repoBad = -not (Test-Path -LiteralPath (Join-Path $RepoPath '.git'))
    if ($DryRun -and -not $repoPresent) { $repoBad = $false }
    # dry-run before the clone: check files against the checkout this script came from
    if ($repoPresent) { $root = $RepoPath } else { $root = Split-Path $PSScriptRoot }
    $cfgDir = $env:CLAUDE_CONFIG_DIR
    if (-not $cfgDir) { $cfgDir = Join-Path $HOME '.claude' }
    Write-Host "Claude config dir for modules: $cfgDir"
    $stoppedBy = $null
    foreach ($m in $mods) {
        $n = $m.name
        if (-not (Test-Selected $n)) { Add-Row $n 'skipped' 'not selected'; continue }
        if ($stoppedBy) { Add-Row $n 'skipped' "after $stoppedBy failed"; continue }
        if ($repoBad) { Add-Row $n 'skipped' 'repo missing'; continue }
        if ($m.check -and -not (Test-Path -LiteralPath (Join-Path $root $m.check))) { Add-Row $n 'skipped' "not available yet ($($m.check) missing)"; continue }
        Write-Host "== $n : $($m.description)"
        $err = $null
        try {
            foreach ($argv in $m.run) {
                $tool = $argv[0]
                if ($tool -eq 'bash') { $exe = Get-GitBash } else { $a = Get-App $tool; $exe = $null; if ($a) { $exe = $a.Source } }
                # dry-run: the tool may be one of the prerequisites above that would be installed, so show the bare name
                if (-not $exe -and $DryRun) { $exe = $tool }
                if (-not $exe) { $err = "$tool not found"; break }
                $rest = @()
                if ($argv.Count -gt 1) { $rest = @($argv[1..($argv.Count - 1)]) }
                if ($DryRun) { Write-Plan "(cwd $root) $exe $($rest -join ' ')"; continue }
                Push-Location -LiteralPath $root
                try { & $exe @rest | Out-Host; $code = $LASTEXITCODE } finally { Pop-Location }
                if ($code -ne 0) { $err = "exit $code on: $($argv -join ' ')"; break }
            }
        } catch { $err = $_.Exception.Message }
        if ($err) {
            Add-Row $n 'failed' $err
            if (-not $m.optional) { $stoppedBy = $n }
        } elseif ($DryRun) { Add-Row $n 'ok' 'dry-run: would run' }
        else { Add-Row $n 'ok' 'done' }
    }
}

# ---- summary
Write-Host ''
Write-Host ($script:Rows | Format-Table -AutoSize -Wrap | Out-String)
$cnt = @{ ok = 0; skipped = 0; failed = 0 }
foreach ($r in $script:Rows) { $cnt[$r.Status]++ }
Write-Host ("summary: {0} ok, {1} skipped, {2} failed" -f $cnt.ok, $cnt.skipped, $cnt.failed)
if ($cnt.failed -gt 0) { exit 1 } else { exit 0 }
