param(
  [string]$CommitMessage = ""
)

$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $RepoRoot

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
  Run-Step "Build" { npm run build }

  git diff --quiet -- tools/week-data.json tools/conversion-log.txt tools/llm-enrich-prompt.txt
  $hasDiff = $LASTEXITCODE -ne 0

  if (-not $hasDiff) {
    Write-Host "No weekly data changes detected. Nothing to commit."
    exit 0
  }

  if ([string]::IsNullOrWhiteSpace($CommitMessage)) {
    $date = Get-Date -Format "yyyy-MM-dd"
    $CommitMessage = "Update weekly race data $date"
  }

  git add tools/week-data.json tools/conversion-log.txt tools/llm-enrich-prompt.txt
  git commit -m $CommitMessage
  git push origin main

  Write-Host "Weekly update pushed successfully."
} catch {
  Write-Error $_
  Write-Host "Weekly update stopped. No push was performed after the failure."
  exit 1
}
