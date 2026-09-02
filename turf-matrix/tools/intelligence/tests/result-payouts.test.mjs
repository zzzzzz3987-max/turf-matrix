import test from "node:test";
import assert from "node:assert/strict";
import { quinellaPayoutFor, widePayoutFor } from "../../result-payouts.mjs";

test("quinella payout matching is independent of horse-number order", () => {
  const race = { payouts: { quinella: [{ numbers: [4, 13], payout: 1840, popularity: 8 }] } };
  assert.deepEqual(quinellaPayoutFor(race, 13, 4), { available: true, hit: true, payout: 1840 });
});

test("a collected losing quinella pair is available with zero payout", () => {
  const race = { payouts: { quinella: [{ numbers: [4, 13], payout: 1840, popularity: 8 }] } };
  assert.deepEqual(quinellaPayoutFor(race, 4, 3), { available: true, hit: false, payout: 0 });
});

test("legacy result archives without quinella payouts remain unavailable", () => {
  const race = { payouts: { win: [], place: [], wide: [] } };
  assert.deepEqual(quinellaPayoutFor(race, 4, 13), { available: false, hit: false, payout: 0 });
});

test("raw JV-Link quinella payouts are recognized", () => {
  const race = { Payouts: [{ Type: "quinella", HorseNumbers: [2, 7], Payout: 2840, Popularity: 11 }] };
  assert.deepEqual(quinellaPayoutFor(race, 2, 7), { available: true, hit: true, payout: 2840 });
});

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
