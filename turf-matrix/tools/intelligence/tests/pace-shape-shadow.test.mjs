import assert from "node:assert/strict";
import test from "node:test";
import { buildHorseLapEvidence, buildPaceShapeProfile, buildPaceShapeShadow } from "../pace-shape-shadow.mjs";
import { buildLapProfile } from "../race-shape-history.mjs";

const lapProfile = buildLapProfile({ distance: 2000, lapTimes: [13.2, 12, 13.3, 13.4, 12.9, 12, 11.7, 11.4, 11.3, 11.4] });

test("race sectionals join individual position changes without inventing individual laps", () => {
  const value = buildHorseLapEvidence({ lapProfile }, { lastCornerPosition: 4, finishPosition: 1 });
  assert.equal(value.positionsGained, 3);
  assert.equal(value.placed, true);
  assert.equal(value.raceSectionals.last5F, 57.8);
  assert.equal(value.individualLapEstimated, false);
  assert.equal(value.scoreAdjustment, 0);
  assert.match(value.reason, /4角4番手から1着/);
  const beaten = buildHorseLapEvidence({ lapProfile }, { lastCornerPosition: 4, finishPosition: 10 });
  assert.equal(beaten.placed, false);
  assert.equal(beaten.positionsGained, -6);
  assert.match(beaten.reason, /順位を下げた/);
});

test("missing positions and abnormal runs are not presented as lap performance", () => {
  for (const lastCornerPosition of [null, 0, "", undefined]) {
    assert.equal(buildHorseLapEvidence({ lapProfile }, { lastCornerPosition, finishPosition: 1 }), null);
  }
  assert.equal(buildHorseLapEvidence({}, { lastCornerPosition: 4, finishPosition: 1 }), null);
  assert.equal(buildHorseLapEvidence({ lapProfile }, { lastCornerPosition: 4, finishPosition: 1, abnormalityCode: "4" }), null);
});

test("lap evidence is attached to historical runs without changing shadow score", () => {
  const race = historyRace("2026-08-30", "neutral", "middle", 1);
  race.horses[0].lastCornerPosition = 4;
  const input = horse([run("2026-08-30")]);
  const before = buildPaceShapeShadow(input, 70, { races: [race] });
  const after = buildPaceShapeShadow(input, 70, { races: [{ ...race, lapProfile }] });
  assert.equal(after.shadowScore, before.shadowScore);
  assert.equal(after.runs[0].lapEvidence.positionsGained, 3);
  assert.equal(buildPaceShapeProfile({ ...input, currentRace: { raceDate: "2026-08-30" } }, { races: [{ ...race, lapProfile }] }).matchedRunCount, 0);
});

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
