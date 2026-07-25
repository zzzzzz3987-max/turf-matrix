import test from "node:test";
import assert from "node:assert/strict";
import { scorePace } from "../pace-ai.mjs";

const horseWithPositions = (positions) => ({
  pastRuns: positions.map((position) => ({ passingOrder: [position] })),
});

test("pace score is unchanged when live track bias is unavailable", () => {
  const horse = horseWithPositions([2, 3, 4, 2]);
  assert.equal(scorePace(horse), scorePace(horse, {}));
});

test("strong front bias applies a small deterministic style adjustment", () => {
  const context = { trackBias: { style: "front", strength: "strong" } };
  const front = horseWithPositions([1, 2, 2, 3]);
  const closer = horseWithPositions([10, 11, 9, 12]);

  assert.equal(scorePace(front, context) - scorePace(front), 4);
  assert.equal(scorePace(closer, context) - scorePace(closer), -3);
});
