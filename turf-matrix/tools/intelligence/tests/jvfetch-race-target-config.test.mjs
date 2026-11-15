import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const windows = process.env.WINDIR ?? 'C:/Windows';
const powershell = join(windows, 'SysWOW64/WindowsPowerShell/v1.0/powershell.exe');
const compiler = join(windows, 'Microsoft.NET/Framework/v4.0.30319/MSBuild.exe');
test('JV fetch config reads only the bundles array, not withdrawal metadata', {
  skip: process.platform !== 'win32' || !existsSync(powershell) || !existsSync(compiler),
  timeout: 60000,
}, () => {
  const output = execFileSync(powershell, ['-NoProfile', '-ExecutionPolicy', 'Bypass',
    '-File', 'tools/jvfetch/tests/race-target-config.ps1'], { encoding: 'utf8', timeout: 55000 });
  assert.match(output, /Race target config cases passed: 6/);
});
