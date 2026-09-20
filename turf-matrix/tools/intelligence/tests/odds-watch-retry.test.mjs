import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

const source = readFileSync(new URL('../../auto-odds-update.mjs', import.meta.url), 'utf8');
const start = source.indexOf('    do {', source.indexOf('const main = async'));
const end = source.indexOf('    } while (true);', start) + '    } while (true);'.length;
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const loop = new AsyncFunction('runOnce', 'watch', 'dryRun', 'recordAlert', 'log', 'sleep', 'pollSeconds', source.slice(start, end));

test('watch retries after an error and stops after a completed schedule', async () => {
  let calls = 0;
  const alerts = [];
  const delays = [];
  await loop(() => {
    if (++calls === 1) throw new Error('service unavailable');
    return { done: true };
  }, true, false, (...args) => alerts.push(args), () => {}, async ms => delays.push(ms), 60);
  assert.equal(calls, 2);
  assert.equal(alerts[0][0], 'service unavailable');
  assert.deepEqual(delays, [60000]);
});

test('one-shot and dry-run failures do not retry', async () => {
  for (const [watch, dryRun] of [[false, false], [true, true]]) {
    let calls = 0;
    await assert.rejects(loop(() => { calls++; throw new Error('failed'); }, watch, dryRun,
      () => assert.fail('unexpected notification'), () => {}, async () => assert.fail('unexpected sleep'), 60), /failed/);
    assert.equal(calls, 1);
  }
});
