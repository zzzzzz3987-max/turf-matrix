import assert from "node:assert/strict";
import test from "node:test";
import { oddsFieldSizeIssue, preserveCompletedPool } from "../../odds-field-size.mjs";

const check = (statuses, overrides = {}) => oddsFieldSizeIssue({
  expectedSize: 8, rows: statuses.map(status => ({ status })),
  raceDate: "2026-10-18", time: "14:20",
  now: Date.parse("2026-10-18T14:28:00+09:00"), ...overrides,
});
test("completed closed pool shortage does not block later live races", () => {
  assert.equal(check(Array(7).fill("closed")).severity, "warning");
});
test("active, partial, future, unknown-time and empty shortages still fail", () => {
  assert.equal(check(Array(7).fill("active")).severity, "failure");
  assert.equal(check([...Array(6).fill("closed"), "missing"]).severity, "failure");
  assert.equal(check(Array(7).fill("closed"), { time: "14:35" }).severity, "failure");
  assert.equal(check(Array(7).fill("closed"), { time: undefined }).severity, "failure");
  assert.equal(check([]).severity, "failure");
});
test("extra rows still fail and exact field sizes pass", () => {
  assert.equal(check(Array(9).fill("closed")).severity, "failure");
  assert.equal(check(Array(8).fill("active")), null);
});

test("missing popularity in a completed closed pool preserves its saved public race", () => {
  const previous = { id: "2026-10-18-京都-9R", saved: true };
  const race = { id: previous.id, time: "14:20", horses: [
    { odds: 2, popularity: 1, oddsDetail: { status: "closed" } },
    { odds: null, popularity: null },
  ] };
  const now = Date.parse("2026-10-18T14:28:00+09:00");
  assert.equal(preserveCompletedPool(race, previous, now), previous);
  assert.equal(preserveCompletedPool(race, previous, now - 3600000), race);
  assert.equal(preserveCompletedPool(race, null, now), race);
  const active = { ...race, horses: [{ odds: 2, popularity: 1, oddsDetail: { status: "active" } }, { odds: null, popularity: null }] };
  assert.equal(preserveCompletedPool(active, previous, now), active);
});
