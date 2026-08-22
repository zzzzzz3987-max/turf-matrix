import assert from "node:assert/strict";
import test from "node:test";
import {
  isObservationBeforeCutoff,
  resolveEvaluationCutoff,
} from "../../learn/blood-statistics-policy.mjs";

test("blood statistics cutoff resolves from normalized current race", () => {
  const source = {
    races: [{ horses: [{ currentRace: { raceDate: "2026-08-23" } }] }],
  };
  assert.equal(resolveEvaluationCutoff(source), "20260823");
});

test("blood statistics only accepts races strictly before evaluation day", () => {
  assert.equal(isObservationBeforeCutoff("2026-08-22", "2026-08-23"), true);
  assert.equal(isObservationBeforeCutoff("2026-08-23", "2026-08-23"), false);
  assert.equal(isObservationBeforeCutoff("2026-08-24", "2026-08-23"), false);
  assert.equal(isObservationBeforeCutoff(null, "2026-08-23"), false);
});
