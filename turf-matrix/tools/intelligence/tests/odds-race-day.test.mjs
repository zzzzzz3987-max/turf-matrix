import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getOddsRaceDayEligibility } from '../../odds-race-day.mjs';

const inputs = date => {
  const race = { id: `${date}-東京-11R`, time: '15:30', fieldSize: 12 };
  return { published: { meta: { date }, races: [race] }, allRaceSignals: { date, raceCount: 1, races: [race] } };
};

test('prepared holiday Mondays, Fridays, substitute Tuesdays and weekends are eligible', () => {
  for (const date of ['2026-11-23', '2026-03-20', '2026-09-22', '2026-11-21', '2026-11-22']) {
    assert.equal(getOddsRaceDayEligibility({ ...inputs(date), now: `${date}T08:00:00+09:00` }).eligible, true);
  }
});

test('non-race weekdays and stale or future inputs skip without assuming every holiday is a race day', () => {
  for (const now of ['2026-11-24T09:00:00+09:00', '2026-11-20T09:00:00+09:00']) {
    assert.equal(getOddsRaceDayEligibility({ ...inputs('2026-11-23'), now }).eligible, false);
  }
  assert.equal(getOddsRaceDayEligibility({ now: '2026-11-24T09:00:00+09:00' }).eligible, false);
});

test('race-day selection uses Japan time and the latest candidate like the existing runner', () => {
  const next = inputs('2026-11-23');
  const result = getOddsRaceDayEligibility({
    ...next, published: inputs('2026-11-22').published, candidate: next.published,
    now: '2026-11-22T15:01:00Z',
  });
  assert.equal(result.eligible, true);
  assert.equal(result.source, 'candidate');
  assert.equal(getOddsRaceDayEligibility({ ...next, now: '2026-11-22T14:59:00Z' }).eligible, false);
});

test('current-day partial, mismatched and duplicate schedules fail closed', () => {
  const date = '2026-11-23';
  const valid = inputs(date);
  const now = `${date}T08:00:00+09:00`;
  for (const allRaceSignals of [null, { ...valid.allRaceSignals, date: '2026-11-22' },
    { ...valid.allRaceSignals, raceCount: 2 },
    { ...valid.allRaceSignals, races: [{ ...valid.allRaceSignals.races[0], time: '25:00' }] },
    { ...valid.allRaceSignals, raceCount: 2, races: [...valid.allRaceSignals.races, ...valid.allRaceSignals.races] }]) {
    assert.throws(() => getOddsRaceDayEligibility({ ...valid, allRaceSignals, now }));
  }
  assert.throws(() => getOddsRaceDayEligibility({ ...valid, published: { meta: { date }, races: [{ id: 'unknown' }] }, now }));
});

test('task definitions retain weekends, add weekday checks and gate before runner Git operations', () => {
  const registration = readFileSync(new URL('../../jvfetch/register-auto-odds-task.ps1', import.meta.url), 'utf8');
  assert.match(registration, /-Trigger @\(\$Saturday, \$Sunday, \$Weekdays\)/);
  assert.match(registration, /-DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday/);
  assert.match(registration, /<Monday \/><Tuesday \/><Wednesday \/><Thursday \/><Friday \/>/);
  const runner = readFileSync(new URL('../../jvfetch/invoke-auto-odds-runner.ps1', import.meta.url), 'utf8');
  assert.ok(runner.indexOf('odds-race-day.mjs') < runner.indexOf('Invoke-Checked $Git @("fetch"'));
});
