$ErrorActionPreference='Stop'
$name='jvfetch-withdrawal-test-'+[guid]::NewGuid().ToString('N')
$msbuild=Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\MSBuild.exe'
& $msbuild (Join-Path $PSScriptRoot '..\TurfMatrix.JvFetch.csproj') /p:Configuration=Release /p:Platform=x86 /p:OutputPath=bin\Runtime\ /p:AssemblyName=$name "/p:IntermediateOutputPath=obj\$name\" /v:quiet
if ($LASTEXITCODE -ne 0) { throw 'Withdrawal test compilation failed' }
$assembly=[Reflection.Assembly]::LoadFrom((Resolve-Path (Join-Path $PSScriptRoot "..\bin\Runtime\$name.exe")).Path)
$type=$assembly.GetType('TurfMatrix.JvFetch.Program')
$parse=$type.GetMethod('ParseWithdrawalRecord',[Reflection.BindingFlags]'NonPublic,Static')
$read=$type.GetMethod('ReadWithdrawalRecords',[Reflection.BindingFlags]'NonPublic,Static')
$sjis=[Text.Encoding]::GetEncoding(932)
$latin=[Text.Encoding]::GetEncoding(1252)
$horseName=[string]::Concat([char]0x30cd,[char]0x30fc,[char]0x30ed,[char]0x30ce,[char]0x30ef,[char]0x30fc,[char]0x30eb)
function New-Record([hashtable]$Overrides=@{}) {
  $b=New-Object byte[] 78
  for($i=0;$i -lt $b.Length;$i++) { $b[$i]=32 }
  $fields=@{1='AV';3='1';4='20261128';12='2026';16='1128';20='08';22='05';24='07';26='11';28='11280655';36='09';38=$horseName;74='001';77="`r`n"}
  foreach($key in $Overrides.Keys) { $fields[$key]=$Overrides[$key] }
  foreach($key in $fields.Keys) { $v=$sjis.GetBytes([string]$fields[$key]); [Array]::Copy($v,0,$b,([int]$key-1),$v.Length) }
  return ,$b
}
function Parse-Record([byte[]]$Bytes,[bool]$ShouldFail=$false) {
  $args=New-Object object[] 2
  $args[0]=$Bytes; $args[1]='2026-11-28'
  $failed=$false
  try { $result=$parse.Invoke($null,$args) } catch { $failed=$true }
  if($failed -ne $ShouldFail) { throw "Unexpected AV acceptance: $ShouldFail" }
  if(-not $failed) { return $result }
}
$record=Parse-Record (New-Record)
if($record.HorseName -ne $horseName -or $record.HorseNumber -ne 9 -or $record.RaceKey -ne '20261128-08-05-07-11') { throw 'AV byte offsets or Shift-JIS decoding failed' }
if((Parse-Record (New-Record @{3='2'})).DataKubun -ne '2') { throw 'Race exclusion was not parsed' }
foreach($change in @(@{3='0'},@{16='1127'},@{20='99'},@{22='00'},@{24='00'},@{26='13'},@{36='19'},@{28='11289999'},@{38='?'})) { Parse-Record (New-Record $change) $true }
Parse-Record ([byte[]](New-Record)[0..40]) $true
Add-Type -TypeDefinition @'
public class FakeWithdrawalLink {
    private readonly string[] records;
    private readonly int[] codes;
    private int index;
    public FakeWithdrawalLink(string[] records, int[] codes) { this.records=records; this.codes=codes; }
    public int JVRead(ref string buffer, int size, ref string filename) {
        if (index >= codes.Length) return 0;
        buffer=records[index];
        return codes[index++];
    }
}
'@
foreach($text in @($latin.GetString((New-Record)),$sjis.GetString((New-Record)))) {
  $fake=New-Object FakeWithdrawalLink -ArgumentList @([string[]]@($text,''),[int[]]@(78,0))
  $args=New-Object object[] 2; $args[0]=$fake.PSObject.BaseObject; $args[1]='2026-11-28'
  $records=$read.Invoke($null,$args)
  if($records.Count -ne 1 -or $records[0].HorseName -ne $horseName) { throw 'JVRead string encoding failed' }
}
$fake=New-Object FakeWithdrawalLink -ArgumentList @([string[]]@(''),[int[]]@(0))
$args[0]=$fake.PSObject.BaseObject
if($read.Invoke($null,$args).Count -ne 0) { throw 'Complete empty snapshot failed' }
$fake=New-Object FakeWithdrawalLink -ArgumentList @([string[]]@(''),[int[]]@(-2))
$args[0]=$fake.PSObject.BaseObject
$failed=$false
try { $read.Invoke($null,$args) | Out-Null } catch { $failed=$true }
if(-not $failed) { throw 'Partial snapshot did not fail closed' }
Write-Output 'Withdrawal record cases passed: 16; no JV-Link calls performed.'
