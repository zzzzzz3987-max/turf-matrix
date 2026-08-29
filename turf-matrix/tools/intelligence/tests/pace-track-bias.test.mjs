import test from "node:test";
import assert from "node:assert/strict";
import { scorePace } from "../pace-ai.mjs";
import { buildTrackBiasAnalysis, resolveTrackBias, trackBiasAdjustment } from "../track-bias-ai.mjs";

const horseWithPositions = (positions) => ({
  pastRuns: positions.map((position) => ({ passingOrder: [position] })),
});

test("pace score is unchanged when live track bias is unavailable", () => {
  const horse = horseWithPositions([2, 3, 4, 2]);
  assert.equal(scorePace(horse), scorePace(horse, {}));
});

test("pace score is independent from track-bias adjustment", () => {
  const context = { trackBias: { status: "active", style: "front", strength: "strong" } };
  const front = horseWithPositions([1, 2, 2, 3]);
  const closer = horseWithPositions([10, 11, 9, 12]);

  assert.equal(scorePace(front, context), scorePace(front));
  assert.equal(scorePace(closer, context), scorePace(closer));
});

test("track bias resolver requires an earlier source date and exact target race", () => {
  const snapshot = {
    sourceDate: "2026-08-29",
    targetDate: "2026-08-30",
    profiles: [{ track: "新潟", surface: "ダート", status: "active", style: "front", strength: "strong" }],
  };

  assert.equal(resolveTrackBias(snapshot, { raceDate: "2026-08-30", course: "新潟", surface: "ダート" })?.strength, "strong");
  assert.equal(resolveTrackBias(snapshot, { raceDate: "2026-08-30", course: "新潟", surface: "芝" }), null);
  assert.equal(resolveTrackBias(snapshot, { raceDate: "2026-08-29", course: "新潟", surface: "ダート" }), null);
});

test("strong front bias is bounded to plus or minus one point", () => {
  const context = { trackBias: { status: "active", style: "front", strength: "strong" } };
  const front = horseWithPositions([1, 2, 2, 3]);
  const closer = horseWithPositions([10, 11, 9, 12]);

  assert.equal(trackBiasAdjustment(front, context), 1);
  assert.equal(trackBiasAdjustment(closer, context), -1);
});

test("moderate and monitor profiles do not reward front runners", () => {
  const front = horseWithPositions([1, 2, 2, 3]);
  const closer = horseWithPositions([10, 11, 9, 12]);
  const moderate = { trackBias: { status: "active", style: "front", strength: "moderate", sourceDate: "2026-08-29", sample: {} } };
  const monitor = { trackBias: { status: "monitor", style: "front", strength: "watch", sourceDate: "2026-08-29", sample: {} } };

  assert.equal(trackBiasAdjustment(front, moderate), 0);
  assert.equal(trackBiasAdjustment(closer, moderate), -1);
  assert.equal(trackBiasAdjustment(closer, monitor), 0);
  assert.equal(buildTrackBiasAnalysis(front, monitor).status, "monitor");
});
