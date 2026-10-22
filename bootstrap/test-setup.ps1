# Self-check for bootstrap/setup.ps1 and modules.json. No Pester. Only dry-runs are executed: nothing is installed and no setup state is written; fixtures go under %TEMP%\ai-setup-bootstrap-test.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File bootstrap\test-setup.ps1   (also works under pwsh)
Set-StrictMode -Version 2
$dir = $PSScriptRoot
$setup = Join-Path $dir 'setup.ps1'
$script:fail = 0
function Check($name, $ok) {
    if ($ok) { Write-Host "PASS  $name" } else { Write-Host "FAIL  $name"; $script:fail++ }
}
# Child runs under the same host as this test, so 5.1 tests 5.1 and pwsh tests pwsh.
# $path (optional) replaces PATH for the child only; $fakeHome (optional) points its $HOME at a fixture folder (the child is still -DryRun).
function Invoke-Setup([string[]]$extra, [string]$path = '', [string]$script = $setup, [string]$fakeHome = '') {
    $hostExe = (Get-Process -Id $PID).Path
    $oldPath = $env:Path
    $oldHome = @($env:USERPROFILE, $env:HOMEDRIVE, $env:HOMEPATH)
    if ($path) { $env:Path = $path }
    if ($fakeHome) { $env:USERPROFILE = $fakeHome; $env:HOMEDRIVE = Split-Path $fakeHome -Qualifier; $env:HOMEPATH = $fakeHome.Substring(2) }
    try { $out = & $hostExe -NoProfile -ExecutionPolicy Bypass -File $script -DryRun -NonInteractive @extra 2>&1 | ForEach-Object { "$_" }; $code = $LASTEXITCODE }
    finally { $env:Path = $oldPath; $env:USERPROFILE = $oldHome[0]; $env:HOMEDRIVE = $oldHome[1]; $env:HOMEPATH = $oldHome[2] }
    return [pscustomobject]@{ Code = $code; Lines = @($out); Text = (@($out) -join "`n") }
}
# Table rows look like "<step>  <ok|skipped|failed>  <note>"; live lines start with "[step]" so they never match.
function Get-Rows($lines) {
    $rows = @{}
    foreach ($l in $lines) { if ($l -match '^\s*(\S+)\s+(ok|skipped|failed)\s*(.*)$') { $rows[$Matches[1]] = [pscustomobject]@{ Status = $Matches[2]; Note = $Matches[3].Trim() } } }
    return $rows
}
# A missing row is a plain false, never an exception.
function Test-Row($rows, $name, $status, $noteRegex) {
    if (-not $rows.ContainsKey($name)) { return $false }
    return ($rows[$name].Status -eq $status -and $rows[$name].Note -match $noteRegex)
}
function Test-NotSelected($rows, $name) { return (Test-Row $rows $name 'skipped' '^not selected$') }

# ---- modules.json shape
$mods = $null
try { $mods = Get-Content -LiteralPath (Join-Path $dir 'modules.json') -Raw | ConvertFrom-Json } catch { }
Check 'modules.json parses to an array' ($null -ne $mods -and ($mods -is [array]))
$mods = @($mods)
$shape = $true
$names = @()
foreach ($m in $mods) {
    $props = @($m.PSObject.Properties.Name)
    foreach ($k in 'name', 'description', 'check', 'optional', 'run') { if ($props -notcontains $k) { $shape = $false } }
    if (-not $shape) { break }
    $names += $m.name
    if (-not ($m.name -is [string] -and $m.name -and $m.description -is [string] -and $m.check -is [string] -and $m.optional -is [bool])) { $shape = $false }
    $run = $m.run
    if ($run -isnot [array] -or $run.Count -eq 0) { $shape = $false; continue }
    foreach ($argv in $run) {
        if ($argv -isnot [array] -or $argv.Count -eq 0) { $shape = $false; continue }
        foreach ($a in $argv) { if ($a -isnot [string] -or -not $a) { $shape = $false } }
        if ('bash', 'node', 'claude', 'git' -notcontains $argv[0]) { $shape = $false }
    }
}
Check 'every module has the right field types and a valid run list' $shape
Check 'module names are unique' (@($names | Select-Object -Unique).Count -eq $names.Count)
Check 'shipped modules present in order' ((($names | Select-Object -First 4) -join ',') -eq 'ai-setup,claude-plugins,monitor,machine')

