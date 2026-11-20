import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const cli = readFileSync(new URL('../../jvlink/jvlink-cli.ps1', import.meta.url), 'utf8');
const load = cli.split(/\r?\n/).find(line => /^\s*\$config = Get-Content/u.test(line));
test('JV CLI reads its JSON config explicitly as UTF-8', () => {
  assert.match(load, /-Encoding UTF8/u);
});

const powershell = join(process.env.WINDIR ?? 'C:/Windows', 'SysWOW64/WindowsPowerShell/v1.0/powershell.exe');
test('the production config read handles Japanese withdrawal metadata in Windows PowerShell', {
  skip: process.platform !== 'win32' || !existsSync(powershell),
}, () => {
  const directory = mkdtempSync(join(tmpdir(), 'tm-jvlink-encoding-'));
  try {
    const configPath = join(directory, 'config.json');
    const name = 'アートレスマインド';
    writeFileSync(configPath, JSON.stringify({ raceDate: '2026-11-15', officialWithdrawals: [{ horseName: name }] }));
    const name64 = Buffer.from(name).toString('base64');
    const script = `$ErrorActionPreference='Stop'; $configPath=$env:TM_ENCODING_FIXTURE; ${load}; `
      + `$expected=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${name64}')); `
      + `if ($config.officialWithdrawals[0].horseName -ne $expected) { throw 'Japanese name changed' }; 'ok'`;
    const result = execFileSync(powershell, ['-NoProfile', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
      encoding: 'utf8', env: { ...process.env, TM_ENCODING_FIXTURE: configPath }, timeout: 15000,
    });
    assert.equal(result.trim(), 'ok');
  } finally {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(directory.startsWith(join(tmpdir(), 'tm-jvlink-encoding-')));
    rmSync(directory, { recursive: true, force: true });
  }
});
