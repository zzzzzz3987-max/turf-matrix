import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPublicBattleSnapshot, publicBattlePostTime, publicBattleRaceForDisplay, validPublicBattleSnapshot } from '../../public-battle-snapshot.mjs';

const date = '2026-11-21';
const before = Date.parse(`${date}T14:19:00+09:00`);
const after = Date.parse(`${date}T15:00:00+09:00`);
const race = { id: `${date}-京都-9R`, time: '14:25', oddsStatus: 'active',
  indexTop: { number: 3, name: 'Axis', tmIndex: 82, odds: 1.8 },
  battleCandidates: [6, 7, 4].map(number => ({ number, name: `Partner${number}`, tmIndex: 78, odds: 5 })) };
const capture = () => buildPublicBattleSnapshot({ raceDate: date, selectedRace: race, now: before });

test('captures the public selection and all ticket numbers before post time without mutating inputs', () => {
  const original = structuredClone(race);
  const snapshot = capture();
  assert.equal(validPublicBattleSnapshot(snapshot, date), true);
  assert.equal(snapshot.race.publicTicketPlan.totalUnits, 4);
  assert.deepEqual(snapshot.race.publicTicketPlan.opponents.map(h => h.number), [4, 6, 7]);
  assert.deepEqual(race, original);
  assert.notEqual(snapshot.race.indexTop, race.indexTop);
});
test('retains the exact pre-start record after closed markets erase or alter the current selections', () => {
  const saved = capture();
  const current = { ...race, oddsStatus: 'partial', battleCandidates: [], indexTop: { ...race.indexTop, odds: 1.7 } };
  const result = buildPublicBattleSnapshot({ raceDate: date, selectedRace: current,
    previous: { date, battleRaceSnapshot: saved }, now: after });
  assert.equal(result, saved);
  assert.equal(result.race.indexTop.odds, 1.8);
  assert.equal(result.race.publicTicketPlan.totalUnits, 4);
});
test('does not replace a started public battle race with a later retroactive selection', () => {
  const saved = capture();
  assert.equal(buildPublicBattleSnapshot({ raceDate: date, selectedRace: { ...race, id: `${date}-福島-11R`, time: '15:20' },
    previous: { date, battleRaceSnapshot: saved }, now: after }), saved);
});
test('pre-start updates remain live and can revise the selection before it is locked', () => {
  const saved = capture();
  const revised = { ...race, indexTop: { ...race.indexTop, odds: 2.1 } };
  const snapshot = buildPublicBattleSnapshot({ raceDate: date, selectedRace: revised,
    previous: { date, battleRaceSnapshot: saved }, now: before + 1000 });
  assert.equal(snapshot.race.indexTop.odds, 2.1);
  assert.notEqual(snapshot, saved);
});
test('never manufactures a pre-start record at or after post time or from partial odds', () => {
  for (const now of [publicBattlePostTime(race), after]) {
    assert.equal(buildPublicBattleSnapshot({ raceDate: date, selectedRace: race, now }), null);
  }
  assert.equal(buildPublicBattleSnapshot({ raceDate: date, selectedRace: { ...race, oddsStatus: 'partial' }, now: before }), null);
  assert.equal(buildPublicBattleSnapshot({ raceDate: date, selectedRace: { ...race, time: null }, now: before }), null);
});
test('does not carry the previous racing day into the next release', () => {
  const saved = capture();
  assert.equal(buildPublicBattleSnapshot({ raceDate: '2026-11-22', selectedRace: null,
    previous: { date, battleRaceSnapshot: saved }, now: after }), null);
});
test('display selects the validated frozen race while leaving all other current signals unchanged', () => {
  const saved = capture();
  const signals = { date, battleRaceId: race.id, battleRaceSnapshot: saved,
    races: [{ ...race, oddsStatus: 'partial', battleCandidates: [] }] };
  const original = structuredClone(signals);
  const display = publicBattleRaceForDisplay(signals);
  assert.equal(display.race, saved.race);
  assert.equal(display.snapshot, saved);
  assert.deepEqual(signals, original);
});
test('invalid, late or wrong-day records fall back without fabricating a frozen plan', () => {
  const saved = capture();
  for (const snapshot of [{ ...saved, capturedAt: saved.postTime }, { ...saved, raceDate: '2026-11-22' },
    { ...saved, postTime: 'bad' }, { ...saved, race: { ...saved.race, oddsStatus: 'closed' } }]) {
    const display = publicBattleRaceForDisplay({ date, battleRaceId: race.id, races: [race], battleRaceSnapshot: snapshot });
    assert.equal(display.race, race);
    assert.equal(display.snapshot, null);
  }
  assert.deepEqual(publicBattleRaceForDisplay(null), { race: null, snapshot: null });
});
