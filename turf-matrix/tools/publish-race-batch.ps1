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
    Run-Step "Refresh Training history" { npm run learn:training:history }
    Run-Step "Refresh Training empirical baselines" { npm run learn:training:baselines }
    Run-Step "Refresh Pace race-shape history" { npm run learn:pace:history }
    Run-Step "Refresh Frame empirical aptitude" { npm run learn:frame:aptitude }
    Run-Step "Intelligence regression" { npm run test:intelligence }
    Run-Step "Production build" { npm run build }
    Run-Step "Freeze Ability pre-race shadow" { npm run shadow:ability:freeze -- --input tools/week-data.next.json }
    Run-Step "Freeze Training pre-race shadow" { npm run shadow:training:freeze -- --input tools/week-data.next.json }
    Run-Step "Freeze Stable operation pre-race shadow" { npm run shadow:stable:freeze -- --input tools/week-data.next.json }
    Run-Step "Freeze Frame aptitude pre-race shadow" { npm run shadow:frame:freeze -- --input tools/week-data.next.json }
    Run-Step "Freeze Form pre-race shadow" { npm run shadow:form:freeze -- --input tools/week-data.next.json }
    Run-Step "Freeze Pace pre-race shadow" { npm run shadow:pace:freeze -- --input tools/week-data.next.json }
    Run-Step "Freeze Pace context pre-race shadow" { npm run shadow:pace-context:freeze -- --input tools/week-data.next.json }
    Run-Step "Freeze public role Pace pre-race shadow" { npm run shadow:public-roles:pace:freeze -- --input tools/week-data.next.json }
    Run-Step "Freeze public role Evidence pre-race shadow" { npm run shadow:public-roles:evidence:freeze -- --input tools/week-data.next.json }
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

  $date = (Get-Content $NextData -Raw | ConvertFrom-Json).meta.date
  $AbilityShadow = "data/shadow/ability-ceiling-v1/$date-pre-race.json"
  $AbilityReport = "docs/analysis/ability-ceiling-shadow-$date.md"
  $TrainingShadow = "data/shadow/training-evidence-v1/$date-pre-race.json"
  $TrainingReport = "docs/analysis/training-evidence-shadow-$date.md"
  $StableShadow = "data/shadow/stable-operation-v2/$date-pre-race.json"
  $StableReport = "docs/analysis/stable-operation-shadow-$date.md"
  $FrameShadow = "data/shadow/frame-aptitude-v2/$date-pre-race.json"
  $FrameReport = "docs/analysis/frame-aptitude-shadow-$date.md"
  $FormShadow = "data/shadow/form-state-v1/$date-pre-race.json"
  $FormReport = "docs/analysis/form-state-shadow-$date.md"
  $PaceShadow = "data/shadow/pace-shape-v2/$date-pre-race.json"
  $PaceReport = "docs/analysis/pace-shape-shadow-$date.md"
  $PaceContextShadow = "data/shadow/pace-context-v1/$date-pre-race.json"
  $PaceContextReport = "docs/analysis/pace-context-shadow-$date.md"
  $PublicRolePaceShadow = "data/shadow/public-role-pace-v3/$date-pre-race.json"
  $PublicRoleEvidenceShadow = "data/shadow/public-role-evidence-v4/$date-pre-race.json"
  git add tools/week-data.json $AbilityShadow $AbilityReport $TrainingShadow $TrainingReport $StableShadow $StableReport $FrameShadow $FrameReport $FormShadow $FormReport $PaceShadow $PaceReport $PaceContextShadow $PaceContextReport $PublicRolePaceShadow $PublicRoleEvidenceShadow data/master/training-history data/master/training-baselines.json data/master/race-shape-history.json data/master/frame-aptitude.json
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
