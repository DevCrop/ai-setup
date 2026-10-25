# Desktop status bar for the Claude setup monitor: a small always-on-top strip above the taskbar.
# Starts the monitor watcher (node scripts/monitor.mjs --watch) if it is not running, then shows status.json from it.
# Left click opens the full monitor in an app window; drag moves the strip; right click has a menu.
# Usage: powershell -NoProfile -STA -ExecutionPolicy Bypass -File scripts\monitor-bar.ps1   (scripts\monitor-bar.vbs runs it hidden)
# One bar per user session (named mutex) and one watcher per output folder (process command-line check).
param([int]$RefreshSec = 30)
Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'

$mutex = New-Object System.Threading.Mutex($false, 'Local\ClaudeMonitorBar')
if (-not $mutex.WaitOne(0)) { exit 0 }

$repo = Split-Path $PSScriptRoot
$dir = Join-Path $env:LOCALAPPDATA 'claude-monitor'
$out = Join-Path $dir 'monitor.html'
$statusFile = Join-Path $dir 'status.json'
[void](New-Item -ItemType Directory -Path $dir -Force)
$startedAt = Get-Date

function Start-Watcher {
    $node = Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $node) { return $false }
    $running = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -and $_.CommandLine -like '*monitor.mjs*' -and $_.CommandLine -like "*$dir*" })
    if ($running.Count -eq 0) {
        $script = Join-Path $repo 'scripts\monitor.mjs'
        Start-Process -FilePath $node.Source -ArgumentList "`"$script`" `"$out`" --watch $RefreshSec" -WindowStyle Hidden
    }
    return $true
}

