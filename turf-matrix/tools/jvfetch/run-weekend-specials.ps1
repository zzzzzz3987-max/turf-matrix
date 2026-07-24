param(
  [ValidateSet("Saturday", "Sunday")]
  [string]$Day,
  [string]$RaceDate = ""
)

$ErrorActionPreference = "Stop"

if (-not $RaceDate) {
  $today = (Get-Date).Date
  $targetDay = [System.DayOfWeek]::$Day
  $daysUntilTarget = (7 + [int]$targetDay - [int]$today.DayOfWeek) % 7
  $RaceDate = $today.AddDays($daysUntilTarget).ToString("yyyy-MM-dd")
}

Write-Host "[INFO] Target: $Day $RaceDate (graded and special races)"
& (Join-Path $PSScriptRoot "run-week.ps1") -RaceDate $RaceDate -Specials
exit $LASTEXITCODE
