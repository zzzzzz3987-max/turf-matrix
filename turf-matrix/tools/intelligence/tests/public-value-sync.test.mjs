import test from 'node:test';
import assert from 'node:assert/strict';
import { selectPublicFocusHorses, selectPublicRoleHorses } from '../../../src/lib/public-role-selection.js';
import { buildPublicBattleTicketPlan } from '../../public-battle-ticket-plan.mjs';

const horse = (number, tmIndex, gap = 0) => ({
  id: String(number), number, name: `Horse ${number}`, tmIndex,
  odds: 20, popularity: number,
  analysis: { factorsDetail: { value: { eligible: gap >= 2, ev: 1.5, marketGap: gap } } },
});
const planFor = race => {
  const focus = selectPublicFocusHorses(race);
  const compact = h => h && ({ ...h, ev: h.analysis.factorsDetail.value.ev,
    marketGap: h.analysis.factorsDetail.value.marketGap });
  return buildPublicBattleTicketPlan({ oddsStatus: 'active', indexTop: compact(focus.axis[0]),
    battleCandidates: focus.opponents.map(compact), valueWatch: compact(selectPublicRoleHorses(race).value) });
};

test('odds-driven value changes update the public horse and all battle tickets together', () => {
  const race = { horses: [horse(1, 85), horse(2, 82, 9), horse(3, 80), horse(4, 78),
    horse(5, 76, 4), horse(6, 74, 2)] };
  const before = planFor(race);
  assert.equal(before.valueHorse.number, 5);
  assert.equal(selectPublicFocusHorses(race).value[0].number, 5);
  race.horses[4].analysis.factorsDetail.value.eligible = false;
  const after = planFor(race);
  assert.equal(after.valueHorse.number, 6);
  assert.equal(selectPublicFocusHorses(race).value[0].number, 6);
  assert.ok(after.tickets.some(t => t.type === 'trio' && t.numbers.includes(6)));
  assert.ok(after.tickets.every(t => !t.numbers.includes(5)));
  race.horses[5].analysis.factorsDetail.value.eligible = false;
  assert.equal(planFor(race).valueHorse, null);
  assert.equal(selectPublicRoleHorses(race).value, null);
});
