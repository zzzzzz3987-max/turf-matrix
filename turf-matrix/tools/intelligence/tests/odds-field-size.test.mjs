import assert from "node:assert/strict";
import test from "node:test";
import { oddsFieldSizeIssue } from "../../odds-field-size.mjs";

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
