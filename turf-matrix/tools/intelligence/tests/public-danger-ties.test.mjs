import test from 'node:test';
import assert from 'node:assert/strict';
import { rankPublicRoleHorses, selectPublicDangerHorse } from '../../../src/lib/public-role-selection.js';
import { buildRacePublicConclusion } from '../../../src/lib/public-view-model.js';

const horse = (number, tmIndex, popularity) => ({ number, name: `horse-${number}`, tmIndex, popularity });

test('equal leaders are not dangerous merely because of horse number', () => {
  const race = { horses: [horse(1, 80, 4), horse(2, 80, 3), horse(3, 80, 2), horse(4, 80, 1)] };
  assert.equal(selectPublicDangerHorse(race), null);
  assert.deepEqual(rankPublicRoleHorses(race).map(h => h.competitionRank), [1, 1, 1, 1]);
});

test('tied runners share competition rank without changing display order', () => {
  const race = { horses: [horse(1, 85, 2), horse(2, 80, 3), horse(3, 80, 4), horse(4, 80, 1)] };
  const before = JSON.stringify(race);
  assert.equal(selectPublicDangerHorse(race), null);
  assert.deepEqual(rankPublicRoleHorses(race).map(h => h.rank), [1, 2, 3, 4]);
  assert.deepEqual(rankPublicRoleHorses(race).map(h => h.competitionRank), [1, 2, 2, 2]);
  assert.equal(JSON.stringify(race), before);
});

test('three strictly stronger horses still satisfy the existing mismatch boundary', () => {
  const race = { horses: [horse(1, 85, 2), horse(2, 83, 3), horse(3, 81, 4), horse(4, 78, 1)] };
  assert.equal(selectPublicDangerHorse(race).number, 4);
  race.horses.reverse();
  assert.equal(selectPublicDangerHorse(race).number, 4);
});

test('candidate priority uses shared rank rather than arbitrary position within ties', () => {
  const race = { horses: [horse(1, 90, 8), horse(2, 89, 9), horse(3, 88, 10),
    horse(4, 80, 1), horse(5, 80, 7), horse(6, 80, 6), horse(7, 80, 2)] };
  assert.equal(selectPublicDangerHorse(race).number, 4);
});

test('danger explanation and identity show the same shared rank as the selector', () => {
  const race = { horses: [horse(1, 90, 5), horse(2, 89, 6), horse(3, 88, 7),
    horse(4, 80, 8), horse(5, 80, 1)].map(h => ({ ...h, id: String(h.number) })) };
  const conclusion = buildRacePublicConclusion(race);
  assert.equal(conclusion.danger.horse.number, 5);
  assert.equal(conclusion.danger.horse.rank, 4);
  assert.match(conclusion.danger.note, /指数4位/);
  assert.doesNotMatch(conclusion.danger.note, /指数5位/);
});
