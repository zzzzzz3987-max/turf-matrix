param(
  [ValidateSet("detect", "probe", "inspect-week", "export-week")]
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

  if ($Action -in @("probe", "inspect-week", "export-week")) {
    $result.initResult = [int]$jvLink.JVInit("UNKNOWN")
    $result.status = if ($result.initResult -eq 0) { "ready" } else { "init-error" }
  }

  if ($Action -in @("inspect-week", "export-week") -and $result.initResult -eq 0) {
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
    $encoding = [System.Text.Encoding]::GetEncoding(932)
    $races = [ordered]@{}
    $runners = @()
    $physicalFiles = New-Object 'System.Collections.Generic.HashSet[string]'
    $downloadWaits = 0
    $completed = $false

    function Get-JvField {
      param(
        [byte[]]$Bytes,
        [int]$Start,
        [int]$Length
      )
      if ($Bytes.Length -lt $Start) { return "" }
      $available = [Math]::Min($Length, $Bytes.Length - $Start + 1)
      if ($available -le 0) { return "" }
      return $encoding.GetString($Bytes, $Start - 1, $available).Trim()
    }

    function Get-RaceKey {
      param([byte[]]$Bytes)
      $year = Get-JvField $Bytes 12 4
      $monthDay = Get-JvField $Bytes 16 4
      $courseCode = Get-JvField $Bytes 20 2
      $kaiji = Get-JvField $Bytes 22 2
      $nichiji = Get-JvField $Bytes 24 2
      $raceNo = Get-JvField $Bytes 26 2
      return "$year$monthDay-$courseCode-$kaiji-$nichiji-$raceNo"
    }

    function Convert-Weight {
      param([string]$Raw)
      if ([string]::IsNullOrWhiteSpace($Raw)) { return $null }
      [int]$value = 0
      if ([int]::TryParse($Raw, [ref]$value) -and $value -gt 0) {
        return [Math]::Round($value / 10, 1)
      }
      return $null
    }

    function Convert-Odds {
      param([string]$Raw)
      if ([string]::IsNullOrWhiteSpace($Raw)) { return $null }
      [int]$value = 0
      if ([int]::TryParse($Raw, [ref]$value) -and $value -gt 0) {
        return [Math]::Round($value / 10, 1)
      }
      return $null
    }

    for ($iteration = 0; $iteration -lt 10000; $iteration++) {
      [string]$buffer = " " * 110000
      [string]$fileName = ""
      $readResult = [int]$jvLink.JVRead([ref]$buffer, 110000, [ref]$fileName)

      if ($readResult -gt 0) {
        $recordId = $buffer.Substring(0, 2)
        $recordBytes = $encoding.GetBytes($buffer)
        if (-not $recordCounts.Contains($recordId)) {
          $recordCounts[$recordId] = 0
          $recordLengths[$recordId] = $readResult
        }
        $recordCounts[$recordId] = [int]$recordCounts[$recordId] + 1
        if ($fileName) { $physicalFiles.Add($fileName) | Out-Null }
        if ($Action -eq "export-week" -and $recordId -eq "RA") {
          $raceKey = Get-RaceKey $recordBytes
          $raceNoRaw = Get-JvField $recordBytes 26 2
          $distanceRaw = Get-JvField $recordBytes 698 4
          $races[$raceKey] = [ordered]@{
            raceKey = $raceKey
            dataKubun = Get-JvField $recordBytes 3 1
            dataCreatedAt = Get-JvField $recordBytes 4 8
            raceDate = "$(Get-JvField $recordBytes 12 4)-$((Get-JvField $recordBytes 16 4).Substring(0, 2))-$((Get-JvField $recordBytes 16 4).Substring(2, 2))"
            courseCode = Get-JvField $recordBytes 20 2
            kaiji = Get-JvField $recordBytes 22 2
            nichiji = Get-JvField $recordBytes 24 2
            raceNo = if ($raceNoRaw) { [int]$raceNoRaw } else { $null }
            raceName = Get-JvField $recordBytes 33 60
            raceNameShort10 = Get-JvField $recordBytes 573 20
            gradeCode = Get-JvField $recordBytes 615 1
            distance = if ($distanceRaw) { [int]$distanceRaw } else { $null }
            trackCode = Get-JvField $recordBytes 706 2
            courseDivision = Get-JvField $recordBytes 710 2
            postTime = Get-JvField $recordBytes 874 4
            runners = if ((Get-JvField $recordBytes 884 2)) { [int](Get-JvField $recordBytes 884 2) } else { $null }
            weatherCode = Get-JvField $recordBytes 888 1
            turfConditionCode = Get-JvField $recordBytes 889 1
            dirtConditionCode = Get-JvField $recordBytes 890 1
          }
        }
        if ($Action -eq "export-week" -and $recordId -eq "SE") {
          $raceKey = Get-RaceKey $recordBytes
          $horseNoRaw = Get-JvField $recordBytes 29 2
          $bodyWeightRaw = Get-JvField $recordBytes 325 3
          $popularityRaw = Get-JvField $recordBytes 364 2
          $runners += [ordered]@{
            raceKey = $raceKey
            dataKubun = Get-JvField $recordBytes 3 1
            horseNumber = if ($horseNoRaw) { [int]$horseNoRaw } else { $null }
            bracketNumber = Get-JvField $recordBytes 28 1
            bloodRegistrationNumber = Get-JvField $recordBytes 31 10
            horseName = Get-JvField $recordBytes 41 36
            sexCode = Get-JvField $recordBytes 79 1
            age = if ((Get-JvField $recordBytes 83 2)) { [int](Get-JvField $recordBytes 83 2) } else { $null }
            affiliationCode = Get-JvField $recordBytes 85 1
            trainerCode = Get-JvField $recordBytes 86 5
            trainerNameShort = Get-JvField $recordBytes 91 8
            ownerName = Get-JvField $recordBytes 105 64
            carriedWeight = Convert-Weight (Get-JvField $recordBytes 289 3)
            jockeyCode = Get-JvField $recordBytes 297 5
            jockeyNameShort = Get-JvField $recordBytes 307 8
            bodyWeight = if ($bodyWeightRaw -match '^\d+$') { [int]$bodyWeightRaw } else { $null }
            bodyWeightDiffSign = Get-JvField $recordBytes 328 1
            bodyWeightDiff = Get-JvField $recordBytes 329 3
            winOdds = Convert-Odds (Get-JvField $recordBytes 360 4)
            popularity = if ($popularityRaw -match '^\d+$' -and [int]$popularityRaw -gt 0) { [int]$popularityRaw } else { $null }
            runningStyleCode = Get-JvField $recordBytes 553 1
          }
        }
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

    if ($Action -eq "export-week") {
      $outDir = Join-Path $repoRoot "tools\jvlink\output"
      New-Item -ItemType Directory -Force -Path $outDir | Out-Null
      $raceList = @($races.Values | Sort-Object raceDate, courseCode, raceNo)
      $targetRaceList = @($raceList | Where-Object { $_.raceDate -eq $raceDate.ToString("yyyy-MM-dd") })
      $runnerGroups = $runners | Group-Object raceKey
      $runnersByRace = [ordered]@{}
      foreach ($group in $runnerGroups) {
        $runnersByRace[$group.Name] = @($group.Group | Sort-Object horseNumber)
      }
      $export = [ordered]@{
        schemaVersion = 1
        mode = "jvlink-week-summary"
        productionWeekDataUpdated = $false
        generatedAt = (Get-Date).ToString("s")
        configuredRaceDate = $raceDate.ToString("yyyy-MM-dd")
        fromTime = $fromTime
        dataDownloaded = $result.dataDownloaded
        records = $recordCounts
        raceCount = $raceList.Count
        targetRaceCount = $targetRaceList.Count
        runnerCount = $runners.Count
        races = $raceList
        runnersByRace = $runnersByRace
      }
      $outPath = Join-Path $outDir "week-race-summary.json"
      [System.IO.File]::WriteAllText(
        $outPath,
        (($export | ConvertTo-Json -Depth 8) + [Environment]::NewLine),
        (New-Object System.Text.UTF8Encoding($false))
      )
      $result["exportPath"] = $outPath
      $result["exportRaceCount"] = $raceList.Count
      $result["targetRaceCount"] = $targetRaceList.Count
      $result["exportRunnerCount"] = $runners.Count
      if ($targetRaceList.Count -eq 0) {
        $result.status = "target-missing"
      }
    }
  }

  $result | ConvertTo-Json -Depth 5
  if ($result.status -eq "init-error") { exit 2 }
  if ($result.status -eq "incomplete") { exit 3 }
  if ($result.status -eq "target-missing") { exit 4 }
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
