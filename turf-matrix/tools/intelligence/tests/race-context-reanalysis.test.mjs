import test from "node:test";
import assert from "node:assert/strict";
import { equivalentLoadKg } from "../load-ai.mjs";
import { calculateAbilityProfile } from "../ability-ai.mjs";
import { buildTrainingAnalysis } from "../training-ai.mjs";

test("two-year-old sex allowance follows the September/October boundary", () => {
  const h = { currentRace: { age: 2, sex: "牝", carriedWeight: 55 } };
  assert.equal(equivalentLoadKg(h, { raceDate: "2026-09-19" }).equivalentWeight, 55);
  assert.equal(equivalentLoadKg(h, { raceDate: "2026-10-01" }).equivalentWeight, 56);
  h.currentRace.age = 3;
  assert.equal(equivalentLoadKg(h, { raceDate: "2026-09-19" }).sexAllowance, 2);
});

test("untracked opponents do not create negative evidence, and duplicates add no reliability", () => {
  const h = { currentRace: { distance: 1600 }, pastRuns: [{ finishPosition: 1, fieldSize: 6, last3F: 32.4, distance: 1600, margin: 0 }] };
  const calculate = (horse) => calculateAbilityProfile(horse, { sparseOpponentShrinkage: true });
  const baseline = calculate(h);
  const encounter = { finishPosition: 1, peers: [{ horseName: "peer", finishPosition: 3, laterStarts: 0, evidenceScore: 55 }] };
  h.opponentEvidence = { score: 55, encounters: [encounter] };
  assert.equal(calculate(h).score, baseline.score);
  encounter.peers[0].laterStarts = 1;
  const one = calculate(h);
  assert.equal(one.relationReliability, 0.25);
  assert.ok(one.effectiveRelationScore > one.relationScore);
  h.opponentEvidence.encounters.push(encounter);
  assert.equal(calculate(h).relationReliability, one.relationReliability);
});

test("short turnaround is neutral, future runs do not create an interval", () => {
  const h = { currentRace: { raceDate: "2026-09-19" }, pastRuns: [{ date: "2026-09-12" }] };
  const a = buildTrainingAnalysis(h);
  assert.equal(a.indexEligible, false);
  assert.equal(a.score, null);
  assert.equal(a.raceIntervalDays, 7);
  h.pastRuns = [{ date: "2026-09-20" }, { date: "2026-09-01" }];
  assert.equal(buildTrainingAnalysis(h).indexEligible, true);
  assert.equal(buildTrainingAnalysis(h).raceIntervalDays, 18);
});
