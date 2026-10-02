import test from 'node:test';
import assert from 'node:assert/strict';
import { hasCompletePublicDangerMarket, selectPublicDangerHorse } from '../../../src/lib/public-role-selection.js';
import { buildRacePublicConclusion } from '../../../src/lib/public-view-model.js';

const makeRace = () => ({ oddsStatus: 'active', horses: [
  { id: '1', number: 1, name: 'Leader', tmIndex: 85, popularity: 2, odds: 4 },
  { id: '2', number: 2, name: 'Second', tmIndex: 83, popularity: 3, odds: 6 },
  { id: '3', number: 3, name: 'Third', tmIndex: 81, popularity: 4, odds: 12 },
  { id: '4', number: 4, name: 'Popular', tmIndex: 78, popularity: 1, odds: 2 },
] });

test('danger requires complete market data without changing index ranks', () => {
  const race = makeRace();
  assert.equal(selectPublicDangerHorse(race).number, 4);
  const before = JSON.stringify(race);
  buildRacePublicConclusion(race);
  assert.equal(JSON.stringify(race), before);
  for (const status of ['partial', 'missing', 'preodds', 'pending']) {
    assert.equal(selectPublicDangerHorse({ ...race, oddsStatus: status }), null);
  }
});

test('missing or invalid odds or popularity anywhere in the field defer danger', () => {
  for (const key of ['odds', 'popularity']) {
    for (const value of [null, undefined, 0, -1, NaN, Infinity, '2']) {
      const race = makeRace();
      race.horses[0][key] = value;
      assert.equal(hasCompletePublicDangerMarket(race), false);
      assert.equal(selectPublicDangerHorse(race), null);
      assert.equal(buildRacePublicConclusion(race).danger.value, 'オッズ確認待ち');
      assert.equal(buildRacePublicConclusion(race).danger.status, 'pending');
    }
  }
  const race = makeRace();
  race.horses[3].popularity = 1.5;
  assert.equal(selectPublicDangerHorse(race), null);
});

test('danger odds boundary excludes 10.0 and above, but retains 9.9', () => {
  const race = makeRace();
  race.horses[3].odds = 9.9;
  assert.equal(selectPublicDangerHorse(race).number, 4);
  for (const odds of [10, 10.1, 100]) {
    race.horses[3].odds = odds;
    assert.equal(selectPublicDangerHorse(race), null);
    assert.equal(buildRacePublicConclusion(race).danger.value, '該当馬なし');
    assert.equal(buildRacePublicConclusion(race).danger.status, 'none');
  }
});

test('legacy data still requires numeric odds; empty market never passes', () => {
  const race = makeRace();
  delete race.oddsStatus;
  assert.equal(selectPublicDangerHorse(race).number, 4);
  race.dataStatus = { odds: 'partial' };
  assert.equal(selectPublicDangerHorse(race), null);
  assert.equal(hasCompletePublicDangerMarket({ horses: [] }), false);
});
