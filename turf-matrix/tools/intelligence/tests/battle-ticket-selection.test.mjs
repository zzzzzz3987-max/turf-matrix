import test from "node:test";
import assert from "node:assert/strict";
import {
  buildBaselineBattleTicketPlan,
  buildBattleTicketPlan,
  sameBattleTicketPlan,
} from "../../battle-ticket-selection.mjs";

const strongRace = () => ({
  oddsStatus: "active",
  battleProfile: { score: 80, coverage: 1 },
  ticketOdds: {
    quinella: { minOdds: 8.6, maxOdds: 8.6, status: "active" },
    wide: { minOdds: 3.2, maxOdds: 3.8, status: "active" },
  },
  indexTop: { number: 4, name: "軸", tmIndex: 84, odds: 5.2, ev: 1.4 },
  opponents: [
    { number: 3, name: "相手一", tmIndex: 80, odds: 4.8 },
    { number: 13, name: "相手二", tmIndex: 74, odds: 10.2, selectionScore: 72, selectionCoverage: 1 },
  ],
});

test("strong pre-race evidence keeps all three ticket types", () => {
  const plan = buildBattleTicketPlan(strongRace());
  assert.equal(plan.status, "bet");
  assert.deepEqual(plan.tickets.map((item) => item.type), ["win", "quinella", "wide"]);
  assert.equal(plan.totalUnits, 3);
});

test("each ticket type is rejected independently", () => {
  const race = strongRace();
  race.indexTop.ev = 3.4;
  race.opponents[0].tmIndex = 72;
  const plan = buildBattleTicketPlan(race);
  assert.deepEqual(plan.tickets.map((item) => item.type), ["wide"]);
  assert.equal(plan.rejected.length, 2);
});

test("missing market data produces an explicit skip", () => {
  const race = strongRace();
  race.oddsStatus = "preodds";
  race.indexTop.odds = null;
  race.indexTop.ev = null;
  const plan = buildBattleTicketPlan(race);
  assert.equal(plan.status, "skip");
  assert.equal(plan.tickets.length, 0);
});

test("underpriced combinations are removed without discarding a valid win bet", () => {
  const race = strongRace();
  race.ticketOdds.quinella.minOdds = 3.9;
  race.ticketOdds.quinella.maxOdds = 3.9;
  race.ticketOdds.wide.minOdds = 1.9;
  const plan = buildBattleTicketPlan(race);
  assert.deepEqual(plan.tickets.map((item) => item.type), ["win"]);
});

test("baseline reproduces the current three displayed tickets", () => {
  assert.deepEqual(buildBaselineBattleTicketPlan(strongRace()).tickets.map((item) => item.type), ["win", "quinella", "wide"]);
});

test("three selected horses below break-even remove only the wide ticket", () => {
  const race = strongRace();
  race.indexTop.ev = 0.9;
  race.opponents[0].ev = 0.6;
  race.opponents[1].ev = 0.7;

  assert.deepEqual(buildBaselineBattleTicketPlan(race).tickets.map((item) => item.type), ["win", "quinella"]);
  const plan = buildBattleTicketPlan(race);
  assert.deepEqual(plan.tickets.map((item) => item.type), ["win", "quinella"]);
  assert.ok(plan.rejected.includes("ワイド: 選出3頭がすべて期待値1.00未満"));
});

test("ticket plan identity ignores rationale text and pair order", () => {
  const left = buildBattleTicketPlan(strongRace());
  const right = structuredClone(left);
  right.tickets[1].horses.reverse();
  right.tickets[0].rationale = "別の説明";
  assert.equal(sameBattleTicketPlan(left, right), true);
});
