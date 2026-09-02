import assert from "node:assert/strict";
import test from "node:test";
import { classifyPaceTilt, classifyRaceShape, raceShapeKey } from "../race-shape-history.mjs";

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

test("official first and last 3F classify front-loaded and back-loaded pace", () => {
  assert.deepEqual(classifyPaceTilt({
    distance: 1600,
    lapTimes: [12.2, 10.8, 11.1, 11.7, 12, 11.8, 11.9, 12.2],
    first3F: 34.1,
    last3F: 35.9,
  }), {
    classification: "front_loaded",
    label: "前傾",
    first3F: 34.1,
    last3F: 35.9,
    deltaSeconds: -1.8,
    thresholdSeconds: 1,
    confidence: "high",
    completeLaps: true,
    lapCount: 8,
    rawFirst3F: 34.1,
    rawLast3F: 35.9,
    source: "official-first-last-3f",
  });
  assert.equal(classifyPaceTilt({
    distance: 1800,
    lapTimes: [12.8, 12.2, 12.1, 12, 12, 11.9, 11.7, 11.6, 11.5],
  }).classification, "back_loaded");
});

test("odd-distance first split is normalized to a true 600m section", () => {
  const value = classifyPaceTilt({
    distance: 1700,
    lapTimes: [7, 10.9, 11.5, 11.9, 12.5, 13, 13.6, 12.8, 12.3],
    first3F: 29.4,
    last3F: 38.7,
  });
  assert.equal(value.first3F, 35.4);
  assert.equal(value.last3F, 38.7);
  assert.equal(value.deltaSeconds, -3.3);
  assert.equal(value.source, "official-200m-laps-normalized-600m");
});

test("pace tilt and positional outcome remain separate facts", () => {
  const positions = race([1, 2, 3, 5, 6, 4, 7, 8, 9, 10, 11, 12]);
  const frontLoaded = classifyRaceShape({ ...positions, distance: 1200, first3F: 33.4, last3F: 35.2 });
  const backLoaded = classifyRaceShape({ ...positions, distance: 1200, first3F: 35.2, last3F: 33.4 });
  assert.equal(frontLoaded.shape, "front_survival");
  assert.equal(backLoaded.shape, "front_survival");
  assert.equal(frontLoaded.pace.classification, "front_loaded");
  assert.equal(backLoaded.pace.classification, "back_loaded");
});

test("a front runner that survives a front-loaded collapse is marked against-flow strong", () => {
  const value = classifyRaceShape({
    ...race([4, 11, 12, 8, 7, 6, 5, 10, 1, 2, 3, 9]),
    distance: 1600,
    first3F: 33.8,
    last3F: 36,
  });
  assert.equal(value.shape, "front_collapse");
  assert.equal(value.horses[0].flowAssessment, "against_flow_strong");
  assert.equal(value.horses[0].flowImpact, 2);
  assert.match(value.horses[0].flowReason, /前傾・差し決着/);
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
