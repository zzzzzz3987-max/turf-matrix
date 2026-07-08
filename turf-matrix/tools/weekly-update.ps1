param(
  [string]$CommitMessage = ""
)

$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $RepoRoot
$WeekData = Join-Path $PSScriptRoot "week-data.json"
$NextWeekData = Join-Path $PSScriptRoot "week-data.next.json"
$BackupWeekData = Join-Path $PSScriptRoot "week-data.backup.json"

function Run-Step {
  param(
    [string]$Name,
    [scriptblock]$Command
  )

  Write-Host "==> $Name"
  & $Command
  if ($LASTEXITCODE -ne 0) {
    throw "$Name failed with exit code $LASTEXITCODE"
  }
}

try {
  Run-Step "Validate TARGET CSV inputs" { npm run validate:csv }
  Run-Step "Generate week-data safely" { npm run generate-week }

  if (-not (Test-Path $NextWeekData)) {
    throw "Generated file is missing: $NextWeekData"
  }

  if (Test-Path $WeekData) {
    Copy-Item -LiteralPath $WeekData -Destination $BackupWeekData -Force
  }

  Copy-Item -LiteralPath $NextWeekData -Destination $WeekData -Force

  try {
    Run-Step "Build" { npm run build }
  } catch {
    if (Test-Path $BackupWeekData) {
      Copy-Item -LiteralPath $BackupWeekData -Destination $WeekData -Force
    }
    throw
  }

  git diff --quiet -- tools/week-data.json tools/conversion-log.txt tools/llm-enrich-prompt.txt
  $hasDiff = $LASTEXITCODE -ne 0

  if (-not $hasDiff) {
    Write-Host "No weekly data changes detected. Nothing to commit."
    Remove-Item -LiteralPath $NextWeekData -Force -ErrorAction SilentlyContinue
    exit 0
  }

  if ([string]::IsNullOrWhiteSpace($CommitMessage)) {
    $date = Get-Date -Format "yyyy-MM-dd"
    $CommitMessage = "Update weekly race data $date"
  }

  git add tools/week-data.json tools/conversion-log.txt tools/llm-enrich-prompt.txt
  git commit -m $CommitMessage
  git push origin main

  Remove-Item -LiteralPath $NextWeekData -Force -ErrorAction SilentlyContinue

  Write-Host "Weekly update pushed successfully."
} catch {
  Write-Error $_
  Write-Host "Weekly update stopped. No push was performed after the failure."
  exit 1
}
