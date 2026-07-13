param(
  [ValidateSet("detect", "probe", "inspect-week")]
  [string]$Action = "detect"
)

$ErrorActionPreference = "Stop"

if ([Environment]::Is64BitOperatingSystem -and [Environment]::Is64BitProcess) {
  $PowerShell32 = Join-Path $env:WINDIR "SysWOW64\WindowsPowerShell\v1.0\powershell.exe"
  if (-not (Test-Path -LiteralPath $PowerShell32)) {
    Write-Error "32-bit PowerShell was not found. JV-Link requires a 32-bit process."
    exit 1
  }

  & $PowerShell32 -NoProfile -ExecutionPolicy Bypass -File $PSCommandPath -Action $Action
  exit $LASTEXITCODE
}

$result = [ordered]@{
  action = $Action
  status = "missing"
  architecture = if ([Environment]::Is64BitProcess) { "x64" } else { "x86" }
  progId = "JVDTLab.JVLink"
  version = $null
  initResult = $null
  dataDownloaded = $false
  serviceKeyRead = $false
}

$jvLink = $null
$jvOpened = $false
try {
  $jvLink = New-Object -ComObject JVDTLab.JVLink
  $result.status = "available"
  $result.version = [string]$jvLink.m_JVLinkVersion

  if ($Action -in @("probe", "inspect-week")) {
    $result.initResult = [int]$jvLink.JVInit("UNKNOWN")
    $result.status = if ($result.initResult -eq 0) { "ready" } else { "init-error" }
  }

  if ($Action -eq "inspect-week" -and $result.initResult -eq 0) {
    $repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
    $configPath = Join-Path $repoRoot "tools\race-batch-config.json"
    if (-not (Test-Path -LiteralPath $configPath)) {
      throw "Race batch config was not found: $configPath"
    }

    $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    $raceDate = [DateTime]::ParseExact([string]$config.raceDate, "yyyy-MM-dd", $null)
    $daysFromMonday = (7 + [int]$raceDate.DayOfWeek - 1) % 7
    $fromTime = $raceDate.AddDays(-$daysFromMonday).ToString("yyyyMMdd000000")

    [int]$readCount = 0
    [int]$downloadCount = 0
    [string]$lastFileTime = ""
    $openResult = [int]$jvLink.JVOpen(
      "RACE",
      $fromTime,
      2,
      [ref]$readCount,
      [ref]$downloadCount,
      [ref]$lastFileTime
    )
    if ($openResult -ne 0) {
      throw "JVOpen failed with result $openResult."
    }
    $jvOpened = $true

    $recordCounts = [ordered]@{}
    $recordLengths = [ordered]@{}
    $physicalFiles = New-Object 'System.Collections.Generic.HashSet[string]'
    $downloadWaits = 0
    $completed = $false

    for ($iteration = 0; $iteration -lt 10000; $iteration++) {
      [string]$buffer = " " * 110000
      [string]$fileName = ""
      $readResult = [int]$jvLink.JVRead([ref]$buffer, 110000, [ref]$fileName)

      if ($readResult -gt 0) {
        $recordId = $buffer.Substring(0, 2)
        if (-not $recordCounts.Contains($recordId)) {
          $recordCounts[$recordId] = 0
          $recordLengths[$recordId] = $readResult
        }
        $recordCounts[$recordId] = [int]$recordCounts[$recordId] + 1
        if ($fileName) { $physicalFiles.Add($fileName) | Out-Null }
        continue
      }

      if ($readResult -eq -3) {
        $downloadWaits++
        Start-Sleep -Milliseconds 200
        continue
      }
      if ($readResult -eq -1) { continue }
      if ($readResult -eq 0) {
        $completed = $true
        break
      }
      throw "JVRead failed with result $readResult."
    }

    $hasRaceRecords = $recordCounts.Contains("RA") -and [int]$recordCounts["RA"] -gt 0
    $hasRunnerRecords = $recordCounts.Contains("SE") -and [int]$recordCounts["SE"] -gt 0
    $result.status = if ($completed -and $hasRaceRecords -and $hasRunnerRecords) { "ready" } else { "incomplete" }
    $result.dataDownloaded = $downloadCount -gt 0
    $result["configuredRaceDate"] = $raceDate.ToString("yyyy-MM-dd")
    $result["fromTime"] = $fromTime
    $result["openResult"] = $openResult
    $result["expectedRecords"] = $readCount
    $result["expectedDownloads"] = $downloadCount
    $result["lastFileTime"] = $lastFileTime
    $result["recordCounts"] = $recordCounts
    $result["recordLengths"] = $recordLengths
    $result["physicalFileCount"] = $physicalFiles.Count
    $result["downloadWaits"] = $downloadWaits
    $result["completed"] = $completed
  }

  $result | ConvertTo-Json -Depth 5
  if ($result.status -eq "init-error") { exit 2 }
  if ($result.status -eq "incomplete") { exit 3 }
} catch {
  $result.status = "error"
  $result["error"] = $_.Exception.Message
  $result | ConvertTo-Json -Depth 5
  exit 1
} finally {
  if ($null -ne $jvLink) {
    if ($jvOpened) {
      try { $jvLink.JVClose() | Out-Null } catch { }
    }
    [System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($jvLink) | Out-Null
  }
}
