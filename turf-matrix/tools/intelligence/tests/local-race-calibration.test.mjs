import assert from "node:assert/strict";
import test from "node:test";
import { calculateAbilityProfile } from "../ability-ai.mjs";
import { calculateTmIndex, weightsFor } from "../tm-index-engine.mjs";
import { isLocalRun } from "../race-origin.mjs";
import { valueCandidateEligibility, verdictForEv } from "../value-ai.mjs";

const centralRun = (overrides = {}) => ({
  course: "中山",
  raceName: null,
  distance: 1800,
  fieldSize: 16,
  finishPosition: 8,
  margin: 1.2,
  last3F: 38.5,
  popularity: 8,
  ...overrides,
});

const localRun = (overrides = {}) => ({
  course: null,
  raceName: "高知一般　Ｃ３",
  distance: 1400,
  fieldSize: 10,
  finishPosition: 1,
  margin: 0,
  popularity: 1,
  ...overrides,
});

test("local race rows are detected without changing their display data", () => {
  const run = localRun();
  assert.equal(isLocalRun(run), true);
  assert.equal(run.raceName, "高知一般　Ｃ３");
  assert.equal(isLocalRun(centralRun()), false);
});

test("local wins supplement but do not replace central ability evidence", () => {
  const central = [
    centralRun({ finishPosition: 10, margin: 3.3 }),
    centralRun({ finishPosition: 2, margin: 0.1 }),
    centralRun({ course: "東京", distance: 1600, finishPosition: 9, margin: 1.3 }),
  ];
  const mixed = calculateAbilityProfile({
    currentRace: { distance: 1800 },
    pastRuns: [
      ...Array.from({ length: 7 }, (_, index) => localRun({ raceName: `地方一般　Ｃ${index < 2 ? 2 : 3}` })),
      ...central,
    ],
  });
  const localOnly = calculateAbilityProfile({
    currentRace: { distance: 1800 },
    pastRuns: Array.from({ length: 7 }, () => localRun()),
  });

  assert.equal(mixed.centralRunCount, 3);
  assert.equal(mixed.localRunCount, 7);
  assert.equal(mixed.confidence, "mid");
  assert.ok(mixed.score < localOnly.score);
});

test("historical popularity does not change Ability", () => {
  const runs = [
    centralRun({ finishPosition: 2, margin: 0.2, popularity: 1 }),
    centralRun({ finishPosition: 4, margin: 0.5, popularity: 2 }),
    centralRun({ finishPosition: 5, margin: 0.7, popularity: 3 }),
  ];
  const changedPopularity = runs.map((run, index) => ({ ...run, popularity: 16 - index }));

  const first = calculateAbilityProfile({ currentRace: { distance: 1800 }, pastRuns: runs });
  const second = calculateAbilityProfile({ currentRace: { distance: 1800 }, pastRuns: changedPopularity });
  assert.equal(first.score, second.score);
});

test("TM INDEX weights exclude Value while Value remains independently available", () => {
  assert.equal(Object.hasOwn(weightsFor({ category: "special" }), "value"), false);

  const scores = {
    ability: 70,
    form: 68,
    distance: 72,
    course: 66,
    training: 71,
    blood: 64,
    pace: 69,
  };
  assert.equal(
    calculateTmIndex({ ...scores, value: 35 }, { category: "special" }),
    calculateTmIndex({ ...scores, value: 95 }, { category: "special" }),
  );
});

test("Value signal range starts at 1.00 and excludes EV 3.00 or higher", () => {
  assert.notEqual(verdictForEv(0.99)?.tone, "blue");
  assert.equal(verdictForEv(1.0)?.tone, "blue");
  assert.equal(verdictForEv(2.99)?.tone, "blue");
  assert.notEqual(verdictForEv(3)?.tone, "blue");
});

test("Value candidates require both market gap and EV support", () => {
  const horse = { tmIndex: 74 };
  assert.equal(valueCandidateEligibility(horse, 1.0, 2).eligible, true);
  assert.equal(valueCandidateEligibility(horse, 0.99, 2).eligible, false);
  assert.equal(valueCandidateEligibility(horse, 1.8, 1).eligible, false);
  assert.equal(valueCandidateEligibility(horse, 3, 6).eligible, false);
});
