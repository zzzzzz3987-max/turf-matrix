param()

$ErrorActionPreference = "Stop"

if ([Environment]::Is64BitOperatingSystem -and [Environment]::Is64BitProcess) {
  $powershell32 = Join-Path $env:WINDIR "SysWOW64\WindowsPowerShell\v1.0\powershell.exe"
  if (-not (Test-Path -LiteralPath $powershell32)) {
    Write-Error "32-bit PowerShell was not found. JV-Link requires a 32-bit process."
    exit 2
  }
  & $powershell32 -NoProfile -ExecutionPolicy Bypass -File $PSCommandPath
  exit $LASTEXITCODE
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$configPath = Join-Path $repoRoot "tools\race-batch-config.json"
$outputPath = Join-Path $PSScriptRoot "output\week-registrations.json"
$manifestPath = Join-Path $PSScriptRoot "output\target-horses.json"
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$raceDate = [DateTime]::ParseExact([string]$config.raceDate, "yyyy-MM-dd", $null)
$fromTime = $raceDate.AddDays(-7).ToString("yyyyMMdd000000")
$encoding = [System.Text.Encoding]::GetEncoding(932)

function Get-JvField {
  param([byte[]]$Bytes, [int]$Start, [int]$Length)
  if ($Bytes.Length -lt $Start) { return "" }
  $available = [Math]::Min($Length, $Bytes.Length - $Start + 1)
  if ($available -le 0) { return "" }
  return $encoding.GetString($Bytes, $Start - 1, $available).Trim()
}

function Convert-PositiveInteger {
  param([string]$Raw)
  [int]$value = 0
  if ([int]::TryParse(([string]$Raw).Trim(), [ref]$value) -and $value -gt 0) { return $value }
  return $null
}

function Convert-Weight {
  param([string]$Raw)
  [int]$value = 0
  if ([int]::TryParse(([string]$Raw).Trim(), [ref]$value) -and $value -gt 0) {
    return [Math]::Round($value / 10, 1)
  }
  return $null
}

$jvLink = $null
$opened = $false
try {
  $jvLink = New-Object -ComObject JVDTLab.JVLink
  $initResult = [int]$jvLink.JVInit("UNKNOWN")
  if ($initResult -ne 0) { throw "JVInit failed with result $initResult." }

  [int]$readCount = 0
  [int]$downloadCount = 0
  [string]$lastFileTime = ""
  $openResult = [int]$jvLink.JVOpen("TOKU", $fromTime, 2, [ref]$readCount, [ref]$downloadCount, [ref]$lastFileTime)
  if ($openResult -ne 0) { throw "JVOpen(TOKU) failed with result $openResult." }
  $opened = $true

  $races = @()
  for ($iteration = 0; $iteration -lt 10000; $iteration++) {
    [string]$buffer = " " * 22000
    [string]$fileName = ""
    $readResult = [int]$jvLink.JVRead([ref]$buffer, 22000, [ref]$fileName)
    if ($readResult -gt 0) {
      $bytes = $encoding.GetBytes($buffer)
      if ((Get-JvField $bytes 1 2) -ne "TK") { continue }
      $year = Get-JvField $bytes 12 4
      $monthDay = Get-JvField $bytes 16 4
      $recordDate = "$year-$($monthDay.Substring(0, 2))-$($monthDay.Substring(2, 2))"
      if ($recordDate -ne $raceDate.ToString("yyyy-MM-dd")) { continue }

      $registrationCount = Convert-PositiveInteger (Get-JvField $bytes 653 3)
      $horses = @()
      $registrationLimit = if ($null -eq $registrationCount) { 0 } else { $registrationCount }
      for ($index = 0; $index -lt [Math]::Min($registrationLimit, 300); $index++) {
        $base = 656 + ($index * 70)
        $horseName = Get-JvField $bytes ($base + 13) 36
        $bloodRegistrationNumber = Get-JvField $bytes ($base + 3) 10
        if (-not $horseName -or -not $bloodRegistrationNumber) { continue }
        $horses += [ordered]@{
          registrationOrder = Convert-PositiveInteger (Get-JvField $bytes $base 3)
          horseNumber = $null
          bracketNumber = $null
          bloodRegistrationNumber = $bloodRegistrationNumber
          horseName = $horseName
          horseSymbolCode = Get-JvField $bytes ($base + 49) 2
          sexCode = Get-JvField $bytes ($base + 51) 1
          affiliationCode = Get-JvField $bytes ($base + 52) 1
          trainerCode = Get-JvField $bytes ($base + 53) 5
          trainerNameShort = Get-JvField $bytes ($base + 58) 8
          carriedWeight = Convert-Weight (Get-JvField $bytes ($base + 66) 3)
          jockeyNameShort = $null
          winOdds = $null
          popularity = $null
        }
      }

      $raceNo = Convert-PositiveInteger (Get-JvField $bytes 26 2)
      $courseCode = Get-JvField $bytes 20 2
      $races += [ordered]@{
        raceKey = "$year$monthDay-$courseCode-$(Get-JvField $bytes 22 2)-$(Get-JvField $bytes 24 2)-$(Get-JvField $bytes 26 2)"
        raceDate = $recordDate
        courseCode = $courseCode
        kaiji = Get-JvField $bytes 22 2
        nichiji = Get-JvField $bytes 24 2
        raceNo = $raceNo
        raceName = Get-JvField $bytes 33 60
        raceNameShort10 = Get-JvField $bytes 573 20
        gradeCode = Get-JvField $bytes 615 1
        distance = Convert-PositiveInteger (Get-JvField $bytes 637 4)
        trackCode = Get-JvField $bytes 641 2
        courseDivision = Get-JvField $bytes 643 2
        registrationCount = $registrationCount
        runners = $horses
      }
      continue
    }
    if ($readResult -eq -3) { Start-Sleep -Milliseconds 200; continue }
    if ($readResult -eq -1) { continue }
    if ($readResult -eq 0) { break }
    throw "JVRead(TOKU) failed with result $readResult."
  }

  $configured = New-Object 'System.Collections.Generic.HashSet[string]'
  foreach ($bundle in $config.bundles) {
    if ([string]$bundle -match '^\d{4}-\d{2}-\d{2}-([a-z]+)-(\d{1,2})R$') {
      $courseCode = @{
        sapporo = "01"; hakodate = "02"; fukushima = "03"; niigata = "04"; tokyo = "05"
        nakayama = "06"; chukyo = "07"; kyoto = "08"; hanshin = "09"; kokura = "10"
      }[$Matches[1]]
      if ($courseCode) { $configured.Add("$courseCode|$([int]$Matches[2])") | Out-Null }
    }
  }
  $selectedRaces = @($races | Where-Object { $configured.Contains("$($_.courseCode)|$([int]$_.raceNo)") })
  if ($selectedRaces.Count -ne $configured.Count) {
    throw "TOKU coverage mismatch: selected=$($selectedRaces.Count), configured=$($configured.Count)."
  }

  $manifestHorses = @{}
  foreach ($race in $selectedRaces) {
    foreach ($horse in $race.runners) {
      $id = [string]$horse.bloodRegistrationNumber
      if (-not $manifestHorses.ContainsKey($id)) {
        $manifestHorses[$id] = [ordered]@{
          bloodRegistrationNumber = $id
          horseName = [string]$horse.horseName
          entries = @()
        }
      }
      $manifestHorses[$id].entries += [ordered]@{
        raceKey = [string]$race.raceKey
        courseCode = [string]$race.courseCode
        raceNo = [int]$race.raceNo
        horseNumber = $null
        registrationOrder = $horse.registrationOrder
      }
    }
  }

  $output = [ordered]@{
    schemaVersion = 1
    mode = "jvlink-toku-preodds"
    productionWeekDataUpdated = $false
    raceDate = $raceDate.ToString("yyyy-MM-dd")
    source = "JV-Link TOKU/TK + RACE/RA"
    generatedAt = (Get-Date).ToString("s")
    expectedRecords = $readCount
    expectedDownloads = $downloadCount
    lastFileTime = $lastFileTime
    raceCount = $selectedRaces.Count
    horseEntryCount = @($selectedRaces | ForEach-Object { $_.runners }).Count
    races = @($selectedRaces | Sort-Object courseCode, raceNo)
  }
  $manifest = [ordered]@{
    schemaVersion = 1
    raceDate = $raceDate.ToString("yyyy-MM-dd")
    source = "JV-Link TOKU/TK"
    horses = @($manifestHorses.Values | Sort-Object horseName)
  }

  New-Item -ItemType Directory -Force -Path (Split-Path $outputPath) | Out-Null
  [System.IO.File]::WriteAllText($outputPath, (($output | ConvertTo-Json -Depth 9) + [Environment]::NewLine), (New-Object System.Text.UTF8Encoding($false)))
  [System.IO.File]::WriteAllText($manifestPath, (($manifest | ConvertTo-Json -Depth 7) + [Environment]::NewLine), (New-Object System.Text.UTF8Encoding($false)))
  Write-Output (($output | Select-Object mode, raceDate, raceCount, horseEntryCount, source | ConvertTo-Json) + [Environment]::NewLine)
} finally {
  if ($opened -and $jvLink) { try { $jvLink.JVClose() | Out-Null } catch {} }
}
