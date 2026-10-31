# Read-only snapshot of what runs on its own on this PC, as one compact JSON object on stdout.
# Privacy: executable file names only (never arguments), accounts mapped to system/service/user, no authors or SIDs.
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

function ExeName([string]$cmd) {
  if (-not $cmd) { return $null }
  $c = [Environment]::ExpandEnvironmentVariables($cmd.Trim())
  if ($c.StartsWith('"')) { $c = $c.Substring(1); $q = $c.IndexOf('"'); if ($q -ge 0) { $c = $c.Substring(0, $q) } }
  else { $m = [regex]::Match($c, '^.*?\.(exe|com|bat|cmd|ps1|lnk|vbs|js)\b', 'IgnoreCase'); if ($m.Success) { $c = $m.Value } else { $c = ($c -split '\s')[0] } }
  try { return [IO.Path]::GetFileName($c) } catch { return $null }
}
function Iso($d) { if ($d -and $d.Year -ge 2000) { return $d.ToUniversalTime().ToString('o') } return $null }
function Account([string]$u) {
  if (-not $u) { return $null }
  if ($u -match '(^|\\)(SYSTEM|S-1-5-18)$') { return 'system' }
  if ($u -match '(LOCAL SERVICE|NETWORK SERVICE|S-1-5-19|S-1-5-20)$') { return 'service' }
  return 'user'
}
$TRIGGER_KIND = @{ 0 = 'event'; 1 = 'time'; 2 = 'daily'; 3 = 'weekly'; 4 = 'monthly'; 5 = 'monthly'; 6 = 'idle'; 7 = 'registration'; 8 = 'boot'; 9 = 'logon'; 11 = 'session' }

$tasks = New-Object System.Collections.ArrayList
$svc = New-Object -ComObject Schedule.Service
$svc.Connect()
$folders = New-Object System.Collections.Queue
$folders.Enqueue($svc.GetFolder('\'))
while ($folders.Count) {
  $f = $folders.Dequeue()
  foreach ($sub in $f.GetFolders(0)) { $folders.Enqueue($sub) }
  foreach ($t in $f.GetTasks(1)) {
    $trig = @(); $exe = $null; $acct = $null; $elev = $false; $hidden = $false
    try {
      $d = $t.Definition
      foreach ($g in $d.Triggers) { $s = $TRIGGER_KIND[[int]$g.Type]; if (-not $s) { $s = 'other' }; if ($g.Repetition.Interval) { $s += '/' + $g.Repetition.Interval }; $trig += $s }
      foreach ($a in $d.Actions) { if ($a.Type -eq 0) { $exe = ExeName $a.Path; break } }
      if (-not $exe -and @($d.Actions).Count) { $exe = 'COM' }
      $acct = Account $d.Principal.UserId
      if (-not $acct -and $d.Principal.GroupId) { $acct = 'user' }
      $elev = $d.Principal.RunLevel -eq 1
      $hidden = [bool]$d.Settings.Hidden
    } catch {}
    $r = [int]$t.LastTaskResult
    [void]$tasks.Add([ordered]@{
      name = $t.Name; path = $t.Path; state = [int]$t.State; enabled = [bool]$t.Enabled; hidden = $hidden
      lastRun = Iso $t.LastRunTime; nextRun = Iso $t.NextRunTime
      lastResult = '0x{0:X}' -f [BitConverter]::ToUInt32([BitConverter]::GetBytes($r), 0)
      triggers = @($trig); exe = $exe; account = $acct; elevated = $elev
    })
  }
}

# StartupApproved: first byte even = on, odd = off; no entry = on.
$approved = @{}
foreach ($root in 'HKCU', 'HKLM') {
  foreach ($k in 'Run', 'Run32', 'StartupFolder') {
    $p = Get-Item "${root}:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\$k"
    if ($p) { foreach ($n in $p.GetValueNames()) { $b = $p.GetValue($n); if ($b -is [byte[]] -and $b.Length) { $approved[$n] = ($b[0] % 2) -eq 0 } } }
  }
}
$startup = foreach ($s in Get-CimInstance Win32_StartupCommand) {
  $loc = [string]$s.Location
  $folder = $loc -match 'Startup$'
  $key = if ($folder) { ExeName $s.Command } else { $s.Name }
  [ordered]@{
    name = $s.Name
    location = if ($folder) { 'folder' } elseif ($loc -match 'RunOnce') { 'runonce' } else { 'run' }
    scope = if ($loc -match '^HKLM|^Common') { 'all' } else { 'me' }
    exe = ExeName $s.Command
    enabled = if ($approved.ContainsKey($key)) { $approved[$key] } else { $true }
  }
}

$sysRoot = $env:SystemRoot.ToLower()
$all = @(Get-CimInstance Win32_Service)
$autoStopped = foreach ($v in $all | Where-Object { $_.StartMode -eq 'Auto' -and $_.State -ne 'Running' }) { [ordered]@{ name = $v.Name; display = $v.DisplayName; exe = ExeName $v.PathName } }
$third = foreach ($v in $all | Where-Object { $_.PathName -and -not ([Environment]::ExpandEnvironmentVariables(($_.PathName.Trim('"'))).ToLower().StartsWith($sysRoot)) }) {
  [ordered]@{ name = $v.Name; display = $v.DisplayName; state = $v.State; startMode = $v.StartMode; exe = ExeName $v.PathName }
}

[ordered]@{
  tasks = @($tasks)
  startup = @($startup)
  services = [ordered]@{
    total = $all.Count
    running = @($all | Where-Object { $_.State -eq 'Running' }).Count
    auto = @($all | Where-Object { $_.StartMode -eq 'Auto' }).Count
    autoStopped = @($autoStopped)
    thirdParty = @($third)
  }
} | ConvertTo-Json -Compress -Depth 6
