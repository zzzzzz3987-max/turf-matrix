import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const verify = ({ excluded = [], missing = 5, candidateRemoved = false, runtimeExcluded = null, expectedNumbers, noDetailedRace = false }) => {
  const root = mkdtempSync(join(tmpdir(), 'tm-confirmed-withdrawal-'));
  try {
    mkdirSync(join(root, 'tools'));
    for (const name of ['verify-jvfetch-odds.mjs', 'odds-field-size.mjs']) {
      copyFileSync(new URL(`../../${name}`, import.meta.url), join(root, 'tools', name));
    }
    const bundleId = '2026-11-21-fukushima-11R';
    const numbers = Array.from({ length: 16 }, (_, i) => i + 1);
    writeFileSync(join(root, 'tools/race-batch-config.json'), JSON.stringify({ bundles: [bundleId],
      excludedHorseNumbersByBundle: { [bundleId]: excluded } }));
    const runtimePath = join(root, 'tools/full-race-runtime.json');
    if (runtimeExcluded !== null) writeFileSync(runtimePath, JSON.stringify({ bundles: [bundleId],
      excludedHorseNumbersByBundle: { [bundleId]: runtimeExcluded },
      ...(expectedNumbers ? { expectedHorseNumbersByBundle: { [bundleId]: expectedNumbers } } : {}) }));
    writeFileSync(join(root, 'tools/week-data.batch-candidate.json'), JSON.stringify({ meta: { date: '2026-11-21' },
      races: noDetailedRace ? [] : [{ bundleId, track: '福島', number: 11, time: '15:20',
        horses: numbers.filter(n => !candidateRemoved || n !== 5).map(number => ({ number })) }] }));
    writeFileSync(join(root, 'odds.csv'), ['場所,R,馬番,馬名,単勝オッズ,人気,取得時刻,更新元,状態',
      ...numbers.filter(n => n !== missing).map(n => `福島,11,${n},Horse${n},10,${n},2026-11-21T14:00,fixture,active`)].join('\n'));
    return spawnSync(process.execPath, [join(root, 'tools/verify-jvfetch-odds.mjs'), join(root, 'odds.csv')], {
      encoding: 'utf8', env: { ...process.env, TURF_MATRIX_RACE_CONFIG: runtimeExcluded !== null ? runtimePath : '' },
    });
  } finally {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(root.startsWith(join(tmpdir(), 'tm-confirmed-withdrawal-')));
    rmSync(root, { recursive: true, force: true });
  }
};

test('confirmed withdrawal permits the exact remaining active field', () => {
  const result = verify({ excluded: [5] });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
test('unconfirmed active runner shortage still fails', () => {
  assert.equal(verify({}).status, 2);
});
test('withdrawn runner cannot replace a different missing runner', () => {
  assert.equal(verify({ excluded: [5], missing: 6 }).status, 2);
});
test('already filtered candidate does not subtract the withdrawal twice', () => {
  const result = verify({ excluded: [5], candidateRemoved: true });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('capture verifier uses the supplied full-race withdrawal config', () => {
  const result = verify({ excluded: [], runtimeExcluded: [5] });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('an override without confirmed withdrawals cannot borrow the default config exclusions', () => {
  assert.equal(verify({ excluded: [5], runtimeExcluded: [] }).status, 2);
});

test('effective official field validates ordinary races absent from the detailed payload', () => {
  const expectedNumbers = Array.from({ length: 16 }, (_, i) => i + 1).filter(n => n !== 5);
  assert.equal(verify({ runtimeExcluded: [5], expectedNumbers, noDetailedRace: true }).status, 0);
  assert.equal(verify({ runtimeExcluded: [5], expectedNumbers, noDetailedRace: true, missing: 6 }).status, 2);
});

test('invalid effective fields cannot weaken the exact-slot check', () => {
  for (const expectedNumbers of [[1, 1], [0], [19], [5], [1.5]]) {
    assert.notEqual(verify({ runtimeExcluded: [5], expectedNumbers, noDetailedRace: true }).status, 0);
  }
});
