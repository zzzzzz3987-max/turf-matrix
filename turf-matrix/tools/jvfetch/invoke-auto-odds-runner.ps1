param(
  [int]$LeadMinutes = 7,
  [int]$PollSeconds = 60,
  [string]$InputRoot = "",
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$RuntimeDir = Join-Path $RepoRoot "tools\pad-runtime"
$AlertPath = Join-Path $RuntimeDir "odds-auto-update-alert.json"
$DependencyStampPath = Join-Path $RuntimeDir "package-lock.sha256"
$Runner = Join-Path $RepoRoot "tools\auto-odds-update.mjs"
$PublishPaths = @(
  "tools/all-race-signals.json",
  "tools/week-data.batch-candidate.json",
  "tools/week-data.json"
)

New-Item -ItemType Directory -Path $RuntimeDir -Force | Out-Null

function Find-Executable {
  param([string[]]$Candidates, [string]$Label)
  $resolved = $Candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
  if (-not $resolved) {
    throw "$Label was not found."
  }
  return $resolved
}

function Invoke-Checked {
  param([string]$Command, [string[]]$Arguments)
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Command $($Arguments -join ' ') failed with exit code $LASTEXITCODE."
  }
}

function Set-RunnerAlert {
  param([string]$Message)
  $now = [DateTimeOffset]::Now.ToString("o")
  $current = $null
  if (Test-Path -LiteralPath $AlertPath) {
    try { $current = Get-Content -LiteralPath $AlertPath -Raw -Encoding UTF8 | ConvertFrom-Json } catch { $current = $null }
  }
  if ($current -and [string]$current.status -eq "active" -and [string]$current.message -eq $Message) {
    $current.lastSeenAt = $now
    $current.occurrences = [int]$current.occurrences + 1
    $current | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $AlertPath -Encoding UTF8
    return
  }
  [PSCustomObject]@{
    status = "active"
    detectedAt = $now
    lastSeenAt = $now
    occurrences = 1
    message = $Message
    codexNotifiedAt = $null
  } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $AlertPath -Encoding UTF8
}

