import test from "node:test";
import assert from "node:assert/strict";
import { widePayoutFor } from "../../result-payouts.mjs";

test("wide payout matching is independent of horse-number order", () => {
  const race = { payouts: { wide: [{ numbers: [4, 13], payout: 620, popularity: 2 }] } };
  assert.deepEqual(widePayoutFor(race, 13, 4), { available: true, hit: true, payout: 620 });
});

test("a collected losing wide pair is available with zero payout", () => {
  const race = { payouts: { wide: [{ numbers: [4, 13], payout: 620, popularity: 2 }] } };
  assert.deepEqual(widePayoutFor(race, 4, 3), { available: true, hit: false, payout: 0 });
});

test("legacy result archives without wide payouts remain unavailable", () => {
  const race = { payouts: { win: [], place: [] } };
  assert.deepEqual(widePayoutFor(race, 4, 13), { available: false, hit: false, payout: 0 });
});

test("raw JV-Link wide payouts are recognized", () => {
  const race = { Payouts: [{ Type: "wide", HorseNumbers: [2, 7], Payout: 840, Popularity: 4 }] };
  assert.deepEqual(widePayoutFor(race, 2, 7), { available: true, hit: true, payout: 840 });
});
