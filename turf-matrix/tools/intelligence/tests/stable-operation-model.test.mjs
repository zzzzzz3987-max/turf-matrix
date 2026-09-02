import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const model = require("../../../data/master/stable-operations.json");

test("stable operation model remains shadow-only and chronologically bounded", () => {
  assert.equal(model.status, "shadow-approved");
  assert.equal(model.productionConnected, false);
  assert.equal(model.learningPolicy.futureRaceRead, false);
  assert.equal(model.learningPolicy.currentRaceOddsPopularityRead, false);
  assert.equal(model.learningPolicy.currentRaceResultRead, false);
  assert.match(model.period.from, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(model.period.to, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(model.period.from <= model.period.to);
  assert.ok(model.stables.length > 0);
});

test("every promoted stable pattern passed sample and holdout gates", () => {
  for (const stable of model.stables) {
    const patterns = [stable.positivePattern, stable.riskPattern].filter(Boolean);
    assert.ok(patterns.length > 0);
    assert.ok(stable.sampleSize >= model.learningPolicy.minimumStableSampleSize);
    for (const pattern of patterns) {
      assert.equal(pattern.accepted, true);
      assert.ok(pattern.sampleSize >= model.learningPolicy.minimumPatternSampleSize);
      assert.ok(pattern.validation.sampleSize >= model.learningPolicy.minimumValidationMatches);
      assert.equal(pattern.validation.status, "passed");
      if (pattern.direction === "positive") {
        assert.ok(pattern.adjustedLift >= model.learningPolicy.minimumAdjustedLift);
        assert.ok(pattern.validation.adjustedLift >= model.learningPolicy.minimumValidationLift);
      } else {
        assert.ok(pattern.adjustedLift <= -model.learningPolicy.minimumAdjustedLift);
        assert.ok(pattern.validation.adjustedLift <= -model.learningPolicy.minimumValidationLift);
      }
    }
  }
});