# Chrome or Edge as an app window (no tabs or address bar); Edge ships with Windows 10/11.
function Open-Detail {
    if (-not (Test-Path -LiteralPath $out)) { return }
    $url = 'file:///' + ($out -replace '\\', '/')
    $cands = @(
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
        "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
        "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe")
    $exe = $cands | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
    if ($exe) { Start-Process -FilePath $exe -ArgumentList "--app=`"$url`"", '--window-size=1280,860' }
    else { Start-Process -FilePath $out }
}

# 12345 -> 1.2만, 1234567 -> 123만, 123456789 -> 1.2억
function Format-Ko([double]$n) {
    if ($n -ge 1e8) { return ('{0:0.#}억' -f ($n / 1e8)) }
    if ($n -ge 1e6) { return ('{0:0}만' -f ($n / 1e4)) }
    if ($n -ge 1e4) { return ('{0:0.#}만' -f ($n / 1e4)) }
    return ('{0:N0}' -f $n)
}

$nodeOk = Start-Watcher

Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase

# Follow the taskbar's light/dark setting, since the strip sits next to it.
$light = $false
try { $light = (Get-ItemPropertyValue 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize' 'SystemUsesLightTheme') -eq 1 } catch { }
if ($light) { $bg = '#F5F6F7'; $fg = '#1B1C1F'; $muted = '#5C5F66'; $line = '#1A000000'; $sep = '#22000000' }
else        { $bg = '#202124'; $fg = '#ECEDEF'; $muted = '#A0A3AA'; $line = '#1FFFFFFF'; $sep = '#2EFFFFFF' }
$tone = @{ ok = '#2FA36B'; warn = '#D9962B'; missing = '#D9534B'; idle = '#8A8D94' }

[xml]$xaml = @"
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="Claude 모니터" WindowStyle="None" AllowsTransparency="True" Background="Transparent"
        Topmost="True" ShowInTaskbar="False" ResizeMode="NoResize" SizeToContent="WidthAndHeight"
        FontFamily="Segoe UI Variable Text, Segoe UI, Malgun Gothic" FontSize="12" UseLayoutRounding="True">
  <Border x:Name="Card" AutomationProperties.Name="Claude 모니터 상태" Background="$bg" BorderBrush="$line" BorderThickness="1" CornerRadius="8" Padding="12,0" Height="34" Cursor="Hand">
    <Border.Effect><DropShadowEffect BlurRadius="12" ShadowDepth="2" Opacity="0.22"/></Border.Effect>
    <StackPanel Orientation="Horizontal" VerticalAlignment="Center">
      <Ellipse x:Name="Dot" Width="8" Height="8" Margin="0,0,8,0" VerticalAlignment="Center"/>
      <TextBlock x:Name="State" Foreground="$fg" FontWeight="SemiBold" VerticalAlignment="Center"/>
      <Rectangle Width="1" Height="14" Fill="$sep" Margin="12,0"/>
      <TextBlock Foreground="$muted" Text="라우팅" Margin="0,0,4,0" VerticalAlignment="Center"/>
      <TextBlock x:Name="Routing" Foreground="$fg" Typography.NumeralAlignment="Tabular" VerticalAlignment="Center"/>
      <TextBlock Foreground="$muted" Text="오늘 출력" Margin="16,0,4,0" VerticalAlignment="Center"/>
      <TextBlock x:Name="Today" Foreground="$fg" Typography.NumeralAlignment="Tabular" VerticalAlignment="Center"/>
      <TextBlock Foreground="$muted" Text="실행 중" Margin="16,0,4,0" VerticalAlignment="Center"/>
      <TextBlock x:Name="Live" Foreground="$fg" Typography.NumeralAlignment="Tabular" VerticalAlignment="Center"/>
      <Rectangle Width="1" Height="14" Fill="$sep" Margin="12,0"/>
      <TextBlock x:Name="Time" Foreground="$muted" Typography.NumeralAlignment="Tabular" VerticalAlignment="Center"/>
    </StackPanel>
  </Border>
</Window>
"@
$win = [Windows.Markup.XamlReader]::Load((New-Object System.Xml.XmlNodeReader $xaml))
$ui = @{}
foreach ($n in 'Card', 'Dot', 'State', 'Routing', 'Today', 'Live', 'Time') { $ui[$n] = $win.FindName($n) }
$brush = { param($hex) (New-Object System.Windows.Media.BrushConverter).ConvertFromString($hex) }

function Show-State($toneKey, $label, $tip) {
    $ui.Dot.Fill = & $brush $tone[$toneKey]
    $ui.State.Text = $label
    $ui.Card.ToolTip = $tip
}

function Update-Bar {
    $dash = '—'
    $s = $null
    if ($nodeOk) { try { $s = Get-Content -LiteralPath $statusFile -Raw -Encoding UTF8 | ConvertFrom-Json } catch { } }
    if (-not $s -or -not $s.generatedAt) {
        $ui.Routing.Text = $dash; $ui.Today.Text = $dash; $ui.Live.Text = $dash; $ui.Time.Text = $dash
        if (-not $nodeOk) { Show-State 'missing' 'node 없음' 'Node.js를 찾지 못해 모니터를 시작할 수 없습니다.' }
        elseif (((Get-Date) - $startedAt).TotalSeconds -lt 180) { Show-State 'idle' '모니터 시작 중' '첫 데이터를 모으는 중입니다.' }
        else { Show-State 'missing' '모니터 꺼짐' 'status.json이 없습니다. 오른쪽 클릭 → 모니터 다시 시작.' }
        return
    }
    $at = [DateTime]::Parse($s.generatedAt).ToLocalTime()
    $every = $RefreshSec
    if ($s.refreshSec) { $every = [int]$s.refreshSec }
    $age = ((Get-Date) - $at).TotalSeconds
    $issues = @($s.issues)
    $tip = if ($issues.Count) { ($issues | ForEach-Object { "· $($_.label): $(if ($_.status -eq 'warn') { '경고' } else { '데이터 없음' })" }) -join "`n" } else { '모든 항목 정상' }
    if ($age -gt 3 * $every) { Show-State 'idle' '모니터 멈춤' ("마지막 갱신 {0:HH:mm}. 오른쪽 클릭 → 모니터 다시 시작." -f $at) }
    elseif ($s.status -eq 'ok') { Show-State 'ok' '정상' $tip }
    elseif ($s.status -eq 'warn') { Show-State 'warn' "확인 필요 $($issues.Count)" $tip }
    else { Show-State 'missing' "문제 $($issues.Count)" $tip }
    $ui.Routing.Text = if ($s.routing.total) { "$($s.routing.ok)/$($s.routing.total)" } else { $dash }
    $ui.Today.Text = Format-Ko ([double]$s.todayOutput)
    $ui.Live.Text = if ($s.live.agents -gt 0) { "세션 $($s.live.sessions) · 에이전트 $($s.live.agents)" } else { "세션 $($s.live.sessions)" }
    $ui.Time.Text = '{0:HH:mm}' -f $at
}

function Move-Default {
    $wa = [System.Windows.SystemParameters]::WorkArea
    $win.Left = $wa.Right - $win.ActualWidth - 12
    $win.Top = $wa.Bottom - $win.ActualHeight - 10
}

# Drag moves the strip; a press without movement is a click.
$win.Add_MouseLeftButtonDown({
    try {
        $l = $win.Left; $t = $win.Top
        try { $win.DragMove() } catch { }
        if ([Math]::Abs($win.Left - $l) -lt 3 -and [Math]::Abs($win.Top - $t) -lt 3) { Open-Detail }
    } catch { Add-Content -LiteralPath (Join-Path $dir 'bar.log') -Value "$(Get-Date -Format s) click: $($_.Exception.Message)" }
})

$menu = New-Object System.Windows.Controls.ContextMenu
function Add-Item($text, $action) {
    $i = New-Object System.Windows.Controls.MenuItem
    $i.Header = $text; $i.Add_Click($action); [void]$menu.Items.Add($i)
}
Add-Item '자세히 보기' { Open-Detail }
Add-Item '지금 새로 읽기' { Update-Bar }
Add-Item '모니터 다시 시작' { $script:nodeOk = Start-Watcher; $script:startedAt = Get-Date; Update-Bar }
Add-Item '오른쪽 아래로' { Move-Default }
[void]$menu.Items.Add((New-Object System.Windows.Controls.Separator))
Add-Item '닫기' { $win.Close() }
$ui.Card.ContextMenu = $menu

$timer = New-Object System.Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromSeconds(5)
$timer.Add_Tick({ Update-Bar })
$win.Add_ContentRendered({ Move-Default })
# Stay above windows that take the topmost slot later.
$win.Add_Deactivated({ $win.Topmost = $false; $win.Topmost = $true })

Update-Bar
$timer.Start()
[void]$win.ShowDialog()
$mutex.ReleaseMutex()
