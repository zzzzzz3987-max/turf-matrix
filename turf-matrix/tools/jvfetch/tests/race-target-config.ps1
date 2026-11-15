$ErrorActionPreference = 'Stop'
$project = Join-Path $PSScriptRoot '..\TurfMatrix.JvFetch.csproj'
$name = 'jvfetch-config-test-' + [guid]::NewGuid().ToString('N')
$msbuild = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\MSBuild.exe'
& $msbuild $project /p:Configuration=Release /p:Platform=x86 /p:OutputPath=bin\Runtime\ /p:AssemblyName=$name /v:quiet
if ($LASTEXITCODE -ne 0) { throw 'Config test compilation failed' }
$exe = Join-Path $PSScriptRoot "..\bin\Runtime\$name.exe"
$assembly = [Reflection.Assembly]::LoadFrom((Resolve-Path $exe).Path)
$method = $assembly.GetType('TurfMatrix.JvFetch.Program').GetMethod('LoadRaceTargets', [Reflection.BindingFlags]'NonPublic,Static')
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
$directory = Join-Path $tempRoot ('tm-race-config-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $directory | Out-Null
$path = Join-Path $directory 'config.json'
$utf8 = New-Object Text.UTF8Encoding($false)
function Check-Config($Config, $ExpectedCount, $ShouldFail = $false) {
    [IO.File]::WriteAllText($path, ($Config | ConvertTo-Json -Depth 10), $utf8)
    $failed = $false
    $failure = ''
    try { $result = $method.Invoke($null, [string[]]@([string]$path)) } catch { $failed = $true; $failure = $_.Exception.ToString() }
    if ($failed -ne $ShouldFail) { throw "Unexpected config acceptance (shouldFail=$ShouldFail): $failure" }
    if (-not $ShouldFail -and $result.Count -ne $ExpectedCount) { throw "Expected $ExpectedCount races, got $($result.Count)" }
}
try {
    $bundle = '2026-11-15-kyoto-10R'
    Check-Config @{raceDate='2026-11-15'; expectedRaceCount=1; bundles=@($bundle); excludedHorseNumbersByBundle=@{$bundle=@(6)}} 1
    Check-Config @{raceDate='2026-11-15'; bundles=@($bundle,$bundle)} 0 $true
    Check-Config @{raceDate='2026-11-15'; bundles=@('2026-11-14-kyoto-10R')} 0 $true
    Check-Config @{raceDate='2026-11-15'; bundles=@('2026-11-15-kyoto-13R')} 0 $true
    Check-Config @{raceDate='2026-11-15'; bundles=@($bundle); expectedRaceCount=2} 0 $true
    Check-Config @{raceDate='2026-11-15'; bundles=@()} 0 $true
    Write-Output 'Race target config cases passed: 6; no JV-Link calls performed.'
} finally {
    $resolved = [IO.Path]::GetFullPath($directory)
    if ([IO.Path]::GetDirectoryName($resolved) -ne $tempRoot -or -not [IO.Path]::GetFileName($resolved).StartsWith('tm-race-config-')) { throw 'Unexpected temporary path' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
