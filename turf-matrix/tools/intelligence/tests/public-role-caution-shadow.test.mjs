import test from 'node:test';
import assert from 'node:assert/strict';
import { assessPublicRoleCaution, selectPublicRoleCautionShadow, assertUpcomingPublicRoleRaces } from '../public-role-caution-shadow.mjs';

const horse = (number, score, popularity, factors = {}) => ({
  number, id: String(number), name: `horse-${number}`, aiScore: score, popularity,
  analysis: { factorsDetail: Object.fromEntries(Object.entries(factors).map(([key, value]) =>
    [key, typeof value === 'number' ? { status: 'active', score: value } : value])) },
});
const raceWith = factors => ({ horses: [horse(1, 85, 2), horse(2, 83, 3), horse(3, 81, 5), horse(4, 78, 1, factors)] });

test('market mismatch plus poor training is not a confirmed condition risk', () => {
  const race = raceWith({ training: 50, form: 60, distance: 77, course: 82 });
  const before = JSON.stringify(race);
  const result = selectPublicRoleCautionShadow(race);
  assert.equal(result.productionDanger.number, 4);
  assert.equal(result.cautionDanger, null);
  assert.equal(JSON.stringify(race), before);
});

test('danger requires both performance weakness and an evaluated condition risk', () => {
  assert.equal(selectPublicRoleCautionShadow(raceWith({ form: 60, pace: 60 })).cautionDanger.number, 4);
  assert.equal(selectPublicRoleCautionShadow(raceWith({ form: 75, pace: 60 })).cautionDanger, null);
});

test('missing factors and untested weight do not become adverse evidence', () => {
  const h = horse(4, 78, 1, { form: 60, distance: { status: 'missing', score: 20 },
    load: { status: 'active', score: 53, adjustment: -2, tolerance: { unprovenHigh: true, adjustment: 0 } },
    trackBias: { status: 'missing', adjustment: -3 } });
  assert.deepEqual(assessPublicRoleCaution(h).conditionRisks, []);
  h.analysis.factorsDetail.load.tolerance.adjustment = -1;
  assert.deepEqual(assessPublicRoleCaution(h).conditionRisks, ['load']);
});

test('value requires evaluated performance and condition support, not merely long odds', () => {
  const r = { horses: [horse(1, 85, 1), horse(2, 83, 2), horse(3, 80, 8, {
    ability: 74, distance: 77, value: { eligible: true, marketGap: 5 },
  })] };
  assert.equal(selectPublicRoleCautionShadow(r).cautionValue.number, 3);
  r.horses[2].analysis.factorsDetail.ability.status = 'missing';
  assert.equal(selectPublicRoleCautionShadow(r).cautionValue, null);
});

test('empty data abstains deterministically', () => {
  assert.equal(selectPublicRoleCautionShadow({}).cautionDanger, null);
  assert.equal(selectPublicRoleCautionShadow({}).cautionValue, null);
});

test('prospective freeze rejects started races, mixed dates, missing times and invalid clocks', () => {
  const input = { date: '2026-09-13', now: '2026-09-12T17:00:00+09:00', races: [{ bundleId: '2026-09-13-test-09R', time: '14:00' }] };
  assert.doesNotThrow(() => assertUpcomingPublicRoleRaces(input));
  assert.throws(() => assertUpcomingPublicRoleRaces({ ...input, now: '2026-09-13T14:00:00+09:00' }));
  assert.throws(() => assertUpcomingPublicRoleRaces({ ...input, now: 'invalid' }));
  for (const race of [{ time: '14:00', bundleId: '2026-09-12-test' }, { bundleId: '2026-09-13-test' }, { time: '25:00', bundleId: '2026-09-13-test' }]) {
    assert.throws(() => assertUpcomingPublicRoleRaces({ ...input, races: [race] }));
  }
  assert.throws(() => assertUpcomingPublicRoleRaces({ ...input, races: [] }));
});
