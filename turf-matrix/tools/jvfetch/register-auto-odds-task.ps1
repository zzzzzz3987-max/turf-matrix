param(
  [string]$TaskName = "TURF MATRIX Live Odds",
  [string]$StartAt = "08:00"
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$Runner = Join-Path $RepoRoot "tools\auto-odds-update.mjs"

if (-not (Test-Path -LiteralPath $Runner)) {
  throw "Automatic odds runner was not found: $Runner"
}

$NodeCandidates = @(
  $env:TURF_MATRIX_NODE,
  (Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"),
  "C:\Program Files\nodejs\node.exe"
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
$Node = $NodeCandidates | Select-Object -First 1
if (-not $Node) {
  throw "node.exe was not found. Set TURF_MATRIX_NODE to its absolute path and rerun."
}

$Time = [DateTime]::ParseExact($StartAt, "HH:mm", [Globalization.CultureInfo]::InvariantCulture)
$Action = New-ScheduledTaskAction `
  -Execute $Node `
  -Argument "`"$Runner`" --watch --lead-minutes=7 --poll-seconds=60" `
  -WorkingDirectory $RepoRoot
$Saturday = New-ScheduledTaskTrigger -Weekly -WeeksInterval 1 -DaysOfWeek Saturday -At $Time
$Sunday = New-ScheduledTaskTrigger -Weekly -WeeksInterval 1 -DaysOfWeek Sunday -At $Time
$Settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -WakeToRun `
  -RestartCount 10 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit (New-TimeSpan -Hours 12) `
  -MultipleInstances IgnoreNew
$Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $Action `
  -Trigger @($Saturday, $Sunday) `
  -Settings $Settings `
  -Principal $Principal `
  -Description "TURF MATRIX: fetch, verify, archive and publish live odds seven minutes before each listed race." `
  -Force | Out-Null

$WatchdogTaskName = "TURF MATRIX Odds Watchdog"
$WatchdogScript = Join-Path $PSScriptRoot "ensure-auto-odds-running.ps1"
$WatchdogArguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$WatchdogScript`" -TaskName `"$TaskName`""
$UserSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$EscapedArguments = [Security.SecurityElement]::Escape($WatchdogArguments)
$EscapedRepoRoot = [Security.SecurityElement]::Escape($RepoRoot)
$WatchdogXml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>TURF MATRIX: weekend race-hours live-odds watchdog.</Description></RegistrationInfo>
  <Triggers>
    <CalendarTrigger>
      <Repetition><Interval>PT5M</Interval><Duration>PT8H</Duration><StopAtDurationEnd>false</StopAtDurationEnd></Repetition>
      <StartBoundary>2026-08-22T09:00:00+09:00</StartBoundary><Enabled>true</Enabled>
      <ScheduleByWeek><WeeksInterval>1</WeeksInterval><DaysOfWeek><Saturday /></DaysOfWeek></ScheduleByWeek>
    </CalendarTrigger>
    <CalendarTrigger>
      <Repetition><Interval>PT5M</Interval><Duration>PT8H</Duration><StopAtDurationEnd>false</StopAtDurationEnd></Repetition>
      <StartBoundary>2026-08-23T09:00:00+09:00</StartBoundary><Enabled>true</Enabled>
      <ScheduleByWeek><WeeksInterval>1</WeeksInterval><DaysOfWeek><Sunday /></DaysOfWeek></ScheduleByWeek>
    </CalendarTrigger>
  </Triggers>
  <Principals><Principal id="Author"><UserId>$UserSid</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><AllowHardTerminate>true</AllowHardTerminate><StartWhenAvailable>true</StartWhenAvailable><RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable><IdleSettings><StopOnIdleEnd>true</StopOnIdleEnd><RestartOnIdle>false</RestartOnIdle></IdleSettings><AllowStartOnDemand>true</AllowStartOnDemand><Enabled>true</Enabled><Hidden>false</Hidden><RunOnlyIfIdle>false</RunOnlyIfIdle><WakeToRun>true</WakeToRun><ExecutionTimeLimit>PT2M</ExecutionTimeLimit><Priority>7</Priority>
  </Settings>
  <Actions Context="Author"><Exec><Command>powershell.exe</Command><Arguments>$EscapedArguments</Arguments><WorkingDirectory>$EscapedRepoRoot</WorkingDirectory></Exec></Actions>
</Task>
"@

Register-ScheduledTask -TaskName $WatchdogTaskName -Xml $WatchdogXml -Force | Out-Null

Get-ScheduledTask -TaskName $TaskName, $WatchdogTaskName | Select-Object TaskName, State, Description
