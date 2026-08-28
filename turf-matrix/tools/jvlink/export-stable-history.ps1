param(
  [Parameter(Mandatory = $true)][string]$StartDate,
  [Parameter(Mandatory = $true)][string]$EndDate,
  [string]$OutputPath = "",
  [ValidateSet("normal", "setup")][string]$Mode = "normal",
  [switch]$Confirm
)

$ErrorActionPreference = "Stop"

if ([Environment]::Is64BitOperatingSystem -and [Environment]::Is64BitProcess) {
  $PowerShell32 = Join-Path $env:WINDIR "SysWOW64\WindowsPowerShell\v1.0\powershell.exe"
  if (-not (Test-Path -LiteralPath $PowerShell32)) { throw "32-bit PowerShell was not found. JV-Link requires a 32-bit process." }
  $arguments = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $PSCommandPath, "-StartDate", $StartDate, "-EndDate", $EndDate, "-Mode", $Mode)
  if ($OutputPath) { $arguments += @("-OutputPath", $OutputPath) }
  if ($Confirm) { $arguments += "-Confirm" }
  & $PowerShell32 @arguments
  exit $LASTEXITCODE
}

$start = [DateTime]::ParseExact($StartDate, "yyyy-MM-dd", $null)
$end = [DateTime]::ParseExact($EndDate, "yyyy-MM-dd", $null)
if ($end -le $start) { throw "EndDate must be later than StartDate (exclusive end)." }
if (($end - $start).TotalDays -gt 31) { throw "One export is limited to 31 days. Split larger backfills into monthly windows." }

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
if (-not $OutputPath) {
  $directory = Join-Path $PSScriptRoot "output\stable-history"
  $OutputPath = Join-Path $directory "$($start.ToString('yyyyMMdd'))-$($end.ToString('yyyyMMdd')).json"
} elseif (-not [System.IO.Path]::IsPathRooted($OutputPath)) {
  $OutputPath = Join-Path $repoRoot $OutputPath
}

