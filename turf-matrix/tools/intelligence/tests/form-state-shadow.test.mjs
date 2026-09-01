import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFormStateProfile,
  buildFormStateShadow,
  isPreRaceRun,
  runFormQuality,
} from "../form-state-shadow.mjs";

const run = (overrides = {}) => ({
  date: "2026-08-01",
  course: "新潟",
  surface: "芝",
  distance: 1600,
  fieldSize: 16,
  finishPosition: 4,
  margin: 0.4,
  last3F: 33.1,
  popularity: 2,
  passingOrder: [8, 8, 6, 4],
  ...overrides,
});

const horse = (pastRuns, overrides = {}) => ({
  currentRace: { raceDate: "2026-09-05", course: "札幌", surface: "ダ", distance: 1700 },
  pastRuns,
  ...overrides,
});

test("Form recent quality uses finish percentile and margin", () => {
  const strong = runFormQuality(run({ finishPosition: 1, margin: 0 }));
  const weak = runFormQuality(run({ finishPosition: 12, margin: 2.1 }));
  assert.ok(strong > weak);
});

test("Form shadow is independent from popularity, odds, raw last3F, and target conditions", () => {
  const runs = [
    run({ date: "2026-08-24", finishPosition: 2, margin: 0.1 }),
    run({ date: "2026-08-10", finishPosition: 4, margin: 0.4 }),
    run({ date: "2026-07-20", finishPosition: 6, margin: 0.8 }),
  ];
  const original = buildFormStateShadow(horse(runs, { odds: 99, popularity: 16 }), 68);
  const changed = buildFormStateShadow(horse(runs.map((item) => ({ ...item, popularity: 1, last3F: 45 })), {
    odds: 1.1,
    popularity: 1,
    currentRace: { raceDate: "2026-09-05", course: "中山", surface: "芝", distance: 3200 },
  }), 68);
  assert.deepEqual(original, changed);
});

test("Form shadow excludes runs on or after the target race date", () => {
  const baseRuns = [
    run({ date: "2026-08-24", finishPosition: 4 }),
    run({ date: "2026-08-10", finishPosition: 5 }),
    run({ date: "2026-07-20", finishPosition: 6 }),
  ];
  const original = buildFormStateShadow(horse(baseRuns), 60);
  const future = buildFormStateShadow(horse([
    run({ date: "2026-09-05", finishPosition: 1, margin: 0 }),
    run({ date: "2026-09-12", finishPosition: 1, margin: 0 }),
    ...baseRuns,
  ]), 60);
  assert.deepEqual(original, future);
  assert.equal(isPreRaceRun({ date: "2026-09-05" }, "2026-09-05"), false);
  assert.equal(isPreRaceRun({}, "2026-09-05"), false);
});

test("relative momentum is evidence and does not change the cross-horse candidate", () => {
  const recent = [
    run({ date: "2026-08-24", finishPosition: 3, margin: 0.2 }),
    run({ date: "2026-08-10", finishPosition: 4, margin: 0.4 }),
    run({ date: "2026-07-20", finishPosition: 5, margin: 0.6 }),
  ];
  const strongOlder = buildFormStateProfile(horse([...recent,
    run({ date: "2026-06-20", finishPosition: 2, margin: 0.1 }),
    run({ date: "2026-06-01", finishPosition: 2, margin: 0.1 }),
  ]));
  const weakOlder = buildFormStateProfile(horse([...recent,
    run({ date: "2026-06-20", finishPosition: 12, margin: 2.1 }),
    run({ date: "2026-06-01", finishPosition: 13, margin: 2.4 }),
  ]));
  assert.equal(strongOlder.candidateScore, weakOlder.candidateScore);
  assert.notEqual(strongOlder.momentumScore, weakOlder.momentumScore);
});

test("lightly raced Form is shrunk toward neutral", () => {
  const single = buildFormStateProfile(horse([run({ finishPosition: 1, margin: 0 })]));
  const repeated = buildFormStateProfile(horse([
    run({ date: "2026-08-24", finishPosition: 1, margin: 0 }),
    run({ date: "2026-08-10", finishPosition: 1, margin: 0 }),
    run({ date: "2026-07-20", finishPosition: 1, margin: 0 }),
  ]));
  assert.ok(single.candidateScore < repeated.candidateScore);
  assert.equal(single.confidence, "Low");
});

test("Form shadow adjustment is deterministic and bounded to three points", () => {
  const value = horse([
    run({ date: "2026-08-24", finishPosition: 1, margin: 0 }),
    run({ date: "2026-08-10", finishPosition: 1, margin: 0 }),
    run({ date: "2026-07-20", finishPosition: 1, margin: 0 }),
  ]);
  const first = buildFormStateShadow(value, 40);
  const second = buildFormStateShadow(value, 40);
  assert.deepEqual(first, second);
  assert.equal(first.adjustment, 3);
  assert.equal(first.shadowScore, 43);
});

test("missing Form evidence leaves the current score unchanged", () => {
  const value = buildFormStateShadow(horse([]), 58);
  assert.equal(value.status, "missing");
  assert.equal(value.adjustment, 0);
  assert.equal(value.shadowScore, 58);
});
