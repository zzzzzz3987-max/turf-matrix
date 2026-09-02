import assert from "node:assert/strict";
import test from "node:test";
import { buildFrameAptitudeShadow, modelAvailableAt } from "../frame-ai.mjs";

const model = {
  period: { from: "2026-06-01", to: "2026-08-30" },
  levels: {
    course_surface_distance_field: {
      minimumSampleSize: 12,
      cells: {
        "niigata|turf|mile|large": {
          sampleSize: 120,
          baselineHitRate: 0.2,
          zones: {
            inner: { sampleSize: 40, placedCount: 12, hitRate: 0.3, adjustedHitRate: 0.24, adjustedLift: 0.04, reliability: 0.57 },
          },
        },
      },
    },
  },
};

const horse = (overrides = {}) => ({
  number: 2,
  name: "検証馬",
  odds: 1.2,
  finishPosition: 1,
  currentRace: { raceDate: "2026-09-06", course: "新潟", surface: "芝", distance: 1600, horseNumber: 2 },
  ...overrides,
});
const context = { date: "2026-09-06", course: "新潟", surface: "芝", distance: 1600, fieldSize: 15 };

test("frame v2 applies a supported pre-race context", () => {
  const shadow = buildFrameAptitudeShadow(horse(), context, 68, model);
  assert.equal(shadow.status, "active");
  assert.equal(shadow.shadowScore, 69);
  assert.equal(shadow.adjustment, 1);
  assert.equal(shadow.match.sampleSize, 40);
  assert.equal(shadow.confidence, "C");
});

test("future-dated frame models are blocked", () => {
  assert.equal(modelAvailableAt(model, "2026-08-30"), false);
  const shadow = buildFrameAptitudeShadow(horse(), { ...context, date: "2026-08-30" }, 68, model);
  assert.equal(shadow.status, "future_leakage_blocked");
  assert.equal(shadow.shadowScore, 68);
});

test("odds and current result cannot change frame v2", () => {
  const first = buildFrameAptitudeShadow(horse({ odds: 1.1, finishPosition: 1 }), context, 68, model);
  const second = buildFrameAptitudeShadow(horse({ odds: 99, finishPosition: 18 }), context, 68, model);
  assert.deepEqual(first, second);
});

test("same frame input returns the same score", () => {
  assert.deepEqual(
    buildFrameAptitudeShadow(horse(), context, 68, model),
    buildFrameAptitudeShadow(horse(), context, 68, model)
  );
});
