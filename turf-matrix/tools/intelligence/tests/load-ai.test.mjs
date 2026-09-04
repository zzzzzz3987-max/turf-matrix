import test from "node:test";
import assert from "node:assert/strict";
import {
  ageAllowanceKg,
  buildLoadAnalysis,
  buildLoadToleranceProfile,
  buildRaceLoadContext,
  equivalentLoadKg,
} from "../load-ai.mjs";

const race = {
  raceDate: "2026-08-30",
  raceName: "新潟記念",
  grade: "G3",
  surface: "芝",
  distance: 2000,
};

const horse = ({ number, name, sex = "牡", age = 4, weight = 57, odds = 5, popularity = 3, pastRuns = [] }) => ({
  horseNumber: number,
  horseName: name,
  odds: { winOdds: odds, popularity },
  currentRace: {
    ...race,
    horseNumber: number,
    horseName: name,
    sex,
    age,
    carriedWeight: weight,
  },
  pastRuns,
});

test("August 3-year-old middle-distance allowance is 3kg in open class", () => {
  assert.equal(ageAllowanceKg({ age: 3, raceDate: race.raceDate, distance: 2000, openClass: true }), 3);
});

test("loads are compared after JRA age and sex allowance conversion", () => {
  assert.equal(equivalentLoadKg(horse({ age: 3, weight: 57 }), race).equivalentWeight, 60);
  assert.equal(equivalentLoadKg(horse({ age: 3, weight: 55 }), race).equivalentWeight, 58);
  assert.equal(equivalentLoadKg(horse({ sex: "牝", age: 4, weight: 56 }), race).equivalentWeight, 58);
  assert.equal(equivalentLoadKg(horse({ age: 4, weight: 57 }), race).equivalentWeight, 57);
});

test("relative load is bounded to a maximum two-point index adjustment", () => {
  const horses = [
    horse({ number: 1, name: "A", age: 3, weight: 57 }),
    horse({ number: 2, name: "B", age: 3, weight: 55 }),
    horse({ number: 3, name: "C", age: 4, weight: 57 }),
  ];
  const context = { ...race, load: buildRaceLoadContext(horses, race) };
  const analysis = buildLoadAnalysis(horses[0], context);
  assert.equal(context.load.medianEquivalentWeight, 58);
  assert.equal(analysis.relativeKg, 2);
  assert.equal(analysis.adjustment, -2);
});

test("repeated comparable high-load placings mitigate one negative point", () => {
  const pastRuns = [
    { finishPosition: 1, carriedWeight: 57, surface: "芝", distance: 2000 },
    { finishPosition: 3, carriedWeight: 57.5, surface: "芝", distance: 1800 },
  ];
  const target = horse({ number: 1, name: "A", age: 3, weight: 57, pastRuns });
  const field = [target, horse({ number: 2, name: "B", age: 3, weight: 55 }), horse({ number: 3, name: "C", age: 4, weight: 57 })];
  const analysis = buildLoadAnalysis(target, { ...race, load: buildRaceLoadContext(field, race) });
  assert.equal(analysis.adjustment, -1);
  assert.equal(analysis.comparableSuccessCount, 2);
});

test("three direct comparable placings mitigate a relative load penalty even when the broad profile is neutral", () => {
  const pastRuns = [
    { finishPosition: 1, fieldSize: 10, margin: 0, carriedWeight: 55, surface: "芝", distance: 1800 },
    { finishPosition: 3, fieldSize: 12, margin: 0.4, carriedWeight: 55, surface: "芝", distance: 1800 },
    { finishPosition: 3, fieldSize: 14, margin: 0.5, carriedWeight: 55, surface: "芝", distance: 2000 },
  ];
  const target = horse({ number: 1, name: "A", sex: "牝", age: 4, weight: 55, pastRuns });
  const field = [target, horse({ number: 2, name: "B", age: 4, weight: 55 }), horse({ number: 3, name: "C", age: 4, weight: 55 })];
  const analysis = buildLoadAnalysis(target, { ...race, load: buildRaceLoadContext(field, race) });

  assert.equal(analysis.rawAdjustment, -2);
  assert.equal(analysis.provenLoadMitigation, 1);
  assert.equal(analysis.adjustment, -1);
  assert.match(analysis.summary, /3着内3走/);
});

test("odds and popularity never change load evaluation", () => {
  const targetA = horse({ number: 1, name: "A", age: 3, weight: 57, odds: 2, popularity: 1 });
  const targetB = horse({ number: 1, name: "A", age: 3, weight: 57, odds: 80, popularity: 15 });
  const others = [horse({ number: 2, name: "B", age: 3, weight: 55 }), horse({ number: 3, name: "C", age: 4, weight: 57 })];
  const loadContext = buildRaceLoadContext([targetA, ...others], race);
  const clean = (value) => ({ adjustment: value.adjustment, score: value.score, relativeKg: value.relativeKg });
  assert.deepEqual(clean(buildLoadAnalysis(targetA, { ...race, load: loadContext })), clean(buildLoadAnalysis(targetB, { ...race, load: loadContext })));
});

test("individual high-load failures remain a caution even when the field load is neutral", () => {
  const target = horse({ number: 1, name: "A", age: 4, weight: 58, pastRuns: [
    { finishPosition: 12, fieldSize: 16, margin: 2.1, carriedWeight: 58, surface: "芝", distance: 2000 },
    { finishPosition: 10, fieldSize: 14, margin: 1.8, carriedWeight: 58.5, surface: "芝", distance: 1800 },
  ] });
  const tolerance = buildLoadToleranceProfile(target);
  assert.equal(tolerance.adjustment, -1);
  assert.equal(tolerance.sampleCount, 2);
});

test("a new career-high load is marked unproven without using popularity", () => {
  const target = horse({ number: 1, name: "A", age: 4, weight: 59, pastRuns: [
    { finishPosition: 2, fieldSize: 16, margin: 0.1, carriedWeight: 57, surface: "芝", distance: 2000 },
    { finishPosition: 1, fieldSize: 14, margin: 0, carriedWeight: 57.5, surface: "芝", distance: 1800 },
  ] });
  const tolerance = buildLoadToleranceProfile(target);
  assert.equal(tolerance.unprovenHigh, true);
  assert.equal(tolerance.adjustment, -1);
});
