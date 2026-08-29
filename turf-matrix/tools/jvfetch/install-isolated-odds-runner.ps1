param(
  [string]$RunnerRoot = (Join-Path $env:LOCALAPPDATA "TurfMatrix\odds-runner"),
  [string]$StartAt = "08:00"
)

$ErrorActionPreference = "Stop"
$SourceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path

function Find-Executable {
  param([string[]]$Candidates, [string]$Label)
  $resolved = $Candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
  if (-not $resolved) { throw "$Label was not found." }
  return $resolved
}

function Invoke-Checked {
  param([string]$Command, [string[]]$Arguments, [string]$WorkingDirectory = $SourceRoot)
  Push-Location $WorkingDirectory
  try {
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Command $($Arguments -join ' ') failed with exit code $LASTEXITCODE." }
  } finally {
    Pop-Location
  }
}

$Git = Find-Executable -Label "git.exe" -Candidates @(
  $env:TURF_MATRIX_GIT,
  (Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\native\git\cmd\git.exe"),
  "C:\Program Files\Git\cmd\git.exe"
)
$Node = Find-Executable -Label "node.exe" -Candidates @(
  $env:TURF_MATRIX_NODE,
  (Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"),
  "C:\Program Files\nodejs\node.exe"
)
$Npm = Find-Executable -Label "npm.cmd" -Candidates @(
  (Join-Path (Split-Path -Parent $Node) "npm.cmd"),
  "C:\Program Files\nodejs\npm.cmd"
)

$SourceFull = [IO.Path]::GetFullPath($SourceRoot).TrimEnd('\')
$RunnerFull = [IO.Path]::GetFullPath($RunnerRoot).TrimEnd('\')
if ($SourceFull -eq $RunnerFull) {
  throw "RunnerRoot must be separate from the development worktree."
}

$origin = (& $Git -C $SourceRoot remote get-url origin).Trim()
if ($LASTEXITCODE -ne 0 -or -not $origin) { throw "Unable to resolve origin from $SourceRoot." }

if (-not (Test-Path -LiteralPath $RunnerFull)) {
  $parent = Split-Path -Parent $RunnerFull
  New-Item -ItemType Directory -Path $parent -Force | Out-Null
  Invoke-Checked $Git @("clone", "--branch", "main", "--single-branch", $origin, $RunnerFull)
} elseif (-not (Test-Path -LiteralPath (Join-Path $RunnerFull ".git"))) {
  throw "RunnerRoot exists but is not a Git clone: $RunnerFull"
}

$dirty = @(& $Git -C $RunnerFull status --porcelain --untracked-files=no)
if ($LASTEXITCODE -ne 0 -or $dirty.Count -gt 0) {
  throw "The isolated runner contains tracked changes. Resolve them before reinstalling: $RunnerFull"
}
Invoke-Checked $Git @("fetch", "origin", "main") $RunnerFull
Invoke-Checked $Git @("pull", "--ff-only", "origin", "main") $RunnerFull
Invoke-Checked $Npm @("ci", "--no-audit", "--no-fund") $RunnerFull

$sourceName = ([string](& $Git -C $SourceRoot config user.name)).Trim()
$sourceEmail = ([string](& $Git -C $SourceRoot config user.email)).Trim()
if ($sourceName) { Invoke-Checked $Git @("config", "user.name", $sourceName) $RunnerFull }
if ($sourceEmail) { Invoke-Checked $Git @("config", "user.email", $sourceEmail) $RunnerFull }

$register = Join-Path $RunnerFull "tools\jvfetch\register-auto-odds-task.ps1"
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $register -StartAt $StartAt
if ($LASTEXITCODE -ne 0) { throw "Scheduled task registration failed." }

Write-Host "Isolated odds runner installed: $RunnerFull"
Write-Host "Development worktree:          $SourceFull"
Write-Host "The scheduled task now runs only from the isolated clone."