# ---- dry-run: nothing written
$cfg = Join-Path $HOME '.ai-setup\machine.json'
$existed = Test-Path -LiteralPath $cfg
$stamp = $null
if ($existed) { $stamp = (Get-Item -LiteralPath $cfg).LastWriteTimeUtc }

$defaultRepo = 'D:\project\ai-setup'
if (-not (Test-Path 'D:\')) { $defaultRepo = Join-Path $HOME 'project\ai-setup' }
$idx = Join-Path $defaultRepo '.git\index'
$idxStamp = $null
if (Test-Path -LiteralPath $idx) { $idxStamp = (Get-Item -LiteralPath $idx).LastWriteTimeUtc }

$r = Invoke-Setup @()
Check 'dry-run exits 0' ($r.Code -eq 0)
$rows = Get-Rows $r.Lines
$expect = @('git', 'node', 'jq', 'rtk', 'claude', 'repo', 'workroot') + $names
$missing = @($expect | Where-Object { -not $rows.ContainsKey($_) })
Check ('summary row for every step' + $(if ($missing.Count) { " (missing: $($missing -join ', '))" } else { '' })) ($missing.Count -eq 0)
Check 'summary line says 0 failed' ($r.Text -match 'summary: \d+ ok, \d+ skipped, 0 failed')
Check 'no output line mentions .credentials or .env' (@($r.Lines | Where-Object { $_ -match '\.credentials|\.env' }).Count -eq 0)
# every module is only planned, and the planned command count matches its run list
$notPlanned = @($names | Where-Object { -not (Test-Row $rows $_ 'ok' '^dry-run: would run$') })
Check ('every module note is "dry-run: would run"' + $(if ($notPlanned.Count) { " (not: $($notPlanned -join ', '))" } else { '' })) ($notPlanned.Count -eq 0)
$planned = @{}
$cur = $null
foreach ($l in $r.Lines) {
    if ($l -match '^== (\S+) :') { $cur = $Matches[1]; $planned[$cur] = 0 }
    elseif ($cur -and $l -match '^\[dry-run\] \(cwd ') { $planned[$cur]++ }
}
$countOk = $true
foreach ($m in $mods) { if (-not $planned.ContainsKey($m.name) -or $planned[$m.name] -ne @($m.run).Count) { $countOk = $false } }
Check 'each module has one [dry-run] (cwd line per run command' $countOk
# explicit -WorkRoot wins and a fresh folder proves the plan is not carried out
$freshWork = Join-Path $env:TEMP ('ai-setup-test-work-' + [guid]::NewGuid().ToString('N'))
$r2 = Invoke-Setup @('-WorkRoot', $freshWork)
Check '-WorkRoot: plans mkdir for the explicit folder' ($r2.Text.Contains("[dry-run] mkdir $freshWork"))
Check '-WorkRoot: folder was not created' (-not (Test-Path -LiteralPath $freshWork))

# ---- -Only / -Skip
$r = Invoke-Setup @('-Only', 'monitor')
$rows = Get-Rows $r.Lines
$others = @($expect | Where-Object { $_ -ne 'monitor' })
$notSel = @($others | Where-Object { Test-NotSelected $rows $_ })
Check '-Only monitor: every other step is "not selected"' ($notSel.Count -eq $others.Count)
Check '-Only monitor: monitor itself runs' (Test-Row $rows 'monitor' 'ok' '^dry-run: would run$')

$r = Invoke-Setup @('-Only', 'monitor,jq')
$rows = Get-Rows $r.Lines
Check '-Only "monitor,jq" (comma string) selects both' ((-not (Test-NotSelected $rows 'jq')) -and $rows.ContainsKey('jq') -and (Test-Row $rows 'monitor' 'ok' '^dry-run') -and (Test-NotSelected $rows 'git'))

$r = Invoke-Setup @('-Skip', 'machine')
$rows = Get-Rows $r.Lines
Check '-Skip machine: machine is "not selected"' ((Test-NotSelected $rows 'machine') -and (Test-Row $rows 'monitor' 'ok' '^dry-run'))

$r = Invoke-Setup @('-Only', 'monitr')
Check 'unknown -Only name: exit 2, lists valid names, runs no step' (($r.Code -eq 2) -and ($r.Text -match 'Valid names: .*monitor') -and ($r.Text -notmatch '\[step\]'))
$r = Invoke-Setup @('-Skip', 'jq,nope')
Check 'unknown -Skip name: exit 2' ($r.Code -eq 2)

# ---- repo path that does not exist: clone is only planned, modules read from the script folder
$tmpRepo = Join-Path $env:TEMP ('ai-setup-test-' + [guid]::NewGuid().ToString('N'))
$r = Invoke-Setup @('-RepoPath', $tmpRepo)
$rows = Get-Rows $r.Lines
Check 'missing repo: dry-run exits 0' ($r.Code -eq 0)
Check 'missing repo: prints [dry-run] git clone' ($r.Text -match '\[dry-run\] git clone')
$listed = @($names | Where-Object { $rows.ContainsKey($_) })
Check 'missing repo: modules are still listed' ($listed.Count -eq $names.Count)
Check 'missing repo: path was not created' (-not (Test-Path -LiteralPath $tmpRepo))

# ---- fresh PC: only setup.ps1 exists (no modules.json next to it, no clone)
$work = Join-Path $env:TEMP 'ai-setup-bootstrap-test'   # reused every run, left in place
$lone = Join-Path $work 'lone'
if (-not (Test-Path -LiteralPath $lone)) { [void](New-Item -ItemType Directory -Path $lone -Force) }
Copy-Item -LiteralPath $setup -Destination $lone -Force
$r = Invoke-Setup @('-RepoPath', $tmpRepo) '' (Join-Path $lone 'setup.ps1')
$rows = Get-Rows $r.Lines
Check 'lone setup.ps1: exit 0 and modules.json row is skipped, not failed' (($r.Code -eq 0) -and (Test-Row $rows 'modules' 'skipped' '^dry-run: modules\.json arrives with the clone$'))

$loneSetup = Join-Path $lone 'setup.ps1'
$r = Invoke-Setup @('-RepoPath', $tmpRepo, '-Only', 'gti') '' $loneSetup
Check 'lone setup.ps1: unknown name "gti" exits 2 (fetched list or "could not be read")' (($r.Code -eq 2) -and ($r.Text -match 'Unknown step name\(s\): gti'))
$r = Invoke-Setup @('-RepoPath', $tmpRepo, '-Only', 'monitor') '' $loneSetup
if ($r.Code -eq 2 -and $r.Text -match 'could not be read') { Write-Host 'SKIP  lone setup.ps1: -Only monitor stays exit 0 (module list not fetchable, offline or not on main yet)' }
else { Check 'lone setup.ps1: -Only monitor stays exit 0 when the module list is fetched' ($r.Code -eq 0) }

# ---- a modules.json entry without "check" fails the modules step and runs nothing
$bad = Join-Path $work 'badmods'
if (-not (Test-Path -LiteralPath $bad)) { [void](New-Item -ItemType Directory -Path $bad -Force) }
Copy-Item -LiteralPath $setup -Destination $bad -Force
[IO.File]::WriteAllText((Join-Path $bad 'modules.json'), '[{"name":"x","description":"d","optional":true,"run":[["node","a.js"]]}]')
$r = Invoke-Setup @('-RepoPath', $tmpRepo) '' (Join-Path $bad 'setup.ps1')
$rows = Get-Rows $r.Lines
Check 'modules.json entry without check: modules failed (names entry and field), exit 1, nothing planned' (($r.Code -eq 1) -and (Test-Row $rows 'modules' 'failed' "entry x: missing field 'check'") -and ($r.Text -notmatch '\(cwd '))

# ---- machine.json that is not a single JSON object is never overwritten (dry-run, fixture $HOME)
$fakeHome = Join-Path $work 'home'
$fakeCfgDir = Join-Path $fakeHome '.ai-setup'
if (-not (Test-Path -LiteralPath $fakeCfgDir)) { [void](New-Item -ItemType Directory -Path $fakeCfgDir -Force) }
$fakeCfg = Join-Path $fakeCfgDir 'machine.json'
$badCfgs = @('"x"', '[1,2]', '5', 'true', '[{"workRoot":"C:\x"}]', '')
$badOk = $true
foreach ($b in $badCfgs) {
    [IO.File]::WriteAllText($fakeCfg, $b)
    $r = Invoke-Setup @() '' $setup $fakeHome
    $rows = Get-Rows $r.Lines
    if (-not ((Test-Row $rows 'workroot' 'failed' 'machine\.json unreadable, not overwritten') -and $r.Code -eq 1)) { $badOk = $false; Write-Host "      machine.json content that was accepted: [$b]" }
}
Check 'machine.json "x", [1,2], 5, true, [{...}] and empty file: workroot failed, exit 1' $badOk
[IO.File]::WriteAllText($fakeCfg, '{"workRoot":"' + $freshWork.Replace('\', '\\') + '","other":1}')
$r = Invoke-Setup @() '' $setup $fakeHome
$rows = Get-Rows $r.Lines
Check 'machine.json with a real object: workroot ok' ((Test-Row $rows 'workroot' 'ok' 'work root') -and $r.Code -eq 0)
$r = Invoke-Setup @('-WorkRoot', (Join-Path $env:TEMP 'ai-setup-test-other')) '' $setup $fakeHome
Check '-WorkRoot wins over the saved machine.json value' ($r.Text.Contains('ai-setup-test-other') -and $r.Text -match 'set work root .*ai-setup-test-other')

# ---- PATH reduced to System32: every missing tool is only planned
$sys32 = Join-Path $env:SystemRoot 'System32'
$r = Invoke-Setup @('-RepoPath', $tmpRepo) $sys32
$rows = Get-Rows $r.Lines
Check 'bare PATH: exit 0 and 0 failed' (($r.Code -eq 0) -and ($r.Text -match 'summary: \d+ ok, \d+ skipped, 0 failed'))
Check 'bare PATH: plans winget install --id Git.Git' ($r.Text -match '\[dry-run\] winget install --id Git\.Git ')
Check 'bare PATH: plans git clone even though git is missing' ($r.Text -match '\[dry-run\] git clone ')
$bareMods = @($names | Where-Object { -not (Test-Row $rows $_ 'ok' '^dry-run: would run$') })
Check 'bare PATH: every module is planned (ok, would run)' ($bareMods.Count -eq 0)
Check 'bare PATH: path was not created' (-not (Test-Path -LiteralPath $tmpRepo))

# ---- git status in dry-run must not refresh .git/index
if ($idxStamp) { Check 'dry-run left the repo .git/index untouched' ((Get-Item -LiteralPath $idx).LastWriteTimeUtc -eq $idxStamp) }
else { Write-Host 'SKIP  repo .git/index not found' }

# ---- dry-run left machine.json alone
$after = Test-Path -LiteralPath $cfg
$same = ($after -eq $existed)
if ($same -and $after) { $same = ((Get-Item -LiteralPath $cfg).LastWriteTimeUtc -eq $stamp) }
Check 'dry-run did not create or change machine.json' $same

if ($script:fail -gt 0) { Write-Host "$($script:fail) check(s) failed"; exit 1 }
Write-Host 'all checks passed'
exit 0
