import assert from "node:assert/strict";
import test from "node:test";
import { classifyRaceShape, raceShapeKey } from "../race-shape-history.mjs";

const race = (finishes, fieldSize = finishes.length) => ({
  fieldSize,
  horses: finishes.map((finishPosition, index) => ({
    horseNumber: index + 1,
    horseName: `馬${index + 1}`,
    finishPosition,
    corner1: index + 1,
    corner2: index + 1,
    corner3: index + 1,
    corner4: index + 1,
    abnormalityCode: "0",
  })),
});

test("race shape detects a front collapse from full-field positions", () => {
  const value = classifyRaceShape(race([10, 11, 12, 8, 7, 6, 5, 4, 1, 2, 3, 9]));
  assert.equal(value.shape, "front_collapse");
  assert.equal(value.frontCount, 3);
  assert.ok(value.frontTopHalfRate <= 0.34);
});

test("race shape detects front survival without calling it observed pace", () => {
  const value = classifyRaceShape(race([1, 2, 3, 5, 6, 4, 7, 8, 9, 10, 11, 12]));
  assert.equal(value.shape, "front_survival");
  assert.equal(value.winnerEarlyQuantile, 0);
});

test("partial fields are rejected instead of being treated as a full race", () => {
  assert.equal(classifyRaceShape(race([1, 2, 3, 4, 5], 12)), null);
});

test("race shape is independent from popularity and odds", () => {
  const base = race([10, 11, 12, 8, 7, 6, 5, 4, 1, 2, 3, 9]);
  const changed = structuredClone(base);
  changed.horses.forEach((horse, index) => {
    horse.popularity = index + 1;
    horse.odds = 100 - index;
  });
  assert.deepEqual(classifyRaceShape(base), classifyRaceShape(changed));
});

test("race keys normalize Japanese courses and dates", () => {
  assert.equal(raceShapeKey("2026/08/30", "新潟競馬場", 7), "2026-08-30-niigata-07R");
});
