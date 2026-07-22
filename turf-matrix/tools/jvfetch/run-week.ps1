param(
  [string]$Races = "",
  [switch]$AllRaces
)

$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Push-Location $RepoRoot
try {
  powershell -ExecutionPolicy Bypass -File "tools\jvlink\jvlink-cli.ps1" -Action export-week
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }

  $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
  $nodePath = if ($nodeCommand) { $nodeCommand.Source } else { $null }

  if (-not $nodePath) {
    $bundledNode = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
    if (Test-Path -LiteralPath $bundledNode) {
      $nodePath = $bundledNode
    }
  }

  if (-not $nodePath) {
    Write-Error "Node.js was not found. Install Node.js or add node.exe to PATH."
    exit 2
  }

  $selectionArgs = @("tools\jvlink\select-week-races.mjs")
  if ($AllRaces) {
    $selectionArgs += "--all-races"
  } elseif ($Races) {
    $selectionArgs += @("--races", $Races)
  }
  & $nodePath @selectionArgs
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
  $env:TURF_MATRIX_RACE_CONFIG = Join-Path $RepoRoot "tools\jvlink\output\race-batch-runtime.json"

  & $nodePath "tools\jvlink\export-week-target.mjs"
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }

  powershell -ExecutionPolicy Bypass -File "tools\jvlink\export-intelligence.ps1"
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }

  & $nodePath "tools\jvlink\export-intelligence-target.mjs"
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }

  & $nodePath "tools\verify-jvfetch-week.mjs"
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }

  & $nodePath "tools\verify-jvfetch-normalizer.mjs"
  exit $LASTEXITCODE
}
finally {
  Pop-Location
}
