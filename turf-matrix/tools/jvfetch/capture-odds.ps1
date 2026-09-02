param()

$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$TargetDir = Join-Path $RepoRoot "data\target"
$StartedAt = (Get-Date).AddSeconds(-2)

& (Join-Path $PSScriptRoot "run-jvfetch.ps1") --odds-only
$FetchExitCode = $LASTEXITCODE

$Candidate = Get-ChildItem -LiteralPath $TargetDir -File |
  Where-Object {
    ($_.Name -eq "odds.csv" -or $_.Name -match '^odds\.next-\d{8}-\d{6}\.csv$') -and
    $_.LastWriteTime -ge $StartedAt
  } |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (-not $Candidate) {
  Write-Error "JV-Link did not produce a new odds CSV. Existing files were not archived."
  exit $(if ($FetchExitCode -ne 0) { $FetchExitCode } else { 2 })
}

& node (Join-Path $RepoRoot "tools\verify-jvfetch-odds.mjs") $Candidate.FullName
if ($LASTEXITCODE -ne 0) {
  Write-Error "The new odds CSV failed verification and was not archived: $($Candidate.FullName)"
  exit $LASTEXITCODE
}

$PairCandidate = Get-ChildItem -LiteralPath $TargetDir -File |
  Where-Object {
    ($_.Name -eq "pair-odds.latest.json" -or $_.Name -match '^pair-odds\.next-\d{8}-\d{6}\.json$') -and
    $_.LastWriteTime -ge $StartedAt
  } |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if ($PairCandidate) {
  & node (Join-Path $RepoRoot "tools\verify-jvfetch-pair-odds.mjs") $PairCandidate.FullName
  $PairVerifyExitCode = $LASTEXITCODE
  if ($PairVerifyExitCode -eq 2) {
    Write-Error "The new pair odds JSON failed verification: $($PairCandidate.FullName)"
    exit $PairVerifyExitCode
  }
  if ($PairVerifyExitCode -eq 1) {
    Write-Warning "Pair odds are partial. Single-win odds remain publishable and unavailable ticket types will be skipped."
  }
} else {
  Write-Warning "JV-Link did not produce fresh pair odds. Single-win odds remain publishable."
}

& node (Join-Path $RepoRoot "tools\archive-odds-snapshot.mjs") $Candidate.FullName
if ($LASTEXITCODE -ne 0) {
  Write-Error "The verified odds CSV could not be archived: $($Candidate.FullName)"
  exit $LASTEXITCODE
}

if ($FetchExitCode -ne 0) {
  Write-Warning "JV-Link returned exit code $FetchExitCode, but its generated candidate passed verification and was archived."
}

exit 0
