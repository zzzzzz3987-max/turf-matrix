import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPublicBattleTicketPlan } from '../../public-battle-ticket-plan.mjs';

const horse = (number, tmIndex = 78) => ({ number, name: `Horse${number}`, tmIndex, odds: 5 });
const race = count => ({ oddsStatus: 'active', indexTop: horse(1, 82), battleCandidates: Array.from({ length: count }, (_, i) => horse(i + 2)) });

test('four partners produce exactly six unique trios and one win, never over five horses', () => {
  const plan = buildPublicBattleTicketPlan(race(8));
  assert.equal(plan.opponents.length, 4);
  assert.equal(plan.totalUnits, 7);
  const trios = plan.tickets.filter(t => t.type === 'trio');
  assert.equal(trios.length, 6);
  assert.equal(new Set(trios.map(t => t.numbers.join('-'))).size, 6);
  for (const t of trios) assert(t.numbers.includes(1));
  for (const h of plan.opponents) assert(trios.some(t => t.numbers.includes(h.number)));
});

test('three partners produce three trios and 400 yen at 100 yen per ticket', () => {
  assert.equal(buildPublicBattleTicketPlan(race(3)).totalUnits * 100, 400);
});

test('duplicates, axis, low scores and missing odds do not fill selections', () => {
  const r = race(2);
  r.battleCandidates.push(horse(1), horse(2), horse(7, 60), { ...horse(8), odds: null });
  const plan = buildPublicBattleTicketPlan(r);
  assert.deepEqual(plan.opponents.map(h => h.number), [2, 3]);
  assert.equal(plan.totalUnits, 2);
});

test('missing market suppresses tickets; insufficient partners never appear as unused picks', () => {
  assert.equal(buildPublicBattleTicketPlan({ ...race(4), oddsStatus: 'missing' }).tickets.length, 0);
  assert.equal(buildPublicBattleTicketPlan(race(1)).opponents.length, 0);
  assert.equal(buildPublicBattleTicketPlan(race(1)).totalUnits, 1);
  assert.equal(buildPublicBattleTicketPlan(null).status, 'pending');
});
