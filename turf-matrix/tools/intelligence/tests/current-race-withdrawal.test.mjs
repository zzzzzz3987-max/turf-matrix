import test from 'node:test';
import assert from 'node:assert/strict';
import { validateEntries, parse } from '../../parsers/current-race-detail-parser.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const entry = horseNumber => ({ raceDate: '2026-11-15', course: '京都', raceNo: 10,
  raceName: 'TEST', grade: null, surface: 'ダ', distance: 1800,
  horseName: `HORSE${horseNumber}`, horseNumber, sex: '牡', age: 4, jockey: 'JOCKEY',
  carriedWeight: 58, trainer: 'TRAINER', stableSide: '栗東', raceEntryId: `RACE${horseNumber}` });
const numbers = [1, 2, 3, 4, 5, 7, 8, 9, 10];

test('a withdrawn slot is accepted only when explicitly declared, without renumbering', () => {
  const entries = numbers.map(entry);
  assert.ok(validateEntries(entries).length);
  assert.deepEqual(validateEntries(entries, { excludedHorseNumbers: [6] }), []);
  assert.deepEqual(entries.map(h => h.horseNumber), numbers);
});

test('declared withdrawals do not hide a different missing horse or duplicate', () => {
  assert.ok(validateEntries([1, 2, 3, 4, 5, 6, 8, 9, 10].map(entry), { excludedHorseNumbers: [6] }).length);
  assert.ok(validateEntries([1, 2, 3, 4, 5, 7, 8, 9, 9].map(entry), { excludedHorseNumbers: [6] }).length);
  assert.ok(validateEntries([1, 2, 3].map(entry), { excludedHorseNumbers: [6] }).length);
});

test('invalid withdrawal declarations and fields beyond 18 fail closed', () => {
  for (const excludedHorseNumbers of [[0], [19], [1.5], [6, 6], '6']) {
    assert.ok(validateEntries(numbers.map(entry), { excludedHorseNumbers }).length);
  }
  assert.ok(validateEntries(Array.from({ length: 19 }, (_, i) => entry(i + 1))).length);
  assert.deepEqual(validateEntries([1, 2, 3].map(entry)), []);
  assert.deepEqual(validateEntries([1, 2, 3].map(entry), { excludedHorseNumbers: [4] }), []);
});

test('CSV parsing threads the explicit withdrawal through validation', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tm-withdrawal-'));
  try {
    const path = join(directory, 'current-race-detail.csv');
    const rows = numbers.map(number => {
      const cells = Array(34).fill('');
      for (const [index, value] of [[0, '261115'], [1, '京都'], [2, '10'], [3, number],
        [4, 'TEST'], [5, 'ダ'], [6, '1800'], [7, `HORSE${number}`], [8, '牡'],
        [9, '4'], [10, 'JOCKEY'], [11, '58'], [12, 'TRAINER'], [13, '栗東'], [32, `RACE${number}`]]) cells[index] = String(value);
      return cells.map(value => `"${value}"`).join(',');
    });
    writeFileSync(path, rows.join('\n'));
    assert.throws(() => parse({ path }));
    const result = parse({ path, excludedHorseNumbers: [6] });
    assert.equal(result.entryCount, 9);
    assert.deepEqual(result.entries.map(h => h.horseNumber), numbers);
  } finally {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(directory.startsWith(join(tmpdir(), 'tm-withdrawal-')));
    rmSync(directory, { recursive: true, force: true });
  }
});
