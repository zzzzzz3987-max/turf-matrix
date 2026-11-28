import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const windows = process.env.WINDIR ?? 'C:/Windows';
const powershell = join(windows, 'SysWOW64/WindowsPowerShell/v1.0/powershell.exe');
test('AV bytes, cancellation/exclusion codes, EOF and both JVRead text encodings', {
  skip: process.platform !== 'win32' || !existsSync(powershell), timeout: 60000,
}, () => {
  const output = execFileSync(powershell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    'tools/jvfetch/tests/withdrawal-records.ps1'], { encoding: 'utf8', timeout: 55000 });
  assert.match(output, /Withdrawal record cases passed: 16/);
});