function Copy-InputDirectory {
  param([string]$RelativePath)
  $source = Join-Path $InputRoot $RelativePath
  if (-not (Test-Path -LiteralPath $source)) {
    throw "Required automation input directory is missing: $source"
  }
  $destination = Join-Path $RepoRoot $RelativePath
  $destinationFull = [IO.Path]::GetFullPath($destination)
  $repoFull = [IO.Path]::GetFullPath($RepoRoot).TrimEnd('\') + '\'
  if (-not $destinationFull.StartsWith($repoFull, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Automation input destination escaped the isolated runner: $destinationFull"
  }
  New-Item -ItemType Directory -Path $destinationFull -Force | Out-Null
  Get-ChildItem -LiteralPath $source -Force | Copy-Item -Destination $destinationFull -Recurse -Force
}

function Copy-InputChildDirectories {
  param([string]$RelativePath)
  $source = Join-Path $InputRoot $RelativePath
  if (-not (Test-Path -LiteralPath $source)) {
    throw "Required automation input directory is missing: $source"
  }
  $destination = Join-Path $RepoRoot $RelativePath
  New-Item -ItemType Directory -Path $destination -Force | Out-Null
  Get-ChildItem -LiteralPath $source -Directory -Force | Copy-Item -Destination $destination -Recurse -Force
}

function Copy-InputFile {
  param([string]$RelativePath, [bool]$Required = $true)
  $source = Join-Path $InputRoot $RelativePath
  if (-not (Test-Path -LiteralPath $source)) {
    if ($Required) { throw "Required automation input file is missing: $source" }
    return
  }
  $destination = Join-Path $RepoRoot $RelativePath
  New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
  Copy-Item -LiteralPath $source -Destination $destination -Force
}

try {
  if (-not $InputRoot) { throw "InputRoot is required for the isolated odds runner." }
  $InputRoot = (Resolve-Path $InputRoot).Path
  if ([IO.Path]::GetFullPath($InputRoot).TrimEnd('\') -eq [IO.Path]::GetFullPath($RepoRoot).TrimEnd('\')) {
    throw "InputRoot must be separate from the isolated runner."
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
  $Npm = @(
    (Join-Path (Split-Path -Parent $Node) "npm.cmd"),
    "C:\Program Files\nodejs\npm.cmd"
  ) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
  $Pnpm = @(
    (Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd")
  ) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
  if (-not $Npm -and -not $Pnpm) { throw "npm.cmd or pnpm.cmd was not found." }
  $env:PATH = "$(Split-Path -Parent $Node);$env:PATH"

  Push-Location $RepoRoot
  try {
    $branch = (& $Git branch --show-current).Trim()
    if ($LASTEXITCODE -ne 0 -or $branch -ne "main") {
      throw "The isolated odds runner must be on main (current=$branch)."
    }

    $trackedChanges = @(& $Git status --porcelain --untracked-files=no)
    if ($LASTEXITCODE -ne 0) { throw "Unable to inspect the isolated runner worktree." }
    if ($trackedChanges.Count -gt 0) {
      $changedPaths = @($trackedChanges | ForEach-Object { $_.Substring(3).Replace("\", "/") })
      $unexpected = @($changedPaths | Where-Object { $_ -notin $PublishPaths })
      if ($unexpected.Count -gt 0) {
        throw "Unexpected tracked changes in isolated runner: $($unexpected -join ', ')"
      }
      Invoke-Checked $Git (@("restore", "--") + $PublishPaths)
    }

    Invoke-Checked $Git @("fetch", "origin", "main")
    $ahead = [int]((& $Git rev-list --count origin/main..HEAD).Trim())
    $behind = [int]((& $Git rev-list --count HEAD..origin/main).Trim())
    if ($ahead -gt 0 -and $behind -eq 0) {
      Invoke-Checked $Git @("push", "origin", "main")
      Invoke-Checked $Git @("fetch", "origin", "main")
    } elseif ($ahead -gt 0 -and $behind -gt 0) {
      throw "The isolated odds runner diverged from origin/main (ahead=$ahead, behind=$behind)."
    }
    Invoke-Checked $Git @("pull", "--ff-only", "origin", "main")

    $packageLock = Join-Path $RepoRoot "package-lock.json"
    $nodeModules = Join-Path $RepoRoot "node_modules"
    $packageHash = if (Test-Path -LiteralPath $packageLock) { (Get-FileHash -LiteralPath $packageLock -Algorithm SHA256).Hash } else { "none" }
    $installedHash = if (Test-Path -LiteralPath $DependencyStampPath) { (Get-Content -LiteralPath $DependencyStampPath -Raw).Trim() } else { "" }
    if (-not (Test-Path -LiteralPath $nodeModules) -or $installedHash -ne $packageHash) {
      if ($Npm) {
        Invoke-Checked $Npm @("ci", "--no-audit", "--no-fund")
      } else {
        @"
allowBuilds:
  esbuild: true
"@ | Set-Content -LiteralPath (Join-Path $RepoRoot "pnpm-workspace.yaml") -Encoding UTF8
        Invoke-Checked $Pnpm @("install", "--lockfile=false", "--no-frozen-lockfile")
      }
      Set-Content -LiteralPath $DependencyStampPath -Value $packageHash -Encoding ASCII
    }

    Copy-InputDirectory "data\target"
    Copy-InputChildDirectories "tools\csv\input\races"
    Copy-InputChildDirectories "tools\target-html\input\races"
    Copy-InputFile "tools\jvlink\output\target-horses.json"
    Copy-InputFile "tools\jvlink\output\all-races-data-config.json"
    Copy-InputFile "tools\jvlink\output\race-batch-runtime.json" $false
    Copy-InputFile "tools\jvlink\output\race-batch-all36.json" $false

    $runnerArguments = if ($DryRun) {
      @($Runner, "--dry-run", "--lead-minutes=$LeadMinutes", "--poll-seconds=$PollSeconds")
    } else {
      @($Runner, "--watch", "--lead-minutes=$LeadMinutes", "--poll-seconds=$PollSeconds")
    }
    Invoke-Checked $Node $runnerArguments
  } finally {
    Pop-Location
  }
} catch {
  Set-RunnerAlert $_.Exception.Message
  throw
}
