import assert from "node:assert/strict";
import test from "node:test";
import { buildPaceShapeProfile, buildPaceShapeShadow } from "../pace-shape-shadow.mjs";

const historyRace = (date, shape, role, finishPosition, positionChange = 0) => ({
  key: `${date}-niigata-07R`,
  date,
  course: "niigata",
  raceNumber: 7,
  shape,
  confidence: "high",
  fieldSize: 12,
  horses: [{
    horseNumber: 4,
    horseName: "テストホース",
    finishPosition,
    role,
    positionChange,
  }],
});
const horse = (runs, overrides = {}) => ({
  horseName: "テストホース",
  currentRace: { raceDate: "2026-09-05" },
  pastRuns: runs,
  ...overrides,
});
const run = (date, margin = 0.5) => ({ date, course: "新潟", raceNumber: 7, horseNumber: 4, margin });

test("front resistance in a collapse is positive and sample-shrunk", () => {
  const history = { races: [historyRace("2026-08-30", "front_collapse", "front", 4)] };
  const value = buildPaceShapeProfile(horse([run("2026-08-30")]), history);
  assert.equal(value.rawImpact, 2);
  assert.equal(value.adjustment, 1);
  assert.match(value.runs[0].reason, /前崩れを前方で踏ん張った/);
});

test("rear progress against front survival is positive", () => {
  const dates = ["2026-08-30", "2026-08-23", "2026-08-16"];
  const history = { races: dates.map((date) => historyRace(date, "front_survival", "rear", 5, 0.3)) };
  const value = buildPaceShapeProfile(horse(dates.map((date) => run(date))), history);
  assert.equal(value.adjustment, 2);
});

test("a shape-assisted placing is lightly discounted", () => {
  const history = { races: [historyRace("2026-08-30", "front_survival", "front", 2)] };
  assert.equal(buildPaceShapeProfile(horse([run("2026-08-30")]), history).adjustment, -1);
});

test("same-day and future race shapes are never joined", () => {
  const base = { races: [historyRace("2026-08-30", "front_collapse", "front", 4)] };
  const future = { races: [
    ...base.races,
    historyRace("2026-09-05", "front_collapse", "front", 1),
    historyRace("2026-09-12", "front_collapse", "front", 1),
  ] };
  const pastRuns = [run("2026-08-30"), run("2026-09-05"), run("2026-09-12")];
  assert.deepEqual(buildPaceShapeProfile(horse(pastRuns), base), buildPaceShapeProfile(horse(pastRuns), future));
});

test("Pace shape shadow ignores popularity, odds, and Value", () => {
  const history = { races: [historyRace("2026-08-30", "front_collapse", "front", 4)] };
  const original = buildPaceShapeShadow(horse([run("2026-08-30")], { popularity: 1, odds: 1.2, value: 99 }), 70, history);
  const changed = buildPaceShapeShadow(horse([{ ...run("2026-08-30"), popularity: 16 }], { popularity: 16, odds: 200, value: 1 }), 70, history);
  assert.deepEqual(original, changed);
  assert.equal(original.policy.observedRaceLapUsed, false);
});

test("Pace shape adjustment is deterministic and bounded", () => {
  const dates = ["2026-08-30", "2026-08-23", "2026-08-16", "2026-08-09", "2026-08-02"];
  const history = { races: dates.map((date) => historyRace(date, "front_collapse", "front", 3)) };
  const value = horse(dates.map((date) => run(date)));
  const first = buildPaceShapeShadow(value, 95, history);
  const second = buildPaceShapeShadow(value, 95, history);
  assert.deepEqual(first, second);
  assert.equal(first.adjustment, 2);
  assert.equal(first.shadowScore, 96);
});

test("missing history leaves Pace unchanged", () => {
  const value = buildPaceShapeShadow(horse([run("2026-08-30")]), 68, { races: [] });
  assert.equal(value.status, "missing");
  assert.equal(value.shadowScore, 68);
  assert.equal(value.adjustment, 0);
});
