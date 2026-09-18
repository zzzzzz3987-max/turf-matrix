import test from "node:test";
import assert from "node:assert/strict";
import { benchmarkClosing, buildClosingReferenceFromExports } from "../closing-benchmark.mjs";
import { calculateAbilityProfile } from "../ability-ai.mjs";
const target = { date: "2026-06-06", raceKey: "target", horseId: "target-horse", course: "阪神", surface: "芝", trackCode: "18", distance: 1600, age: 2, classGroup: "maiden-debut", going: "1", paceClass: "back_loaded", last3F: 32.4, raceLast3F: 32.7, finishPosition: 1 };
const reference = Array.from({ length: 20 }, (_, i) => ({ ...target, date: `2025-06-${String(i + 1).padStart(2, "0")}`, raceKey: `r${i}`, horseId: `h${i}`, last3F: 34, raceLast3F: 34, completeField: true }));
test("contextual closing replaces rather than adds to the old score", () => {
  const evidence = benchmarkClosing(target, reference, "2026-09-19", 94);
  assert.equal(evidence.status, "available");
  assert.equal(evidence.score, 95);
  const h = { currentRace: { distance: 1600 }, pastRuns: [{ ...target, margin: 0, fieldSize: 6, closingBenchmark: evidence }] };
  assert.equal(calculateAbilityProfile(h).closingScore, 95);
  h.pastRuns[0].closingBenchmark = { ...evidence, status: "limited" };
  assert.equal(calculateAbilityProfile(h).closingScore, 94);
});
test("future, target race, duplicate, incomplete and mismatched rows cannot inflate the cohort", () => {
  const extras = reference.map((r) => ({ ...r, date: "2026-09-19", raceKey: `future${r.raceKey}` }));
  const rows = [...reference.slice(0, 19), ...reference.slice(0, 19), ...extras,
    { ...reference[19], completeField: false }, { ...reference[19], age: 3 }, { ...reference[19], raceKey: target.raceKey }];
  const result = benchmarkClosing(target, rows, "2026-09-19", 94);
  assert.equal(result.status, "limited");
  assert.equal(result.raceCount, 19);
  assert.equal(result.score, 94);
});
test("missing class, missing individual time, and few race days leave the original score unchanged", () => {
  for (const t of [{ ...target, classGroup: null }, { ...target, last3F: null }, { ...target, date: "2026-02-30" }]) {
    assert.equal(benchmarkClosing(t, reference, "2026-09-19", 94).status, "missing");
  }
  assert.equal(benchmarkClosing(target, reference.map((r) => ({ ...r, date: "2025-06-01" })), "2026-09-19", 94).status, "limited");
});

test("raw JV imports join age-specific class and require a complete deduplicated field", () => {
  const data = { schemaVersion: 3, races: [{ raceKey: "r", raceDate: "20260606", courseCode: "09", trackCode: "18", distance: 1600, fieldSize: 2, conditionCodes: ["701", "000", "000", "000"], turfConditionCode: "1", first3F: 37.4, last3F: 32.7 }],
    horses: [1, 2].map((n) => ({ raceKey: "r", horseNumber: n, bloodRegistrationNumber: `h${n}`, age: 2, last3F: 32.4 + n / 10, finishPosition: n })) };
  const rows = buildClosingReferenceFromExports([data, data]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].classGroup, "ungraded:701");
  assert.equal(rows[0].completeField, true);
  assert.equal(rows[0].paceClass, "back_loaded");
  assert.equal(buildClosingReferenceFromExports([{ ...data, horses: data.horses.slice(0, 1) }])[0].completeField, false);
  assert.equal(buildClosingReferenceFromExports([{ ...data, schemaVersion: 2 }]).length, 0);
});
