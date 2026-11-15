import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../../jvlink/extract-race-conditions.mjs', import.meta.url));
const fixture = (configuredDate, check) => {
  const root = mkdtempSync(join(tmpdir(), 'tm-conditions-runtime-'));
  const put = (path, data) => {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, JSON.stringify(data));
  };
  try {
    const one = '2026-11-15-kyoto-09R', two = '2026-11-15-kyoto-10R';
    const config = { raceDate: '2026-11-15', bundles: [one, two] };
    put('tools/race-batch-config.json', { ...config, bundles: [one] });
    put('full-config.json', config);
    put('tools/week-data.json', { races: [{ bundleId: one, number: 9, surface: '芝' }] });
    put('tools/jvlink/output/week-race-summary.json', { configuredRaceDate: configuredDate, races: [
      { raceDate: '2026-11-14', raceNo: 10, courseCode: '08', trackCode: '23' },
      { raceDate: '2026-11-15', raceNo: 9, courseCode: '08', trackCode: '11' },
      { raceDate: '2026-11-15', raceNo: 10, courseCode: '08', trackCode: '23' },
    ] });
    put('data/target/race-conditions.latest.json', { RaceDate: '2026-11-15', Courses: {
      '08': { WeatherCode: '4', TurfGoingCode: '2', DirtGoingCode: '3', UpdatedAt: '2026-11-15T02:00:00Z' },
    } });
    const script = join(root, 'tools/jvlink/extract-race-conditions.mjs');
    copyFileSync(source, script);
    const result = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8',
      env: { ...process.env, TURF_MATRIX_RACE_CONFIG: join(root, 'full-config.json') } });
    check(result, root, one, two);
  } finally {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(root.startsWith(join(tmpdir(), 'tm-conditions-runtime-')));
    rmSync(root, { recursive: true, force: true });
  }
};

test('explicit full-field conditions include non-special races from the target day of a mixed-weekend summary', () => {
  fixture('2026-11-15', (result, root, one, two) => {
    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(readFileSync(join(root, 'tools/race-conditions.current.json'), 'utf8'));
    assert.deepEqual(Object.keys(payload.conditions), [one, two]);
    assert.equal(payload.conditions[one].goingCode, '2');
    assert.equal(payload.conditions[two].goingCode, '3');
    assert.ok(Object.values(payload.conditions).every(c => c.status === 'active' && c.source === 'JV-Link 0B14 WE'));
  });
});

test('a stale configured summary does not masquerade as full-day current conditions', () => {
  fixture('2026-11-14', result => {
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /mapping incomplete/);
  });
});
