param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$JvFetchArgs
)

$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$Project = Join-Path $PSScriptRoot "TurfMatrix.JvFetch.csproj"
$MsBuild = Join-Path $env:WINDIR "Microsoft.NET\Framework\v4.0.30319\MSBuild.exe"

if (-not (Test-Path -LiteralPath $MsBuild)) {
  Write-Error "MSBuild was not found: $MsBuild"
  exit 2
}

$AssemblyName = "jvfetch-run-{0}" -f (Get-Date -Format "yyyyMMddHHmmss")
$OutputPath = "bin\Runtime\"

& $MsBuild $Project /p:Configuration=Release /p:Platform=x86 /p:OutputPath=$OutputPath /p:AssemblyName=$AssemblyName /v:minimal
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

$Exe = Join-Path $PSScriptRoot ("bin\Runtime\{0}.exe" -f $AssemblyName)
if (-not (Test-Path -LiteralPath $Exe)) {
  Write-Error "jvfetch executable was not generated: $Exe"
  exit 2
}

Push-Location $RepoRoot
try {
  & $Exe @JvFetchArgs
  exit $LASTEXITCODE
}
finally {
  Pop-Location
}
