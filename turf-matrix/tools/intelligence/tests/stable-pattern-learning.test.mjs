import assert from "node:assert/strict";
import test from "node:test";
import { evaluatePattern, learnStablePatterns, matchesPattern } from "../../learn/stable-pattern-learning.mjs";

const observation = (index, { trainer = "検証厩舎", fast = false, placed = false } = {}) => ({
  id: `race-${String(index).padStart(2, "0")}`,
  trainer,
  raceDate: `2026-${index < 31 ? "07" : "08"}-${String((index % 28) + 1).padStart(2, "0")}`,
  placed,
  count: fast ? 5 : 2,
  phases: {
    oneWeek: fast
      ? { type: "wood", course: "CW", time4F: 50.8, last1F: 11.6, accel: true }
      : { type: "slope", course: "slope", time4F: 55.8, last1F: 13.2, accel: false },
  },
});

test("stable learner accepts only a repeatable pattern that beats the trainer baseline", () => {
  const observations = Array.from({ length: 40 }, (_, index) => {
    const fast = index % 2 === 0;
    const placed = fast ? index % 6 !== 0 : index % 10 === 1;
    return observation(index, { fast, placed });
  });
  const result = learnStablePatterns(observations, { minimumValidationMatches: 2 });
  assert.equal(result.stables.length, 1);
  const stable = result.stables[0];
  assert.equal(stable.winningPattern.phase, "oneWeek");
  assert.deepEqual(stable.winningPattern.course, ["CW"]);
  assert.ok(stable.adjustedLift >= 0.05);
  assert.equal(stable.validation.status, "passed");
});

test("stable learner rejects a common clock when it does not improve on the baseline", () => {
  const observations = Array.from({ length: 40 }, (_, index) => observation(index, {
    fast: index % 2 === 0,
    placed: index % 4 <= 1,
  }));
  const result = learnStablePatterns(observations, { minimumValidationMatches: 2 });
  assert.equal(result.stables.length, 0);
  assert.ok(result.candidates[0].rejectionReasons.includes("adjusted_lift_below_minimum"));
});

test("stable pattern matching keeps final and one-week phases separate", () => {
  const sample = {
    count: 5,
    phases: {
      final: { type: "wood", course: "CW", time4F: 51.0, last1F: 11.7, accel: true },
      oneWeek: { type: "slope", course: "slope", time4F: 54.0, last1F: 12.8, accel: false },
    },
  };
  assert.equal(matchesPattern(sample, {
    phase: "final", course: ["CW"], time4FMax: 52, last1FMax: 12, accel: true, minCount: 4,
  }), true);
  assert.equal(matchesPattern(sample, {
    phase: "oneWeek", course: ["CW"], time4FMax: 52, last1FMax: 12, accel: true, minCount: 4,
  }), false);
});

test("missing numeric criteria do not turn into zero-valued filters", () => {
  const sample = observation(1, { fast: true, placed: true });
  const metrics = evaluatePattern([sample], {
    phase: "oneWeek", course: ["CW"], time4FMax: null, last1FMax: null, accel: null,
  }, 0.25, 12);
  assert.equal(metrics.sampleSize, 1);
});
