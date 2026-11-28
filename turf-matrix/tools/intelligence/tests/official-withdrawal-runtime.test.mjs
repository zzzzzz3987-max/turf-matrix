import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWithdrawalRuntime, withdrawalRuntimeFromFiles } from '../../jvfetch/withdrawal-runtime.mjs';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parse } from '../../parsers/current-race-detail-parser.mjs';

const now = Date.parse('2026-11-28T13:00:00+09:00');
const bundle = '2026-11-28-kyoto-11R';
const key = '20261128-08-05-07-11';
const fixture = () => ({
  now, config: { raceDate: '2026-11-28', expectedRaceCount: 1, bundles: [bundle] },
  fields: [{ bundleId: bundle, courseCode: '08', raceNo: 11, raceKey: key,
    entries: Array.from({ length: 11 }, (_, i) => ({ number: i + 1, name: `Horse${i + 1}` })) }],
  snapshot: { SchemaVersion: 1, Source: 'JV-Link 0B14 AV', RaceDate: '2026-11-28', Complete: true,
    GeneratedAt: new Date(now - 1000).toISOString(), Withdrawals: [{ RaceDate: '2026-11-28', RaceKey: key,
      CourseCode: '08', RaceNo: 11, HorseNumber: 9, HorseName: 'Horse9', DataKubun: '1',
      AnnouncedAt: '2026-11-28T09:00:00+09:00' }] },
});

test('official cancellation keeps original slots and produces exact active fields without mutating inputs', () => {
  const input = fixture();
  const before = structuredClone(input);
  const result = buildWithdrawalRuntime(input);
  assert.deepEqual(result.excludedHorseNumbersByBundle, { [bundle]: [9] });
  assert.deepEqual(result.expectedHorseNumbersByBundle[bundle], [1, 2, 3, 4, 5, 6, 7, 8, 10, 11]);
  assert.equal(result.officialWithdrawals[0].source, 'JV-Link 0B14 AV');
  assert.deepEqual(input, before);
});

test('official exclusions and multiple non-starters are treated like confirmed cancellations', () => {
  const input = fixture();
  input.snapshot.Withdrawals[0].DataKubun = '2';
  input.snapshot.Withdrawals.push({ ...input.snapshot.Withdrawals[0], HorseNumber: 11, HorseName: 'Horse11' });
  assert.deepEqual(buildWithdrawalRuntime(input).excludedHorseNumbersByBundle[bundle], [9, 11]);
});

test('a fresh empty snapshot revokes yesterday-style accumulated exclusions', () => {
  const input = fixture();
  input.config.excludedHorseNumbersByBundle = { [bundle]: [9] };
  input.config.officialWithdrawals = [{ horseNumber: 9 }];
  input.snapshot.Withdrawals = [];
  const result = buildWithdrawalRuntime(input);
  assert.deepEqual(result.excludedHorseNumbersByBundle, {});
  assert.equal(result.expectedHorseNumbersByBundle[bundle].length, 11);
  assert.deepEqual(result.officialWithdrawals, []);
});

test('unknown missing runner is not guessed to be withdrawn', () => {
  const input = fixture();
  input.fields[0].entries = input.fields[0].entries.filter(h => h.number !== 5);
  assert.throws(() => buildWithdrawalRuntime(input), /unconfirmed missing/);
});

test('a hand-filtered confirmed slot can be bound to its preserved official identity', () => {
  const input = fixture();
  input.fields[0].entries = input.fields[0].entries.filter(h => h.number !== 9);
  assert.throws(() => buildWithdrawalRuntime(input), /unknown slot/);
  input.config.officialWithdrawals = [{ raceKey: key, horseNumber: 9, horseName: 'Horse9', raceDate: '2026-11-28' }];
  assert.equal(buildWithdrawalRuntime(input).expectedHorseNumbersByBundle[bundle].length, 10);
  input.snapshot.Withdrawals = [];
  assert.throws(() => buildWithdrawalRuntime(input), /unconfirmed missing/);
});

test('stale, incomplete, future or wrong-source snapshots fail closed', () => {
  for (const update of [{ Complete: false }, { Source: 'fixture' }, { SchemaVersion: 2 },
    { RaceDate: '2026-11-27' }, { GeneratedAt: new Date(now - 601000).toISOString() },
    { GeneratedAt: new Date(now + 61000).toISOString() }, { Withdrawals: null }]) {
    const input = fixture();
    Object.assign(input.snapshot, update);
    assert.throws(() => buildWithdrawalRuntime(input), /snapshot/);
  }
});

test('wrong horse, number, meeting, date, status or announcement cannot authorize removal', () => {
  for (const update of [{ HorseName: 'Other' }, { HorseNumber: 18 }, { HorseNumber: 9.5 },
    { RaceKey: '20261128-08-04-07-11' }, { RaceDate: '2026-11-27' }, { DataKubun: '0' },
    { AnnouncedAt: '2026-11-28T15:00:00+09:00' }, { HorseName: '?' }]) {
    const input = fixture();
    Object.assign(input.snapshot.Withdrawals[0], update);
    assert.throws(() => buildWithdrawalRuntime(input));
  }
});

