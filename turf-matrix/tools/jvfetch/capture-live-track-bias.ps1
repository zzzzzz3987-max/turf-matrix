param(
  [datetime]$Now = (Get-Date),
  [int]$SettlementMinutes = 10,
  [string]$OutputPath = ""
)

$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$ToolsDir = Join-Path $RepoRoot "tools"
$RuntimeDir = Join-Path $ToolsDir "pad-runtime"
$SignalsPath = Join-Path $ToolsDir "all-race-signals.json"
$ResultsPath = Join-Path $RepoRoot "data\target\results.latest.json"
$CapturedResultsPath = Join-Path $RuntimeDir "track-bias-results.current.json"
$SnapshotPath = if ($OutputPath) {
  if ([IO.Path]::IsPathRooted($OutputPath)) { $OutputPath } else { Join-Path $RepoRoot $OutputPath }
} else { Join-Path $ToolsDir "track-bias.current.json" }
$ConfigPath = Join-Path $RuntimeDir "track-bias-results-runtime.json"
$BackupPath = Join-Path $RuntimeDir "results.latest.track-bias-backup.json"
$NodeCandidates = @(
  (Get-Command node.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue),
  (Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"),
  "C:\Program Files\nodejs\node.exe"
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
$NodeExe = $NodeCandidates | Select-Object -First 1

if (-not (Test-Path -LiteralPath $SignalsPath)) { throw "All-race signals are missing: $SignalsPath" }
if (-not $NodeExe) { throw "node.exe was not found for the live track-bias snapshot build" }
New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
$utf8 = New-Object System.Text.UTF8Encoding($false)
$signals = [System.IO.File]::ReadAllText($SignalsPath, $utf8) | ConvertFrom-Json
$raceDate = [datetime]::ParseExact([string]$signals.date, "yyyy-MM-dd", $null)
if ($Now.Date -ne $raceDate.Date) { throw "All-race signals are not for today: $($signals.date)" }
$cutoff = $Now.AddMinutes(-1 * $SettlementMinutes)
$turfSurface = [string][char]0x829D
$dirtSurfaceShort = [string][char]0x30C0
$dirtSurface = "$([char]0x30C0)$([char]0x30FC)$([char]0x30C8)"
$eligible = @($signals.races | Where-Object {
  $_.surface -in @($turfSurface, $dirtSurfaceShort, $dirtSurface) -and
  $_.time -match '^\d{1,2}:\d{2}$' -and
  [datetime]::ParseExact("$($signals.date) $($_.time)", "yyyy-MM-dd HH:mm", $null) -le $cutoff
} | Sort-Object time, track, number)
if ($eligible.Count -lt 3) { throw "Fewer than three finalized-race candidates are available for live bias" }

$hadResults = Test-Path -LiteralPath $ResultsPath
if ($hadResults) { Copy-Item -LiteralPath $ResultsPath -Destination $BackupPath -Force }
$previousConfig = $env:TURF_MATRIX_RACE_CONFIG
$captured = $false
try {
  for ($attempt = 0; $attempt -lt 4 -and $eligible.Count -ge 3; $attempt++) {
    $bundles = @($eligible | ForEach-Object { $_.bundleId })
    $runtime = [ordered]@{
      raceDate = [string]$signals.date
      expectedRaceCount = $bundles.Count
      bundles = $bundles
      provisional = $false
    }
    [System.IO.File]::WriteAllText($ConfigPath, (($runtime | ConvertTo-Json -Depth 4) + [Environment]::NewLine), (New-Object System.Text.UTF8Encoding($false)))
    $env:TURF_MATRIX_RACE_CONFIG = $ConfigPath
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "run-jvfetch.ps1") --results-only
    if ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath $ResultsPath)) {
      Copy-Item -LiteralPath $ResultsPath -Destination $CapturedResultsPath -Force
      $captured = $true
      break
    }
    $latestTime = ($eligible | Select-Object -Last 1).time
    $eligible = @($eligible | Where-Object { $_.time -ne $latestTime })
  }
  if (-not $captured) { throw "JV-Link did not return a complete settled result set for live bias" }
  & $NodeExe (Join-Path $ToolsDir "analyze\build-live-track-bias-snapshot.mjs") "--results=$CapturedResultsPath" "--signals=$SignalsPath" "--out=$SnapshotPath"
  if ($LASTEXITCODE -ne 0) { throw "Live track-bias snapshot build failed" }
}
finally {
  if ($null -eq $previousConfig) { Remove-Item Env:TURF_MATRIX_RACE_CONFIG -ErrorAction SilentlyContinue }
  else { $env:TURF_MATRIX_RACE_CONFIG = $previousConfig }
  if ($hadResults -and (Test-Path -LiteralPath $BackupPath)) { Copy-Item -LiteralPath $BackupPath -Destination $ResultsPath -Force }
  elseif (-not $hadResults -and (Test-Path -LiteralPath $ResultsPath)) { Remove-Item -LiteralPath $ResultsPath -Force }
  Remove-Item -LiteralPath $BackupPath -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $ConfigPath -Force -ErrorAction SilentlyContinue
}

([pscustomobject]@{
  status = "ready"
  sourceRaceCount = $eligible.Count
  sourceThrough = ($eligible | Select-Object -Last 1).time
  output = $SnapshotPath
  productionConnected = $false
}) | ConvertTo-Json -Depth 3
