param()

$ErrorActionPreference = "Stop"

if ([Environment]::Is64BitOperatingSystem -and [Environment]::Is64BitProcess) {
  $PowerShell32 = Join-Path $env:WINDIR "SysWOW64\WindowsPowerShell\v1.0\powershell.exe"
  if (-not (Test-Path -LiteralPath $PowerShell32)) {
    Write-Error "32-bit PowerShell was not found. JV-Link requires a 32-bit process."
    exit 2
  }
  & $PowerShell32 -NoProfile -ExecutionPolicy Bypass -File $PSCommandPath
  exit $LASTEXITCODE
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$inputPath = Join-Path $PSScriptRoot "output\target-horses.json"
$outputPath = Join-Path $PSScriptRoot "output\intelligence-summary.json"
if (-not (Test-Path -LiteralPath $inputPath)) {
  Write-Error "JV-Link target horse manifest was not found: $inputPath"
  exit 2
}

$manifest = [System.IO.File]::ReadAllText($inputPath, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
$raceDate = [DateTime]::ParseExact([string]$manifest.raceDate, "yyyy-MM-dd", $null)
$targetIds = New-Object 'System.Collections.Generic.HashSet[string]'
$targetNames = @{}
foreach ($horse in $manifest.horses) {
  $registrationNumber = [string]$horse.bloodRegistrationNumber
  if ($registrationNumber) {
    $targetIds.Add($registrationNumber) | Out-Null
    $targetNames[$registrationNumber] = [string]$horse.horseName
  }
}
if ($targetIds.Count -eq 0) {
  Write-Error "Target horse manifest contains no blood registration numbers."
  exit 2
}

$encoding = [System.Text.Encoding]::GetEncoding(932)
$jvLink = $null
$opened = $false

function Get-JvField {
  param([byte[]]$Bytes, [int]$Start, [int]$Length)
  if ($Bytes.Length -lt $Start) { return "" }
  $available = [Math]::Min($Length, $Bytes.Length - $Start + 1)
  if ($available -le 0) { return "" }
  return $encoding.GetString($Bytes, $Start - 1, $available).Trim()
}

function Convert-TenthSeconds {
  param([string]$Raw)
  [int]$value = 0
  if (-not [int]::TryParse(([string]$Raw).Trim(), [ref]$value)) { return $null }
  if ($value -le 0 -or $value -ge 9999) { return $null }
  return [Math]::Round($value / 10, 1)
}

function Convert-PositiveInteger {
  param([string]$Raw)
  [int]$value = 0
  if (-not [int]::TryParse(([string]$Raw).Trim(), [ref]$value)) { return $null }
  if ($value -le 0) { return $null }
  return $value
}

function Convert-RaceTimeSeconds {
  param([string]$Raw)
  $value = ([string]$Raw).Trim()
  if ($value -notmatch '^\d{4}$' -or $value -eq '0000' -or $value -eq '9999') { return $null }
  $minutes = [int]$value.Substring(0, 1)
  $seconds = [int]$value.Substring(1, 2)
  $tenths = [int]$value.Substring(3, 1)
  return [Math]::Round(($minutes * 60) + $seconds + ($tenths / 10), 1)
}

function Convert-TimeDifference {
  param([string]$Raw, [int]$FinishPosition)
  if ($FinishPosition -eq 1) { return 0.0 }
  $value = ([string]$Raw).Trim()
  if ($value -notmatch '^[+-]\d{3}$' -or $value -in @('+999', '-999')) { return $null }
  $magnitude = [int]$value.Substring(1, 3)
  return [Math]::Round($magnitude / 10, 1)
}

function Get-RaceKey {
  param([byte[]]$Bytes)
  return "$(Get-JvField $Bytes 12 4)$(Get-JvField $Bytes 16 4)-$(Get-JvField $Bytes 20 2)-$(Get-JvField $Bytes 22 2)-$(Get-JvField $Bytes 24 2)-$(Get-JvField $Bytes 26 2)"
}

function Read-JvData {
  param(
    [string]$DataSpec,
    [string]$FromTime,
    [int]$Option,
    [scriptblock]$OnRecord
  )
  [int]$readCount = 0
  [int]$downloadCount = 0
  [string]$lastFileTime = ""
  $openResult = [int]$jvLink.JVOpen($DataSpec, $FromTime, $Option, [ref]$readCount, [ref]$downloadCount, [ref]$lastFileTime)
  if ($openResult -ne 0) { throw "JVOpen($DataSpec) failed with result $openResult." }
  $script:opened = $true
  $counts = [ordered]@{}
  $completed = $false
  try {
    for ($iteration = 0; $iteration -lt 200000; $iteration++) {
      [string]$buffer = " " * 110000
      [string]$fileName = ""
      $readResult = [int]$jvLink.JVRead([ref]$buffer, 110000, [ref]$fileName)
      if ($readResult -gt 0) {
        $recordBytes = $encoding.GetBytes($buffer)
        $recordId = Get-JvField $recordBytes 1 2
        if (-not $counts.Contains($recordId)) { $counts[$recordId] = 0 }
        $counts[$recordId] = [int]$counts[$recordId] + 1
        & $OnRecord $recordId $recordBytes
        continue
      }
      if ($readResult -eq -3) { Start-Sleep -Milliseconds 200; continue }
      if ($readResult -eq -1) { continue }
      if ($readResult -eq 0) { $completed = $true; break }
      throw "JVRead($DataSpec) failed with result $readResult."
    }
  } finally {
    $jvLink.JVClose() | Out-Null
    $script:opened = $false
  }
  if (-not $completed) { throw "JVRead($DataSpec) did not complete within the safety limit." }
  return [ordered]@{
    dataSpec = $DataSpec
    fromTime = $FromTime
    option = $Option
    expectedRecords = $readCount
    expectedDownloads = $downloadCount
    lastFileTime = $lastFileTime
    records = $counts
  }
}

$pedigrees = [ordered]@{}
$script:pastRaces = [ordered]@{}
$script:pastRuns = @()
$script:slope = @()
$script:wood = @()
$sources = @()

try {
  $jvLink = New-Object -ComObject JVDTLab.JVLink
  $initResult = [int]$jvLink.JVInit("UNKNOWN")
  if ($initResult -ne 0) { throw "JVInit failed with result $initResult." }

  # JV-Link's option=2 selects the current weekly window. The official SDK
  # example uses a stable historical origin rather than the target week's date.
  $raceWeekFrom = "20030101000000"
  $trainingFrom = $raceDate.AddDays(-45).ToString("yyyyMMdd000000")
  $trainingStartDate = $raceDate.AddDays(-45).ToString("yyyyMMdd")
  $trainingEndDate = $raceDate.ToString("yyyyMMdd")

  $sources += Read-JvData "RCVN" $raceWeekFrom 2 {
    param($recordId, $bytes)
    if ($recordId -eq "RA") {
      $raceKey = Get-RaceKey $bytes
      $script:pastRaces[$raceKey] = [ordered]@{
        raceKey = $raceKey
        raceDate = "$(Get-JvField $bytes 12 4)-$((Get-JvField $bytes 16 4).Substring(0, 2))-$((Get-JvField $bytes 16 4).Substring(2, 2))"
        courseCode = Get-JvField $bytes 20 2
        raceNo = Convert-PositiveInteger (Get-JvField $bytes 26 2)
        raceName = Get-JvField $bytes 33 60
        raceNameShort10 = Get-JvField $bytes 573 20
        gradeCode = Get-JvField $bytes 615 1
        distance = Convert-PositiveInteger (Get-JvField $bytes 698 4)
        trackCode = Get-JvField $bytes 706 2
        fieldSize = Convert-PositiveInteger (Get-JvField $bytes 884 2)
        turfConditionCode = Get-JvField $bytes 889 1
        dirtConditionCode = Get-JvField $bytes 890 1
      }
      return
    }

    if ($recordId -eq "SE") {
      $registrationNumber = Get-JvField $bytes 31 10
      if (-not $targetIds.Contains($registrationNumber)) { return }
      $raceDateRaw = "$(Get-JvField $bytes 12 4)$(Get-JvField $bytes 16 4)"
      if ($raceDateRaw -ge $raceDate.ToString("yyyyMMdd")) { return }
      $finishPosition = Convert-PositiveInteger (Get-JvField $bytes 335 2)
      if ($null -eq $finishPosition) { return }
      $bodyWeightDiff = Convert-PositiveInteger (Get-JvField $bytes 329 3)
      if ($null -ne $bodyWeightDiff -and (Get-JvField $bytes 328 1) -eq "-") { $bodyWeightDiff *= -1 }
      $script:pastRuns += [ordered]@{
        raceKey = Get-RaceKey $bytes
        bloodRegistrationNumber = $registrationNumber
        horseName = Get-JvField $bytes 41 36
        sexCode = Get-JvField $bytes 79 1
        age = Convert-PositiveInteger (Get-JvField $bytes 83 2)
        affiliationCode = Get-JvField $bytes 85 1
        trainerName = Get-JvField $bytes 91 8
        ownerName = Get-JvField $bytes 105 64
        carriedWeight = if ((Get-JvField $bytes 289 3) -match '^\d+$') { [Math]::Round(([int](Get-JvField $bytes 289 3)) / 10, 1) } else { $null }
        jockeyName = Get-JvField $bytes 307 8
        bodyWeight = Convert-PositiveInteger (Get-JvField $bytes 325 3)
        bodyWeightDiff = $bodyWeightDiff
        finishPosition = $finishPosition
        timeSeconds = Convert-RaceTimeSeconds (Get-JvField $bytes 339 4)
        margin = Convert-TimeDifference (Get-JvField $bytes 532 4) $finishPosition
        passingOrder = @(
          Convert-PositiveInteger (Get-JvField $bytes 352 2)
          Convert-PositiveInteger (Get-JvField $bytes 354 2)
          Convert-PositiveInteger (Get-JvField $bytes 356 2)
          Convert-PositiveInteger (Get-JvField $bytes 358 2)
        )
        popularity = Convert-PositiveInteger (Get-JvField $bytes 364 2)
        last3F = Convert-TenthSeconds (Get-JvField $bytes 391 3)
        horseNumber = Convert-PositiveInteger (Get-JvField $bytes 29 2)
        runningStyleCode = Get-JvField $bytes 553 1
      }
      return
    }

    if ($recordId -eq "UM") {
      $registrationNumber = Get-JvField $bytes 12 10
      if (-not $targetIds.Contains($registrationNumber)) { return }
      $ancestors = @()
      for ($index = 0; $index -lt 14; $index++) {
        $start = 205 + ($index * 46)
        $ancestors += [ordered]@{
          registrationNumber = Get-JvField $bytes $start 10
          name = Get-JvField $bytes ($start + 10) 36
        }
      }
      $pedigrees[$registrationNumber] = [ordered]@{
        bloodRegistrationNumber = $registrationNumber
        horseName = Get-JvField $bytes 47 36
        ancestors = $ancestors
      }
    }
  }

  $sources += Read-JvData "SLOP" $trainingFrom 1 {
    param($recordId, $bytes)
    if ($recordId -ne "HC") { return }
    $registrationNumber = Get-JvField $bytes 25 10
    if (-not $targetIds.Contains($registrationNumber)) { return }
    $trainingDate = Get-JvField $bytes 13 8
    if ($trainingDate -lt $trainingStartDate -or $trainingDate -gt $trainingEndDate) { return }
    $script:slope += [ordered]@{
      bloodRegistrationNumber = $registrationNumber
      horseName = $targetNames[$registrationNumber]
      centerCode = Get-JvField $bytes 12 1
      date = $trainingDate
      time = Get-JvField $bytes 21 4
      fourF = Convert-TenthSeconds (Get-JvField $bytes 35 4)
      threeF = Convert-TenthSeconds (Get-JvField $bytes 42 4)
      twoF = Convert-TenthSeconds (Get-JvField $bytes 49 4)
      oneF = Convert-TenthSeconds (Get-JvField $bytes 56 3)
      lap4 = Convert-TenthSeconds (Get-JvField $bytes 39 3)
      lap3 = Convert-TenthSeconds (Get-JvField $bytes 46 3)
      lap2 = Convert-TenthSeconds (Get-JvField $bytes 53 3)
      lap1 = Convert-TenthSeconds (Get-JvField $bytes 56 3)
    }
  }

  $sources += Read-JvData "WOOD" $trainingFrom 1 {
    param($recordId, $bytes)
    if ($recordId -ne "WC") { return }
    $registrationNumber = Get-JvField $bytes 25 10
    if (-not $targetIds.Contains($registrationNumber)) { return }
    $trainingDate = Get-JvField $bytes 13 8
    if ($trainingDate -lt $trainingStartDate -or $trainingDate -gt $trainingEndDate) { return }
    $times = [ordered]@{}
    $laps = [ordered]@{}
    $positions = @(
      @(10, 38, 42), @(9, 45, 49), @(8, 52, 56), @(7, 59, 63), @(6, 66, 70),
      @(5, 73, 77), @(4, 80, 84), @(3, 87, 91), @(2, 94, 98), @(1, 101, 101)
    )
    foreach ($position in $positions) {
      $furlong = [int]$position[0]
      $timeLength = if ($furlong -eq 1) { 3 } else { 4 }
      $times["${furlong}F"] = Convert-TenthSeconds (Get-JvField $bytes ([int]$position[1]) $timeLength)
      $laps["lap$furlong"] = Convert-TenthSeconds (Get-JvField $bytes ([int]$position[2]) 3)
    }
    $script:wood += [ordered]@{
      bloodRegistrationNumber = $registrationNumber
      horseName = $targetNames[$registrationNumber]
      centerCode = Get-JvField $bytes 12 1
      date = $trainingDate
      time = Get-JvField $bytes 21 4
      courseCode = Get-JvField $bytes 35 1
      directionCode = Get-JvField $bytes 36 1
      times = $times
      laps = $laps
    }
  }

  $missingPedigree = @($manifest.horses | Where-Object { -not $pedigrees.Contains([string]$_.bloodRegistrationNumber) } | ForEach-Object { $_.horseName })
  $result = [ordered]@{
    schemaVersion = 1
    mode = "jvlink-intelligence-summary"
    productionWeekDataUpdated = $false
    raceDate = $manifest.raceDate
    generatedAt = (Get-Date).ToString("s")
    targetHorseCount = $targetIds.Count
    pedigreeCount = $pedigrees.Count
    pastRaceCount = $script:pastRaces.Count
    pastRunCount = $script:pastRuns.Count
    slopeCount = $script:slope.Count
    woodCount = $script:wood.Count
    missingPedigree = $missingPedigree
    sources = $sources
    pedigrees = @($pedigrees.Values)
    pastRaces = @($script:pastRaces.Values)
    pastRuns = $script:pastRuns
    slope = $script:slope
    wood = $script:wood
  }
  [System.IO.File]::WriteAllText(
    $outputPath,
    (($result | ConvertTo-Json -Depth 8) + [Environment]::NewLine),
    (New-Object System.Text.UTF8Encoding($false))
  )
  ([pscustomobject]$result) | Select-Object schemaVersion, mode, raceDate, targetHorseCount, pedigreeCount, pastRaceCount, pastRunCount, slopeCount, woodCount, missingPedigree | ConvertTo-Json -Depth 4
  if ($pedigrees.Count -ne $targetIds.Count) { exit 1 }
  exit 0
} catch {
  Write-Error $_.Exception.Message
  exit 2
} finally {
  if ($null -ne $jvLink) {
    if ($opened) { try { $jvLink.JVClose() | Out-Null } catch { } }
    [System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($jvLink) | Out-Null
  }
}