test('duplicate AV identities and duplicated source slots fail closed', () => {
  const input = fixture();
  input.snapshot.Withdrawals.push({ ...input.snapshot.Withdrawals[0] });
  assert.throws(() => buildWithdrawalRuntime(input), /duplicate AV/);
  input.snapshot.Withdrawals.pop();
  input.fields[0].entries.push({ ...input.fields[0].entries[0] });
  assert.throws(() => buildWithdrawalRuntime(input), /duplicate card/);
});

test('a full-day AV snapshot can be used for a selected subset without narrowing that subset', () => {
  const input = fixture();
  input.snapshot.Withdrawals.push({ ...input.snapshot.Withdrawals[0], RaceKey: '20261128-05-05-07-09', CourseCode: '05', RaceNo: 9 });
  const result = buildWithdrawalRuntime(input);
  assert.deepEqual(result.bundles, [bundle]);
  assert.equal(result.officialWithdrawals.length, 1);
});

test('malformed identities outside the selected subset cannot pass as a complete snapshot', () => {
  const input = fixture();
  input.snapshot.Withdrawals.push({ ...input.snapshot.Withdrawals[0], RaceKey: '20261128-99-05-07-09', CourseCode: '99', RaceNo: 9 });
  assert.throws(() => buildWithdrawalRuntime(input), /invalid AV/);
});

const withFiles = run => {
  const root = mkdtempSync(join(tmpdir(), 'tm-official-withdrawals-'));
  const input = fixture();
  const cardPath = join(root, 'tools/csv/input/races', bundle, 'current-race-detail.csv');
  const snapshotPath = join(root, 'data/target/race-withdrawals.latest.json');
  const summaryPath = join(root, 'tools/jvlink/output/week-race-summary.json');
  const rows = input.fields[0].entries.map(({ number, name }) => {
    const cells = Array(34).fill('');
    for (const [index, value] of [[0, '261128'], [1, '\u4eac\u90fd'], [2, '11'], [3, number],
      [4, 'TEST'], [5, '\u829d'], [6, '2000'], [7, name], [8, '\u7261'], [9, '2'],
      [10, 'JOCKEY'], [11, '56'], [12, 'TRAINER'], [13, '\u6817\u6771'], [32, `RACE${number}`]]) cells[index] = String(value);
    return cells.map(value => `"${value}"`).join(',');
  });
  const summary = { races: [{ raceDate: input.config.raceDate, courseCode: '08', raceNo: 11, raceKey: key }] };
  for (const path of [cardPath, snapshotPath, summaryPath]) mkdirSync(dirname(path), { recursive: true });
  writeFileSync(cardPath, rows.join('\n'));
  writeFileSync(snapshotPath, JSON.stringify(input.snapshot));
  writeFileSync(summaryPath, JSON.stringify(summary));
  try { run({ root, input, cardPath, snapshotPath, summaryPath, rows, summary }); }
  finally {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(root.startsWith(join(tmpdir(), 'tm-official-withdrawals-')));
    rmSync(root, { recursive: true, force: true });
  }
};

test('file flow filters confirmed non-starters and restores revoked ones without changing source cards', () => withFiles(({ root, input, cardPath, snapshotPath, summaryPath }) => {
  const originals = [cardPath, summaryPath].map(path => readFileSync(path));
  const runtime = withdrawalRuntimeFromFiles({ root, config: input.config, now });
  const filtered = parse({ path: cardPath, excludedHorseNumbers: runtime.excludedHorseNumbersByBundle[bundle] });
  assert.equal(filtered.rowCount, 11);
  assert.deepEqual(filtered.entries.map(h => h.horseNumber), runtime.expectedHorseNumbersByBundle[bundle]);
  assert.equal(runtime.withdrawalSnapshot.sha256.length, 64);
  input.snapshot.Withdrawals = [];
  writeFileSync(snapshotPath, JSON.stringify(input.snapshot));
  const restored = withdrawalRuntimeFromFiles({ root, config: runtime, now });
  assert.equal(parse({ path: cardPath, excludedHorseNumbers: restored.excludedHorseNumbersByBundle[bundle] }).entryCount, 11);
  [cardPath, summaryPath].forEach((path, i) => assert.deepEqual(readFileSync(path), originals[i]));
}));

test('file flow rejects stale cards, different venues, ambiguous meetings and unknown gaps', () => withFiles(({ root, input, cardPath, summaryPath, rows, summary }) => {
  for (const [oldValue, newValue] of [['261128', '261127'], ['\u4eac\u90fd', '\u6771\u4eac'], ['"11","1","TEST"', '"10","1","TEST"']]) {
    writeFileSync(cardPath, rows.join('\n').replace(oldValue, newValue));
    assert.throws(() => withdrawalRuntimeFromFiles({ root, config: input.config, now }), /wrong-day/);
  }
  writeFileSync(cardPath, rows.join('\n'));
  writeFileSync(summaryPath, JSON.stringify({ races: [...summary.races, ...summary.races] }));
  assert.throws(() => withdrawalRuntimeFromFiles({ root, config: input.config, now }), /ambiguous/);
  writeFileSync(summaryPath, JSON.stringify(summary));
  writeFileSync(cardPath, rows.filter((_, i) => i !== 4).join('\n'));
  assert.throws(() => withdrawalRuntimeFromFiles({ root, config: input.config, now }), /unconfirmed missing/);
}));
