import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePublicRoleResults } from '../../analyze/lib/public-role-archive.mjs';

const raw = () => ({ RaceDate: '2026-10-04', Races: [{
  Race: { CourseCode: '05', RaceNo: 9 }, IsFinal: true, HasPayouts: true,
  Horses: [{ HorseNumber: 4, HorseName: 'winner', FinishPosition: 1, AbnormalityCode: '0' },
    { HorseNumber: 5, HorseName: 'excluded', FinishPosition: null, AbnormalityCode: '3' }],
  Payouts: [{ Type: 'win', HorseNumber: 4, Payout: 310 }, { Type: 'place', HorseNumber: 4, Payout: 150 }],
}] });

test('raw finalized archive maps identities and payouts without mutating input', () => {
  const input = raw(), before = JSON.stringify(input);
  const output = normalizePublicRoleResults(input, input.RaceDate);
  assert.equal(output.races[0].bundleId, '2026-10-04-tokyo-09R');
  assert.equal(output.races[0].horses[0].winPayout, 310);
  assert.equal(output.races[0].horses[1].finishPosition, null);
  assert.equal(output.races[0].horses[1].abnormalityCode, '3');
  assert.equal(output.races[0].horses[1].winPayout, 0);
  assert.equal(JSON.stringify(input), before);
});
test('legacy normalized archive remains compatible', () => {
  const input = { races: [] };
  assert.equal(normalizePublicRoleResults(input, '2026-10-04'), input);
});
test('wrong date, unfinalized results, and missing payouts are rejected', () => {
  assert.throws(() => normalizePublicRoleResults(raw(), '2026-10-03'));
  for (const key of ['IsFinal', 'HasPayouts']) {
    const input = raw(); input.Races[0][key] = false;
    assert.throws(() => normalizePublicRoleResults(input, input.RaceDate));
  }
});
test('duplicate race or horse and invalid payout fail closed', () => {
  const a = raw(); a.Races.push(a.Races[0]);
  assert.throws(() => normalizePublicRoleResults(a, a.RaceDate));
  const b = raw(); b.Races[0].Horses.push(b.Races[0].Horses[0]);
  assert.throws(() => normalizePublicRoleResults(b, b.RaceDate));
  const c = raw(); c.Races[0].Payouts[0].Payout = -1;
  assert.throws(() => normalizePublicRoleResults(c, c.RaceDate));
});
