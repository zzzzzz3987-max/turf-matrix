param(
  [string]$TaskName = "TURF MATRIX Live Odds"
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$WeekDataPath = Join-Path $RepoRoot "tools\week-data.json"
$AllRaceSignalsPath = Join-Path $RepoRoot "tools\all-race-signals.json"
$RuntimeDir = Join-Path $RepoRoot "tools\pad-runtime"
$UpdaterStatePath = Join-Path $RuntimeDir "odds-auto-update-state.json"
$WatchdogStatePath = Join-Path $RuntimeDir "odds-watchdog-state.json"
$AlertPath = Join-Path $RuntimeDir "odds-auto-update-alert.json"
$LogPath = Join-Path $RuntimeDir "odds-watchdog.log"

New-Item -ItemType Directory -Path $RuntimeDir -Force | Out-Null

function Write-WatchdogLog {
  param([string]$Level, [string]$Message)
  $line = "{0} [{1}] {2}" -f ([DateTimeOffset]::Now.ToString("o")), $Level, $Message
  Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8
}

function Show-OperatorAlert {
  param([string]$Message)
  $alert = [PSCustomObject]@{
    status = "active"
    detectedAt = [DateTimeOffset]::Now.ToString("o")
    message = $Message
  }
  $alert | ConvertTo-Json | Set-Content -LiteralPath $AlertPath -Encoding UTF8
}

if (-not (Test-Path -LiteralPath $WeekDataPath)) {
  Write-WatchdogLog "ERROR" "week-data.json was not found."
  exit 2
}

$week = Get-Content -LiteralPath $WeekDataPath -Raw -Encoding UTF8 | ConvertFrom-Json
$raceDate = [string]$week.meta.date
$today = [DateTimeOffset]::Now.ToString("yyyy-MM-dd")
if ($raceDate -ne $today) {
  exit 0
}

$scheduleSource = @($week.races)
if (Test-Path -LiteralPath $AllRaceSignalsPath) {
  $allRaceSignals = Get-Content -LiteralPath $AllRaceSignalsPath -Raw -Encoding UTF8 | ConvertFrom-Json
  if ([string]$allRaceSignals.date -eq $raceDate -and @($allRaceSignals.races).Count -gt 0) {
    $scheduleSource = @($allRaceSignals.races)
  }
}

$races = @($scheduleSource | ForEach-Object {
  $postTime = [DateTimeOffset]::Parse("$raceDate`T$($_.time):00+09:00")
  [PSCustomObject]@{
    Id = [string]$_.id
    Label = "$($_.track)$($_.number)R"
    PostTime = $postTime
    TriggerTime = $postTime.AddMinutes(-7)
  }
})

if ($races.Count -eq 0) {
  Write-WatchdogLog "ERROR" "No races were found for today."
  exit 2
}

$now = [DateTimeOffset]::Now
$windowStart = ($races | Sort-Object TriggerTime | Select-Object -First 1).TriggerTime.AddMinutes(-15)
$windowEnd = ($races | Sort-Object PostTime | Select-Object -Last 1).PostTime.AddMinutes(10)
if ($now -lt $windowStart -or $now -gt $windowEnd) {
  exit 0
}

$watchdogState = if (Test-Path -LiteralPath $WatchdogStatePath) {
  Get-Content -LiteralPath $WatchdogStatePath -Raw -Encoding UTF8 | ConvertFrom-Json
} else {
  [PSCustomObject]@{ raceDate = $raceDate; notifiedMisses = @(); restartCount = 0 }
}
if ([string]$watchdogState.raceDate -ne $raceDate) {
  $watchdogState = [PSCustomObject]@{ raceDate = $raceDate; notifiedMisses = @(); restartCount = 0 }
}

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $task) {
  Write-WatchdogLog "ERROR" "Live odds task is not registered."
  Show-OperatorAlert "The live odds task is not registered."
  exit 2
}

if ($task.State -ne "Running") {
  $restarted = $false
  for ($attempt = 1; $attempt -le 3 -and -not $restarted; $attempt++) {
    Start-ScheduledTask -TaskName $TaskName
    Start-Sleep -Seconds 3
    $restarted = (Get-ScheduledTask -TaskName $TaskName).State -eq "Running"
    if (-not $restarted) {
      Start-Sleep -Seconds 2
    }
  }
  if (-not $restarted) {
    Write-WatchdogLog "ERROR" "Live odds task could not be restarted after 3 attempts."
    Show-OperatorAlert "The live odds task failed to restart after 3 attempts."
    exit 2
  }
  $watchdogState.restartCount = [int]$watchdogState.restartCount + 1
  Write-WatchdogLog "RECOVERED" "Restarted stopped live odds task (previous state=$($task.State))."
  Show-OperatorAlert "The stopped live odds task was restarted."
}

$updaterState = if (Test-Path -LiteralPath $UpdaterStatePath) {
  Get-Content -LiteralPath $UpdaterStatePath -Raw -Encoding UTF8 | ConvertFrom-Json
} else {
  [PSCustomObject]@{ processed = [PSCustomObject]@{} }
}
$processedIds = @($updaterState.processed.PSObject.Properties | Where-Object { $_.Value.status -eq "published" } | ForEach-Object Name)
$notified = @($watchdogState.notifiedMisses)
$missed = @($races | Where-Object { $now -ge $_.PostTime -and $_.Id -notin $processedIds })
$newMisses = @($missed | Where-Object { $_.Id -notin $notified })

if ($newMisses.Count -gt 0) {
  $labels = ($newMisses | ForEach-Object Label) -join "/"
  Write-WatchdogLog "ERROR" "Missed odds update window: $labels"
  Show-OperatorAlert "Missed odds update window: $labels"
  $watchdogState.notifiedMisses = @($notified + ($newMisses | ForEach-Object Id) | Select-Object -Unique)
}

$watchdogState | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $WatchdogStatePath -Encoding UTF8
exit 0