$plan = [ordered]@{
  mode = "JV-Link stable-training history $Mode export"
  startDate = $start.ToString("yyyy-MM-dd")
  endDateExclusive = $end.ToString("yyyy-MM-dd")
  trainingLookbackStart = $start.AddDays(-45).ToString("yyyy-MM-dd")
  option = if ($Mode -eq "setup") { 4 } else { 1 }
  dataSpecs = @("RACE", "SLOP", "WOOD")
  output = $OutputPath
}
if (-not $Confirm) {
  ([pscustomobject]@{ status = "review-only"; plan = $plan; note = "Add -Confirm to download and export this bounded window." }) | ConvertTo-Json -Depth 5
  exit 0
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

function Read-JvData {
  param([string]$DataSpec, [string]$FromTime, [int]$Option, [scriptblock]$OnRecord)
  [int]$readCount = 0
  [int]$downloadCount = 0
  [string]$lastFileTime = ""
  $openResult = [int]$jvLink.JVOpen($DataSpec, $FromTime, $Option, [ref]$readCount, [ref]$downloadCount, [ref]$lastFileTime)
  if ($openResult -ne 0) { throw "JVOpen($DataSpec) failed with result $openResult." }
  $script:opened = $true
  $counts = [ordered]@{}
  $completed = $false
  try {
    for ($iteration = 0; $iteration -lt 2000000; $iteration++) {
      [string]$buffer = " " * 110000
      [string]$fileName = ""
      $readResult = [int]$jvLink.JVRead([ref]$buffer, 110000, [ref]$fileName)
      if ($readResult -gt 0) {
        $bytes = $encoding.GetBytes($buffer)
        $recordId = Get-JvField $bytes 1 2
        if (-not $counts.Contains($recordId)) { $counts[$recordId] = 0 }
        $counts[$recordId] = [int]$counts[$recordId] + 1
        & $OnRecord $recordId $bytes
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
  if (-not $completed) { throw "JVRead($DataSpec) exceeded the safety record limit." }
  return [ordered]@{ dataSpec = $DataSpec; fromTime = $FromTime; option = $Option; expectedRecords = $readCount; expectedDownloads = $downloadCount; lastFileTime = $lastFileTime; records = $counts }
}

$results = New-Object 'System.Collections.Generic.List[object]'
$slope = New-Object 'System.Collections.Generic.List[object]'
$wood = New-Object 'System.Collections.Generic.List[object]'
$sources = @()
$raceStart = $start.ToString("yyyyMMdd")
$raceEnd = $end.ToString("yyyyMMdd")
$trainingStart = $start.AddDays(-45).ToString("yyyyMMdd")
$option = if ($Mode -eq "setup") { 4 } else { 1 }
$raceFromTime = if ($Mode -eq "setup") { "$($start.ToString('yyyyMMdd000000'))-$($end.ToString('yyyyMMdd000000'))" } else { $start.ToString('yyyyMMdd000000') }
$trainingFromTime = if ($Mode -eq "setup") { "$($start.AddDays(-45).ToString('yyyyMMdd000000'))-$($end.ToString('yyyyMMdd000000'))" } else { $start.AddDays(-45).ToString('yyyyMMdd000000') }
$courseLabels = @{ "0" = "A"; "1" = "B"; "2" = "C"; "3" = "D"; "4" = "E" }

try {
  $jvLink = New-Object -ComObject JVDTLab.JVLink
  $initResult = [int]$jvLink.JVInit("UNKNOWN")
  if ($initResult -ne 0) { throw "JVInit failed with result $initResult." }

  $sources += Read-JvData "RACE" $raceFromTime $option {
    param($recordId, $bytes)
    if ($recordId -ne "SE") { return }
    $raceDate = "$(Get-JvField $bytes 12 4)$(Get-JvField $bytes 16 4)"
    if ($raceDate -lt $raceStart -or $raceDate -ge $raceEnd) { return }
    $finish = Convert-PositiveInteger (Get-JvField $bytes 335 2)
    if ($null -eq $finish) { return }
    $results.Add([ordered]@{
      raceDate = $raceDate
      raceKey = "$(Get-JvField $bytes 12 4)$(Get-JvField $bytes 16 4)-$(Get-JvField $bytes 20 2)-$(Get-JvField $bytes 22 2)-$(Get-JvField $bytes 24 2)-$(Get-JvField $bytes 26 2)"
      bloodRegistrationNumber = Get-JvField $bytes 31 10
      horseName = Get-JvField $bytes 41 36
      trainerName = Get-JvField $bytes 91 8
      affiliationCode = Get-JvField $bytes 85 1
      finishPosition = $finish
    }) | Out-Null
  }

  $sources += Read-JvData "SLOP" $trainingFromTime $option {
    param($recordId, $bytes)
    if ($recordId -ne "HC") { return }
    $date = Get-JvField $bytes 13 8
    if ($date -lt $trainingStart -or $date -ge $raceEnd) { return }
    $slope.Add([ordered]@{
      bloodRegistrationNumber = Get-JvField $bytes 25 10
      centerCode = Get-JvField $bytes 12 1
      date = $date
      time = Get-JvField $bytes 21 4
      fourF = Convert-TenthSeconds (Get-JvField $bytes 35 4)
      threeF = Convert-TenthSeconds (Get-JvField $bytes 42 4)
      twoF = Convert-TenthSeconds (Get-JvField $bytes 49 4)
      oneF = Convert-TenthSeconds (Get-JvField $bytes 56 3)
      lap4 = Convert-TenthSeconds (Get-JvField $bytes 39 3)
      lap3 = Convert-TenthSeconds (Get-JvField $bytes 46 3)
      lap2 = Convert-TenthSeconds (Get-JvField $bytes 53 3)
      lap1 = Convert-TenthSeconds (Get-JvField $bytes 56 3)
    }) | Out-Null
  }

  $sources += Read-JvData "WOOD" $trainingFromTime $option {
    param($recordId, $bytes)
    if ($recordId -ne "WC") { return }
    $date = Get-JvField $bytes 13 8
    if ($date -lt $trainingStart -or $date -ge $raceEnd) { return }
    $times = [ordered]@{}
    $laps = [ordered]@{}
    foreach ($position in @(@(10,38,42),@(9,45,49),@(8,52,56),@(7,59,63),@(6,66,70),@(5,73,77),@(4,80,84),@(3,87,91),@(2,94,98),@(1,101,101))) {
      $furlong = [int]$position[0]
      $times["${furlong}F"] = Convert-TenthSeconds (Get-JvField $bytes ([int]$position[1]) $(if ($furlong -eq 1) { 3 } else { 4 }))
      $laps["lap$furlong"] = Convert-TenthSeconds (Get-JvField $bytes ([int]$position[2]) 3)
    }
    $courseCode = Get-JvField $bytes 35 1
    $wood.Add([ordered]@{
      bloodRegistrationNumber = Get-JvField $bytes 25 10
      centerCode = Get-JvField $bytes 12 1
      date = $date
      time = Get-JvField $bytes 21 4
      courseCode = $courseCode
      course = if ($courseLabels.ContainsKey($courseCode)) { $courseLabels[$courseCode] } else { $courseCode }
      directionCode = Get-JvField $bytes 36 1
      times = $times
      laps = $laps
    }) | Out-Null
  }

  $payload = [ordered]@{
    schemaVersion = 1
    mode = "stable-training-history"
    acquisitionMode = $Mode
    generatedAt = (Get-Date).ToString("s")
    startDate = $start.ToString("yyyy-MM-dd")
    endDateExclusive = $end.ToString("yyyy-MM-dd")
    results = $results.ToArray()
    slope = $slope.ToArray()
    wood = $wood.ToArray()
    sources = $sources
  }
  $directory = Split-Path -Parent $OutputPath
  New-Item -ItemType Directory -Path $directory -Force | Out-Null
  [System.IO.File]::WriteAllText($OutputPath, (($payload | ConvertTo-Json -Depth 8) + [Environment]::NewLine), (New-Object System.Text.UTF8Encoding($false)))
  ([pscustomobject]@{ status = "exported"; output = $OutputPath; resultCount = $results.Count; slopeCount = $slope.Count; woodCount = $wood.Count; sources = $sources }) | ConvertTo-Json -Depth 7
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
