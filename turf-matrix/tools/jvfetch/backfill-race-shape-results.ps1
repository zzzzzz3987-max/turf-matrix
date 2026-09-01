param(
  [Parameter(Mandatory = $true)]
  [string[]]$Dates,
  [switch]$Force
)

$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$RaceRoot = Join-Path $RepoRoot "data\target\races"
$LiveResults = Join-Path $RepoRoot "data\target\results.latest.json"
$ArchiveRoot = Join-Path $RepoRoot "data\archive"
$TempRoot = Join-Path $RepoRoot "tmp\pace-shape-backfill"
$Runner = Join-Path $PSScriptRoot "run-jvfetch.ps1"
$Backup = Join-Path $TempRoot "results.latest.backup.json"
$PreviousConfig = $env:TURF_MATRIX_RACE_CONFIG

New-Item -ItemType Directory -Path $TempRoot -Force | Out-Null
$HadLiveResults = Test-Path -LiteralPath $LiveResults
if ($HadLiveResults) { Copy-Item -LiteralPath $LiveResults -Destination $Backup -Force }

try {
  foreach ($Date in $Dates) {
    if ($Date -notmatch '^\d{4}-\d{2}-\d{2}$') { throw "Invalid race date: $Date" }
    $Output = Join-Path $ArchiveRoot "$Date-all-race-results.json"
    if ((Test-Path -LiteralPath $Output) -and -not $Force) {
      Write-Host "Skip existing $Output"
      continue
    }

    $Bundles = Get-ChildItem -LiteralPath $RaceRoot -Directory |
      Where-Object { $_.Name -match "^$([regex]::Escape($Date))-[a-z]+-\d{2}R$" } |
      Select-Object -ExpandProperty Name |
      Sort-Object
    if (-not $Bundles) { throw "No stored race bundles found for $Date" }

    $ConfigPath = Join-Path $TempRoot "$Date-races.json"
    $Config = [ordered]@{
      raceDate = $Date
      expectedRaceCount = @($Bundles).Count
      bundles = @($Bundles)
      provisional = $false
      allowMissingRaceName = $true
      allowMissingPastRuns = $true
    }
    $Config | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $ConfigPath -Encoding utf8
    $env:TURF_MATRIX_RACE_CONFIG = $ConfigPath

    Write-Host "Fetch finalized race shape inputs for $Date ($(@($Bundles).Count) races)"
    & $Runner --results-only
    if ($LASTEXITCODE -ne 0) { throw "JV-Link result backfill failed for $Date with exit code $LASTEXITCODE" }
    if (-not (Test-Path -LiteralPath $LiveResults)) { throw "JV-Link did not write $LiveResults" }
    Copy-Item -LiteralPath $LiveResults -Destination $Output -Force
  }
}
finally {
  if ([string]::IsNullOrWhiteSpace($PreviousConfig)) { Remove-Item Env:TURF_MATRIX_RACE_CONFIG -ErrorAction SilentlyContinue }
  else { $env:TURF_MATRIX_RACE_CONFIG = $PreviousConfig }

  if ($HadLiveResults -and (Test-Path -LiteralPath $Backup)) {
    Copy-Item -LiteralPath $Backup -Destination $LiveResults -Force
  } elseif (-not $HadLiveResults) {
    Remove-Item -LiteralPath $LiveResults -Force -ErrorAction SilentlyContinue
  }
}
