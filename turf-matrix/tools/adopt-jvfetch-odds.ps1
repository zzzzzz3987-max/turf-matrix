param(
  [string]$SourcePath = ""
)

$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$TargetDir = Join-Path $RepoRoot "data\target"
$TargetPath = Join-Path $TargetDir "odds.csv"

if (-not (Test-Path -LiteralPath $TargetDir)) {
  Write-Error "JV-Link target directory was not found: $TargetDir"
  exit 2
}

if ([string]::IsNullOrWhiteSpace($SourcePath)) {
  $Latest = Get-ChildItem -LiteralPath $TargetDir -Filter "odds.next-*.csv" -File |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if (-not $Latest) {
    Write-Error "No odds.next-*.csv file was found in $TargetDir"
    exit 2
  }
  $SourcePath = $Latest.FullName
}

$Source = Resolve-Path -LiteralPath $SourcePath
if (-not $Source.Path.StartsWith($TargetDir)) {
  Write-Error "Refusing to adopt odds outside data/target: $($Source.Path)"
  exit 2
}

$Lines = Get-Content -LiteralPath $Source.Path -Encoding UTF8
if ($Lines.Count -lt 2) {
  Write-Error "Odds candidate has no rows: $($Source.Path)"
  exit 2
}

$HeaderColumns = $Lines[0].Split(",")
if ($HeaderColumns.Count -lt 9) {
  Write-Error "Odds candidate header must have at least 9 columns: $($Lines[0])"
  exit 2
}

$FirstDataColumns = $Lines[1].Split(",")
if ($FirstDataColumns.Count -lt 9) {
  Write-Error "Odds candidate rows must have at least 9 columns: $($Lines[1])"
  exit 2
}

if (Test-Path -LiteralPath $TargetPath) {
  $BackupDir = Join-Path $TargetDir ("_backup\{0}" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
  New-Item -ItemType Directory -Path $BackupDir | Out-Null
  Copy-Item -LiteralPath $TargetPath -Destination (Join-Path $BackupDir "odds.csv") -Force
}

try {
  Copy-Item -LiteralPath $Source.Path -Destination $TargetPath -Force
}
catch {
  [Console]::Error.WriteLine("Could not replace data/target/odds.csv.")
  [Console]::Error.WriteLine("Candidate remains at: $($Source.Path)")
  [Console]::Error.WriteLine("Close apps that may lock odds.csv, then rerun jvfetch:adopt-odds.")
  exit 1
}

Write-Output (@{
  status = "adopted"
  source = $Source.Path
  target = $TargetPath
  rows = $Lines.Count - 1
} | ConvertTo-Json -Depth 3)
