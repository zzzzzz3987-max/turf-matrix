import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('isolated odds runner requires the full race summary before starting updates', () => {
  const script = readFileSync(new URL('../../jvfetch/invoke-auto-odds-runner.ps1', import.meta.url), 'utf8');
  const copy = 'Copy-InputFile "tools\\jvlink\\output\\week-race-summary.json"';
  assert.ok(script.includes(copy));
  assert.ok(!script.includes(`${copy} $false`), 'the race summary must not be optional');
  assert.ok(script.indexOf(copy) < script.indexOf('Invoke-Checked $Node $runnerArguments'));
});
