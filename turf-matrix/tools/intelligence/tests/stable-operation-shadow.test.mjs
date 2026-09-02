import assert from "node:assert/strict";
import test from "node:test";
import { buildStableOperationShadow, isModelAvailableAt } from "../stable-operation-shadow.mjs";

const model = {
  productionConnected: false,
  stables: [{
    name: "検証厩舎",
    confidence: "high",
    period: { from: "2026-06-01", to: "2026-08-30" },
    positivePattern: {
      accepted: true,
      direction: "positive",
      pattern: { rotationBucket: "8-20", jockeyContinuity: true },
      phrase: "前走から8〜20日 × 前走騎手が継続",
      sampleSize: 24,
      adjustedLift: 0.09,
      adjustedHitRate: 0.38,
      baselineHitRate: 0.29,
      validation: { sampleSize: 8, adjustedLift: 0.03 },
    },
    riskPattern: null,
  }],
};

const horse = (overrides = {}) => ({
  trainer: "検証厩舎",
  stableSide: "栗東",
  jockey: "継続騎手",
  odds: 1.1,
  finishPosition: 1,
  currentRace: {
    raceDate: "2026-09-06",
    course: "阪神",
    trainer: "検証厩舎",
    stableSide: "栗東",
    jockey: "継続騎手",
  },
  pastRuns: [{ date: "2026-08-23", trainer: "検証厩舎", jockey: "継続騎手" }],
  ...overrides,
});

test("stable operation shadow applies only a validated pre-race model", () => {
  const shadow = buildStableOperationShadow(horse(), {
    score: 74,
    components: { rotation: 2, jockey: 2, travel: 0, stablePattern: 2 },
  }, model);
  assert.equal(shadow.status, "active");
  assert.equal(shadow.operationAdjustment, 2);
  assert.equal(shadow.shadowScore, 72);
  assert.equal(shadow.adjustment, -2);
  assert.equal(shadow.positiveMatch.sampleSize, 24);
  assert.equal(shadow.policy.trainingPatternScoredInStable, false);
});

test("future-dated stable models are blocked", () => {
  assert.equal(isModelAvailableAt({ period: { to: "2026-09-06" } }, "2026-09-06"), false);
  const shadow = buildStableOperationShadow(horse({
    currentRace: { raceDate: "2026-08-30", course: "阪神", trainer: "検証厩舎", stableSide: "栗東", jockey: "継続騎手" },
  }), { score: 72 }, model);
  assert.equal(shadow.status, "future_leakage_blocked");
  assert.equal(shadow.operationAdjustment, 0);
});

test("odds and current result cannot change the stable shadow", () => {
  const first = buildStableOperationShadow(horse({ odds: 1.1, finishPosition: 1 }), { score: 72 }, model);
  const second = buildStableOperationShadow(horse({ odds: 99, finishPosition: 18 }), { score: 72 }, model);
  assert.deepEqual(first, second);
});

test("training pattern details do not change the stable v2 target", () => {
  const first = buildStableOperationShadow(horse(), { score: 72, components: { stablePattern: 0 } }, model);
  const second = buildStableOperationShadow(horse(), { score: 72, components: { stablePattern: 2 } }, model);
  assert.equal(first.shadowScore, second.shadowScore);
  assert.equal(first.operationAdjustment, second.operationAdjustment);
});

test("same input returns the same stable score", () => {
  assert.deepEqual(
    buildStableOperationShadow(horse(), { score: 72 }, model),
    buildStableOperationShadow(horse(), { score: 72 }, model)
  );
});
