import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { calculateAbilityProfile } from "../ability-ai.mjs";
import { scoreRecentForm } from "../form-ai.mjs";
import { buildDistanceProfile } from "../distance-ai.mjs";
import { enrichPeerRuns } from "../peer-run-enrichment.mjs";
import { calculateTmIndex } from "../tm-index-engine.mjs";
import { makeWeek, context, factor } from "./fixtures/overlap-week.mjs";
import { diagnoseEvidenceOverlap, restorePublishedPeerInputs } from "../../analyze/lib/evidence-overlap.mjs";
import { renderEvidenceOverlapReport } from "../../analyze/diagnose-evidence-overlap.mjs";


test("shared peer enrichment keeps original generation semantics and registration evidence", () => {
  const input = makeWeek().races[0].horses;
  input[0].currentRace.horseId = "123";
  const evidence = { score: 70 };
  const enriched = enrichPeerRuns(input, new Map([["123", evidence]]));
  assert.equal(enriched[0].opponentEvidence, evidence);
  assert.equal(enriched[1].opponentEvidence, null);
  assert.equal(enriched[0].peerRuns.length, 5);
  assert.deepEqual(enriched[0].peerRuns[0].peers, [{ horseName: "Horse2", horseNumber: 2, finishPosition: 12, margin: 2.4 }]);
  assert.equal(Object.hasOwn(input[0], "peerRuns"), false);
  const explicit = structuredClone(makeWeek().races[0]);
  explicit.horses[0].peerRuns = [];
  assert.deepEqual(restorePublishedPeerInputs(explicit)[0].peerRuns, []);
});

test("distance exclusions are opt-in and remove current-distance sensitivity only from Ability and Form", () => {
  const horse = makeWeek().races[0].horses[0];
  const far = { ...horse, currentRace: { ...horse.currentRace, distance: 2600 } };
  assert.notEqual(calculateAbilityProfile(horse).score, calculateAbilityProfile(far).score);
  assert.notEqual(scoreRecentForm(horse), scoreRecentForm(far));
  assert.equal(calculateAbilityProfile(horse, { includeDistanceFit: false }).score, calculateAbilityProfile(far, { includeDistanceFit: false }).score);
  assert.equal(scoreRecentForm(horse, { includeDistanceFit: false }), scoreRecentForm(far, { includeDistanceFit: false }));
  assert.notEqual(buildDistanceProfile(horse).score, buildDistanceProfile(far).score);
  assert.equal(calculateAbilityProfile(horse).score, calculateAbilityProfile(horse, { includeDistanceFit: true }).score);
  assert.equal(scoreRecentForm(horse), scoreRecentForm(horse, { includeDistanceFit: true }));
});

test("overlap counterfactuals preserve other factors, missing training and the legacy Form denominator", () => {
  const input = makeWeek();
  const before = JSON.stringify(input);
  const report = diagnoseEvidenceOverlap(input);
  const sources = restorePublishedPeerInputs(input.races[0]);
  for (const horse of report.races[0].horses) {
    const source = sources.find((item) => item.number === horse.number);
    assert.equal(Object.hasOwn(horse.scores, "training"), false);
    assert.equal(horse.candidates.formOnly.ability, horse.scores.ability);
    assert.equal(horse.candidates.abilityOnly.form, horse.scores.form);
    assert.equal(horse.candidates.formOnly.form, scoreRecentForm(source, { includeDistanceFit: false }));
    assert.notEqual(horse.candidates.formOnly.form, scoreRecentForm(source, { includeDistanceFit: false, normalizeWeights: true }));
    for (const candidate of Object.values(horse.candidates)) {
      assert.equal(candidate.raw, calculateTmIndex({ ...horse.scores, ability: candidate.ability, form: candidate.form }, context));
    }
  }
  assert.equal(JSON.stringify(input), before);
  assert.equal(report.productionConnected, false);
  assert.equal(report.prospectiveEvidence, false);
});

test("overlap counts source selections, not independent races or additive score bonuses", () => {
  const input = makeWeek();
  const report = diagnoseEvidenceOverlap(input);
  assert.equal(report.summary.tripleSharedRuns, 10);
  assert.equal(report.summary.nearDistanceTripleRuns, 10);
  assert.equal(report.summary.horsesWithTripleSharedRuns, 2);
  for (const horse of report.races[0].horses) {
    assert.equal(horse.runUsage.length, 5);
    assert.ok(horse.runUsage.every((run) => run.factors.length === 3 && run.directFormDistanceBonus === 4));
  }
  assert.match(renderEvidenceOverlapReport(report), /独立したレース数ではない/);
  assert.match(renderEvidenceOverlapReport(report), /精度低下とは判定しない/);
});

test("zero, one and two-run horses retain the exact sample correction", () => {
  for (const count of [0, 1, 2]) {
    const report = diagnoseEvidenceOverlap(makeWeek(count));
    for (const horse of report.races[0].horses) {
      for (const candidate of Object.values(horse.candidates)) {
        assert.equal(candidate.tm, Math.round(65 + (candidate.raw - 65) * factor(count)));
        if (count === 0) assert.equal(candidate.tmDelta, 0);
      }
    }
  }
});

test("diagnosis fails closed on stale baselines, future runs and absent external opponent snapshots", () => {
  const drift = makeWeek();
  drift.races[0].horses[0].tmIndex++;
  assert.throws(() => diagnoseEvidenceOverlap(drift), /Baseline replay/);
  const future = makeWeek();
  future.races[0].horses[0].pastRuns[0].date = future.meta.date;
  assert.throws(() => diagnoseEvidenceOverlap(future), /precede target date/);
  const missing = makeWeek();
  missing.races[0].horses[0].analysis.factorsDetail = { ability: { inputs: { opponentQuality: { score: 70 } } } };
  assert.throws(() => diagnoseEvidenceOverlap(missing), /Missing frozen opponent/);
});

test("all published horses replay after restoring peers, without reading results or modifying input", () => {
  const input = JSON.parse(readFileSync(new URL("../../week-data.json", import.meta.url), "utf8"));
  const before = JSON.stringify(input);
  const report = diagnoseEvidenceOverlap(input);
  assert.equal(report.summary.replayed, input.races.reduce((sum, race) => sum + race.horses.length, 0));
  assert.equal(JSON.stringify(input), before);
  const unrelated = structuredClone(input);
  unrelated.results = { arbitrary: "must not be read" };
  for (const race of unrelated.races) for (const horse of race.horses) {
    horse.popularity = 99;
    if (horse.oddsDetail) horse.oddsDetail.winOdds = 999;
    horse.odds = 999;
  }
  assert.deepEqual(diagnoseEvidenceOverlap(unrelated), report);
});
