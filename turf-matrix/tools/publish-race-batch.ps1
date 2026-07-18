param([string]$CommitMessage = "")

$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$WeekData = Join-Path $PSScriptRoot "week-data.json"
$NextData = Join-Path $PSScriptRoot "week-data.next.json"
$BackupData = Join-Path $PSScriptRoot "week-data.backup.json"
Set-Location $RepoRoot
$Committed = $false

function Run-Step {
  param([string]$Name, [scriptblock]$Command)
  Write-Host "==> $Name"
  & $Command
  if ($LASTEXITCODE -ne 0) { throw "$Name failed with exit code $LASTEXITCODE" }
}

try {
  $unexpected = git status --porcelain --untracked-files=no | Where-Object { $_ -notmatch "tools/week-data.json$" }
  if ($unexpected) { throw "Tracked changes exist before weekly publish. Commit or revert them first.`n$($unexpected -join "`n")" }

  Run-Step "Generate all race bundles" { npm run generate:race-batch }
  Run-Step "Validate odds and prepare release" { npm run prepare:race-release }

  Copy-Item -LiteralPath $WeekData -Destination $BackupData -Force
  Copy-Item -LiteralPath $NextData -Destination $WeekData -Force

  try {
    Run-Step "Intelligence regression" { npm run test:intelligence }
    Run-Step "Production build" { npm run build }
    Run-Step "Whitespace validation" { git diff --check }
    try {
      Write-Host "==> Archive preodds snapshot"
      npm run archive:preodds
      if ($LASTEXITCODE -ne 0) { Write-Warning "Archive preodds snapshot failed, but publish will continue." }
    } catch {
      Write-Warning "Archive preodds snapshot failed, but publish will continue. $($_.Exception.Message)"
    }
  } catch {
    Copy-Item -LiteralPath $BackupData -Destination $WeekData -Force
    throw
  }

  git diff --quiet -- tools/week-data.json
  if ($LASTEXITCODE -eq 0) {
    Write-Host "No production data changes detected."
    exit 0
  }

  if ([string]::IsNullOrWhiteSpace($CommitMessage)) {
    $date = (Get-Content $NextData -Raw | ConvertFrom-Json).meta.date
    $CommitMessage = "Update weekly races $date"
  }

  git add tools/week-data.json
  Run-Step "Commit weekly race data" { git commit -m $CommitMessage }
  $Committed = $true
  Run-Step "Push main" { git push origin main }
  Write-Host "Race batch published successfully."
} catch {
  if (-not $Committed -and (Test-Path $BackupData)) {
    Copy-Item -LiteralPath $BackupData -Destination $WeekData -Force
  }
  Write-Error $_
  Write-Host "Publish stopped. Existing production data was preserved."
  exit 1
} finally {
  Remove-Item -LiteralPath $NextData -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $BackupData -Force -ErrorAction SilentlyContinue
}
