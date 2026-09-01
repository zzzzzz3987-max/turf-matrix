import test from "node:test";
import assert from "node:assert/strict";
import { buildAbilityCeilingShadow, runCeilingQuality } from "../ability-ceiling-shadow.mjs";

const run = (overrides = {}) => ({
  finishPosition: 2,
  fieldSize: 16,
  margin: 0.1,
  raceName: "一般競走",
  surface: "芝",
  distance: 1600,
  last3F: 34,
  ...overrides,
});

const horse = (overrides = {}) => ({
  currentRace: { distance: 1600, surface: "芝" },
  pastRuns: [run(), run({ finishPosition: 3, margin: 0.2 })],
  ...overrides,
});

test("ability ceiling rewards demonstrated class without using market data", () => {
  const graded = runCeilingQuality(run({ finishPosition: 4, margin: 0.4, raceName: "G1" }));
  const ordinary = runCeilingQuality(run({ finishPosition: 4, margin: 0.4 }));
  assert.ok(graded > ordinary);
});

test("ability ceiling does not compare raw closing times across conditions", () => {
  const fast = runCeilingQuality(run({ last3F: 32.1 }));
  const slow = runCeilingQuality(run({ last3F: 41.2, surface: "ダ", distance: 2400 }));
  assert.equal(fast, slow);
});

test("ability ceiling is independent from popularity, odds, and target distance", () => {
  const base = buildAbilityCeilingShadow(horse(), 65);
  const changed = buildAbilityCeilingShadow(horse({
    odds: { win: 999 },
    popularity: 16,
    currentRace: { distance: 3200, surface: "ダ" },
    pastRuns: horse().pastRuns.map((item, index) => ({ ...item, popularity: 16 - index })),
  }), 65);
  assert.deepEqual(changed, base);
});

test("ability ceiling adjustment is bounded", () => {
  const strong = buildAbilityCeilingShadow(horse({
    pastRuns: [run({ finishPosition: 1, margin: 0, raceName: "G1" }), run({ finishPosition: 1, margin: 0, raceName: "G2" })],
  }), 45);
  assert.equal(strong.adjustment, 3);
  assert.equal(strong.shadowScore, 48);
});

test("one-run evidence is shrunk and marked low-volume", () => {
  const result = buildAbilityCeilingShadow(horse({ pastRuns: [run({ finishPosition: 1, margin: 0 })] }), 65);
  assert.equal(result.centralRunCount, 1);
  assert.equal(result.evidenceFactor, 0.6);
  assert.equal(result.policy.currentRaceResultUsed, false);
});
