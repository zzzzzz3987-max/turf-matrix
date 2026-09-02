import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateOperationPattern,
  learnStableOperationPatterns,
  matchesOperationPattern,
} from "../../learn/stable-operation-learning.mjs";

const dateAt = (index) => {
  const date = new Date(Date.UTC(2026, 0, 1 + index));
  return date.toISOString().slice(0, 10);
};

const observation = (index, overrides = {}) => ({
  id: `operation-${String(index).padStart(3, "0")}`,
  trainer: "検証厩舎",
  trainingCenter: "栗東",
  raceDate: dateAt(index),
  finish: 6,
  placed: false,
  rotationBucket: index % 2 ? "21-42" : "8-20",
  jockeyContinuity: index % 3 === 0,
  travelClass: index % 4 === 0 ? "away" : "home",
  ...overrides,
});

test("operation matching handles false boolean values", () => {
  const row = observation(1, { jockeyContinuity: false, travelClass: "away" });
  assert.equal(matchesOperationPattern(row, { jockeyContinuity: false, travelClass: "away" }), true);
  assert.equal(matchesOperationPattern(row, { jockeyContinuity: true }), false);
});

test("one perfect result is pulled toward the trainer baseline", () => {
  const rows = Array.from({ length: 20 }, (_, index) => observation(index, {
    rotationBucket: index === 0 ? "0-7" : "21-42",
    placed: index === 0 || index % 5 === 0,
    finish: index === 0 || index % 5 === 0 ? 2 : 7,
  }));
  const metrics = evaluateOperationPattern(rows, { rotationBucket: "0-7" }, 0.25, {
    globalPriorWeight: 30,
    patternPriorWeight: 20,
  });
  assert.equal(metrics.sampleSize, 1);
  assert.ok(metrics.adjustedHitRate < 0.35);
});

test("small trainer samples cannot produce an accepted model", () => {
  const rows = Array.from({ length: 20 }, (_, index) => observation(index, {
    placed: index % 2 === 0,
    finish: index % 2 === 0 ? 1 : 9,
  }));
  const result = learnStableOperationPatterns(rows);
  assert.equal(result.stables.length, 0);
  assert.equal(result.diagnostics[0].accepted, false);
  assert.equal(result.diagnostics[0].positivePattern.accepted, false);
});

test("learner accepts a stable-specific operation repeated in later races", () => {
  const rows = Array.from({ length: 100 }, (_, index) => {
    const target = index % 2 === 0;
    const placed = target ? index % 10 !== 0 : index % 10 === 1;
    return observation(index, {
      rotationBucket: target ? "8-20" : "21-42",
      jockeyContinuity: false,
      travelClass: "home",
      placed,
      finish: placed ? 2 : 8,
    });
  });
  const result = learnStableOperationPatterns(rows);
  assert.equal(result.stables.length, 1);
  assert.equal(result.stables[0].positivePattern.accepted, true);
  assert.equal(result.stables[0].positivePattern.pattern.rotationBucket, "8-20");
  assert.equal(result.stables[0].positivePattern.validation.status, "passed");
});

test("learner rejects a pattern that disappears in chronological validation", () => {
  const rows = Array.from({ length: 100 }, (_, index) => {
    const target = index % 2 === 0;
    const trainingPeriod = index < 70;
    const placed = trainingPeriod
      ? target && index % 6 !== 0
      : !target && index % 6 !== 1;
    return observation(index, {
      rotationBucket: target ? "8-20" : "21-42",
      jockeyContinuity: false,
      travelClass: "home",
      placed,
      finish: placed ? 3 : 9,
    });
  });
  const result = learnStableOperationPatterns(rows);
  assert.equal(result.stables.length, 0);
  assert.equal(result.candidates[0].positivePattern.accepted, false);
  assert.ok(result.candidates[0].positivePattern.validation.adjustedLift < 0);
});

test("learning is deterministic for the same observations", () => {
  const rows = Array.from({ length: 60 }, (_, index) => observation(index, {
    placed: index % 4 === 0,
    finish: index % 4 === 0 ? 1 : 7,
  }));
  assert.deepEqual(learnStableOperationPatterns(rows), learnStableOperationPatterns(rows));
});
