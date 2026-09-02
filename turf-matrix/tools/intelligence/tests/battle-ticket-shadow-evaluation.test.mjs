import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregateBattleTicketRows,
  evaluateBattleTicketPlan,
} from "../../analyze/lib/battle-ticket-shadow.mjs";

const plan = {
  status: "bet",
  tickets: [
    { type: "win", horses: [{ number: 4, name: "軸" }], units: 1 },
    { type: "quinella", horses: [{ number: 4, name: "軸" }, { number: 3, name: "相手一" }], units: 1 },
    { type: "wide", horses: [{ number: 4, name: "軸" }, { number: 13, name: "相手二" }], units: 1 },
  ],
};
const resultRace = {
  horses: [
    { horseNumber: 4, horseName: "軸", finishPosition: 1, winPayout: 420 },
    { horseNumber: 3, horseName: "相手一", finishPosition: 2, winPayout: 0 },
    { horseNumber: 13, horseName: "相手二", finishPosition: 3, winPayout: 0 },
  ],
  payouts: {
    quinella: [{ numbers: [3, 4], payout: 880 }],
    wide: [{ numbers: [13, 4], payout: 360 }],
  },
};

test("ticket evaluation calculates real return by ticket type", () => {
  const result = evaluateBattleTicketPlan(plan, resultRace);
  assert.equal(result.complete, true);
  assert.equal(result.stake, 300);
  assert.equal(result.return, 1660);
  assert.equal(result.profit, 1360);
  assert.equal(result.hits, 3);
  assert.equal(Number(result.roi.toFixed(1)), 553.3);
});

test("missing historical quinella payout never becomes a losing zero", () => {
  const race = structuredClone(resultRace);
  delete race.payouts.quinella;
  const result = evaluateBattleTicketPlan(plan, race);
  assert.equal(result.complete, false);
  assert.equal(result.comparableTicketCount, 2);
});

test("a scratched pair member is excluded instead of counted as a loss", () => {
  const race = structuredClone(resultRace);
  race.horses.find((horse) => horse.horseNumber === 3).finishPosition = null;
  const result = evaluateBattleTicketPlan(plan, race);
  assert.equal(result.complete, false);
  assert.equal(result.tickets.find((item) => item.type === "quinella").available, false);
});

test("aggregate keeps skipped days without inventing stake", () => {
  const bet = evaluateBattleTicketPlan(plan, resultRace);
  const skip = evaluateBattleTicketPlan({ status: "skip", tickets: [] }, resultRace);
  const aggregate = aggregateBattleTicketRows([bet, skip]);
  assert.equal(aggregate.days, 2);
  assert.equal(aggregate.betDays, 1);
  assert.equal(aggregate.skippedDays, 1);
  assert.equal(aggregate.stake, 300);
  assert.equal(aggregate.byType.quinella.hits, 1);
});
