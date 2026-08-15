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
$WatchdogAction = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$WatchdogScript`" -TaskName `"$TaskName`"" `
  -WorkingDirectory $RepoRoot
$WatchdogStart = [DateTime]::Today.AddHours(7).AddMinutes(55)
if ($WatchdogStart -lt [DateTime]::Now) {
  $WatchdogStart = [DateTime]::Now.AddMinutes(1)
}
$WatchdogTrigger = New-ScheduledTaskTrigger `
  -Once `
  -At $WatchdogStart `
  -RepetitionInterval (New-TimeSpan -Minutes 5) `
  -RepetitionDuration (New-TimeSpan -Days 3650)
$WatchdogSettings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -WakeToRun `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 2) `
  -MultipleInstances IgnoreNew

Register-ScheduledTask `
  -TaskName $WatchdogTaskName `
  -Action $WatchdogAction `
  -Trigger $WatchdogTrigger `
  -Settings $WatchdogSettings `
  -Principal $Principal `
  -Description "TURF MATRIX: restart the live-odds watcher and report missed update windows." `
  -Force | Out-Null

Get-ScheduledTask -TaskName $TaskName, $WatchdogTaskName | Select-Object TaskName, State, Description
