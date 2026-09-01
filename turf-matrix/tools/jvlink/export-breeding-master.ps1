param(
  [string]$OutputPath = "",
  [int]$MaxIterations = 500000,
  [int]$DownloadTimeoutSeconds = 900
)

$ErrorActionPreference = "Stop"

if ([Environment]::Is64BitOperatingSystem -and [Environment]::Is64BitProcess) {
  $PowerShell32 = Join-Path $env:WINDIR "SysWOW64\WindowsPowerShell\v1.0\powershell.exe"
  if (-not (Test-Path -LiteralPath $PowerShell32)) {
    Write-Error "32-bit PowerShell was not found. JV-Link requires a 32-bit process."
    exit 2
  }
  $childArgs = @(
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $PSCommandPath,
    "-MaxIterations", $MaxIterations,
    "-DownloadTimeoutSeconds", $DownloadTimeoutSeconds
  )
  if ($OutputPath) { $childArgs += @("-OutputPath", $OutputPath) }
  & $PowerShell32 @childArgs
  exit $LASTEXITCODE
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
if (-not $OutputPath) {
  $OutputPath = Join-Path $PSScriptRoot "output\breeding-master.json"
} elseif (-not [System.IO.Path]::IsPathRooted($OutputPath)) {
  $OutputPath = Join-Path $repoRoot $OutputPath
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

try {
  $jvLink = New-Object -ComObject JVDTLab.JVLink
  $initResult = [int]$jvLink.JVInit("UNKNOWN")
  if ($initResult -ne 0) { throw "JVInit failed with result $initResult." }

  [int]$readCount = 0
  [int]$downloadCount = 0
  [string]$lastFileTime = ""
  $openResult = [int]$jvLink.JVOpen(
    "BLDN",
    "19860101000000",
    4,
    [ref]$readCount,
    [ref]$downloadCount,
    [ref]$lastFileTime
  )
  if ($openResult -ne 0) { throw "JVOpen(BLDN) failed with result $openResult." }
  $opened = $true

  if ($downloadCount -gt 0) {
    $downloadDeadline = [DateTime]::UtcNow.AddSeconds($DownloadTimeoutSeconds)
    do {
      $downloaded = [int]$jvLink.JVStatus()
      if ($downloaded -lt 0) { throw "JVStatus(BLDN) failed with result $downloaded." }
      if ($downloaded -ge $downloadCount) { break }
      if ([DateTime]::UtcNow -ge $downloadDeadline) {
        throw "JVOpen(BLDN) download timed out after $DownloadTimeoutSeconds seconds ($downloaded/$downloadCount files)."
      }
      Start-Sleep -Milliseconds 250
    } while ($true)
  }

  $records = @{}
  $completed = $false
  $processedHn = 0
  $skippedFiles = New-Object 'System.Collections.Generic.HashSet[string]'
  for ($iteration = 0; $iteration -lt $MaxIterations; $iteration++) {
    [string]$buffer = " " * 1024
    [string]$fileName = ""
    $readResult = [int]$jvLink.JVRead([ref]$buffer, 1024, [ref]$fileName)
    if ($readResult -gt 0) {
      $physicalName = [System.IO.Path]::GetFileName($fileName)
      if ($physicalName -and -not $physicalName.StartsWith("HN", [StringComparison]::OrdinalIgnoreCase)) {
        $skippedFiles.Add($physicalName) | Out-Null
        $jvLink.JVSkip()
        continue
      }

      $bytes = $encoding.GetBytes($buffer)
      if ((Get-JvField $bytes 1 2) -ne "HN") {
        if ($physicalName) {
          $skippedFiles.Add($physicalName) | Out-Null
          $jvLink.JVSkip()
        }
        continue
      }

      $processedHn += 1
      $breedingId = Get-JvField $bytes 12 10
      if (-not $breedingId) { continue }
      $dataCreatedAt = Get-JvField $bytes 4 8
      $existing = $records[$breedingId]
      if ($null -ne $existing -and [string]$existing.dataCreatedAt -gt $dataCreatedAt) { continue }
      if ((Get-JvField $bytes 3 1) -eq "0") {
        $records.Remove($breedingId)
        continue
      }
      $records[$breedingId] = [ordered]@{
        breedingRegistrationNumber = $breedingId
        bloodRegistrationNumber = Get-JvField $bytes 30 10
        name = Get-JvField $bytes 41 36
        nameLatin = Get-JvField $bytes 117 80
        birthYear = Get-JvField $bytes 197 4
        sexCode = Get-JvField $bytes 201 1
        sireBreedingRegistrationNumber = Get-JvField $bytes 230 10
        damBreedingRegistrationNumber = Get-JvField $bytes 240 10
        dataCreatedAt = $dataCreatedAt
      }
      continue
    }
    if ($readResult -eq -3) { Start-Sleep -Milliseconds 200; continue }
    if ($readResult -eq -1) { continue }
    if ($readResult -eq 0) { $completed = $true; break }
    throw "JVRead(BLDN) failed with result $readResult."
  }
  if (-not $completed) { throw "JVRead(BLDN) did not complete within MaxIterations=$MaxIterations." }

  $parent = Split-Path -Parent $OutputPath
  New-Item -ItemType Directory -Path $parent -Force | Out-Null
  $payload = [ordered]@{
    schemaVersion = 1
    source = "JV-Link BLDN/HN setup"
    generatedAt = [DateTime]::UtcNow.ToString("o")
    expectedRecords = $readCount
    expectedDownloads = $downloadCount
    processedHnRecords = $processedHn
    skippedNonHnFiles = $skippedFiles.Count
    recordCount = $records.Count
    records = @($records.Values)
  }
  [System.IO.File]::WriteAllText(
    $OutputPath,
    (($payload | ConvertTo-Json -Depth 5 -Compress) + "`n"),
    [System.Text.UTF8Encoding]::new($false)
  )
  [pscustomobject][ordered]@{
    source = $payload.source
    generatedAt = $payload.generatedAt
    expectedRecords = $payload.expectedRecords
    expectedDownloads = $payload.expectedDownloads
    processedHnRecords = $payload.processedHnRecords
    skippedNonHnFiles = $payload.skippedNonHnFiles
    recordCount = $payload.recordCount
  } | ConvertTo-Json
} catch {
  Write-Error $_
  exit 1
} finally {
  if ($opened -and $null -ne $jvLink) { $jvLink.JVClose() | Out-Null }
  if ($null -ne $jvLink) { [System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($jvLink) | Out-Null }
}
