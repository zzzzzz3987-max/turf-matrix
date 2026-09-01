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
if (($end - $start).TotalDays -gt 31) { throw "One export is limited to 31 days." }

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
if (-not $OutputPath) {
  $OutputPath = Join-Path $PSScriptRoot "output\race-shape-history\$($start.ToString('yyyyMMdd'))-$($end.ToString('yyyyMMdd')).json"
} elseif (-not [System.IO.Path]::IsPathRooted($OutputPath)) {
  $OutputPath = Join-Path $repoRoot $OutputPath
}
$option = if ($Mode -eq "setup") { 4 } else { 1 }
$fromTime = if ($Mode -eq "setup") { "$($start.ToString('yyyyMMdd000000'))-$($end.ToString('yyyyMMdd000000'))" } else { $start.ToString("yyyyMMdd000000") }
$plan = [ordered]@{ dataSpec = "RACE"; startDate = $StartDate; endDateExclusive = $EndDate; option = $option; output = $OutputPath }
if (-not $Confirm) {
  ([pscustomobject]@{ status = "review-only"; plan = $plan; note = "Add -Confirm to download and export this bounded window." }) | ConvertTo-Json -Depth 4
  exit 0
}

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
  if (-not [int]::TryParse(([string]$Raw).Trim(), [ref]$value) -or $value -le 0) { return $null }
  return $value
}
function Get-RaceKey {
  param([byte[]]$Bytes)
  return "$(Get-JvField $Bytes 12 4)$(Get-JvField $Bytes 16 4)-$(Get-JvField $Bytes 20 2)-$(Get-JvField $Bytes 22 2)-$(Get-JvField $Bytes 24 2)-$(Get-JvField $Bytes 26 2)"
}

$raceStart = $start.ToString("yyyyMMdd")
$raceEnd = $end.ToString("yyyyMMdd")
$races = [ordered]@{}
$horses = New-Object 'System.Collections.Generic.List[object]'
$jvLink = $null
$opened = $false
try {
  $jvLink = New-Object -ComObject JVDTLab.JVLink
  $initResult = [int]$jvLink.JVInit("UNKNOWN")
  if ($initResult -ne 0) { throw "JVInit failed with result $initResult." }
  [int]$readCount = 0
  [int]$downloadCount = 0
  [string]$lastFileTime = ""
  $openResult = [int]$jvLink.JVOpen("RACE", $fromTime, $option, [ref]$readCount, [ref]$downloadCount, [ref]$lastFileTime)
  if ($openResult -ne 0) { throw "JVOpen(RACE) failed with result $openResult." }
  $opened = $true
  for ($iteration = 0; $iteration -lt 2000000; $iteration++) {
    [string]$buffer = " " * 110000
    [string]$fileName = ""
    $readResult = [int]$jvLink.JVRead([ref]$buffer, 110000, [ref]$fileName)
    if ($readResult -gt 0) {
      $bytes = $encoding.GetBytes($buffer)
      $recordId = Get-JvField $bytes 1 2
      $raceDate = "$(Get-JvField $bytes 12 4)$(Get-JvField $bytes 16 4)"
      if ($raceDate -lt $raceStart -or $raceDate -ge $raceEnd) { continue }
      $raceKey = Get-RaceKey $bytes
      if ($recordId -eq "RA") {
        $races[$raceKey] = [ordered]@{
          raceKey = $raceKey
          raceDate = $raceDate
          courseCode = Get-JvField $bytes 20 2
          raceNo = Convert-PositiveInteger (Get-JvField $bytes 26 2)
          fieldSize = Convert-PositiveInteger (Get-JvField $bytes 884 2)
        }
      } elseif ($recordId -eq "SE") {
        $finish = Convert-PositiveInteger (Get-JvField $bytes 335 2)
        if ($null -eq $finish) { continue }
        $horses.Add([ordered]@{
          raceKey = $raceKey
          horseNumber = Convert-PositiveInteger (Get-JvField $bytes 29 2)
          horseName = Get-JvField $bytes 41 36
          finishPosition = $finish
          passingOrder = @(
            Convert-PositiveInteger (Get-JvField $bytes 352 2)
            Convert-PositiveInteger (Get-JvField $bytes 354 2)
            Convert-PositiveInteger (Get-JvField $bytes 356 2)
            Convert-PositiveInteger (Get-JvField $bytes 358 2)
          )
          runningStyleCode = Get-JvField $bytes 553 1
          abnormalityCode = Get-JvField $bytes 332 1
        }) | Out-Null
      }
      continue
    }
    if ($readResult -eq -3) { Start-Sleep -Milliseconds 200; continue }
    if ($readResult -eq -1) { continue }
    if ($readResult -eq 0) { break }
    throw "JVRead(RACE) failed with result $readResult."
  }
} finally {
  if ($opened) { $jvLink.JVClose() | Out-Null }
  if ($null -ne $jvLink) { [System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($jvLink) | Out-Null }
}

$payload = [ordered]@{
  schemaVersion = 1
  generatedAt = (Get-Date).ToString("s")
  source = "JV-Link RACE RA/SE"
  acquisitionMode = $Mode
  startDate = $StartDate
  endDateExclusive = $EndDate
  popularityOddsValueStored = $false
  races = @($races.Values)
  horses = $horses.ToArray()
}
New-Item -ItemType Directory -Path (Split-Path -Parent $OutputPath) -Force | Out-Null
[System.IO.File]::WriteAllText($OutputPath, (($payload | ConvertTo-Json -Depth 7) + [Environment]::NewLine), (New-Object System.Text.UTF8Encoding($false)))
([pscustomobject]@{ status = "exported"; output = $OutputPath; raceCount = $races.Count; horseCount = $horses.Count }) | ConvertTo-Json -Depth 3
