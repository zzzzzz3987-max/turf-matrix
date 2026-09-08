import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { scoreRecentForm, buildRecentFormWeightEvidence } from "../form-ai.mjs";
import { calculateTmIndex, buildIndexContributions } from "../tm-index-engine.mjs";
import { buildFormWeightsPrediction, buildFormWeightsArtifact, validateFormWeightsArtifact, evaluateFormWeightsArtifact } from "../../analyze/lib/form-weights-shadow.mjs";
import { validateCourseSurfaceArtifact } from "../../analyze/lib/course-surface-shadow.mjs";
import { renderFormWeightsReport } from "../../analyze/form-weights-shadow.mjs";
import { preserveFrozenArtifact } from "../../analyze/lib/factor-shadow-cli.mjs";

const context = { category: "special", surface: "芝" };
const sampleFactor = (count) => count === 0 ? 0.3 : count === 1 ? 0.5 : count === 2 ? 0.7 : 1;
const clamp = (value) => Math.max(35, Math.min(96, Math.round(value)));
const makeHorse = (number, count = 5) => {
  const horse = { number, name: "Horse" + number,
    currentRace: { raceDate: "2026-09-12", course: "中山", surface: "芝", distance: 1800 },
    pastRuns: Array.from({ length: count }, (_, i) => ({
      date: "2026-08-" + String(20 - i).padStart(2, "0"), course: "中山", surface: "芝", distance: 1800,
      fieldSize: 16, finishPosition: 2, margin: 0.2, last3F: 34,
    })),
  };
  const scores = { ability: 72, form: scoreRecentForm(horse), course: 64, distance: 70, blood: 68, pace: 70 };
  const raw = calculateTmIndex(scores, context);
  const adjusted = Math.round(65 + (raw - 65) * sampleFactor(count));
  horse.tmIndex = adjusted;
  horse.analysis = { indexContributions: buildIndexContributions(scores, context), rawTmIndex: raw,
    sampleAdjustment: adjusted - raw, goingAdjustment: 0, loadAdjustment: 0, trackBiasAdjustment: 0 };
  return horse;
};
const week = () => ({ meta: { date: "2026-09-12" }, races: [{
  bundleId: "2026-09-12-nakayama-09R", name: "Test", number: 9, track: "中山", surface: "芝",
  time: "14:00", raceContext: context, horses: [makeHorse(1), makeHorse(2, 2)],
}] });
const options = { now: "2026-09-12T04:00:00Z", prospective: true, modelSha256: "a".repeat(64) };
const resultsFor = (artifact) => ({ date: artifact.raceDate, races: artifact.predictions.map((race) => ({
  bundleId: race.raceId, horses: race.horses.map((horse, i) => ({
    horseNumber: horse.number, horseName: horse.name, finishPosition: i + 1,
    winPayout: i === 0 ? 240 : 0, placePayout: i === 0 ? 120 : 0,
  })),
})) });

test("Form-only candidate leaves Course and every other saved factor unchanged without filling missing training", () => {
  const input = week();
  const before = JSON.stringify(input);
  for (const horse of buildFormWeightsPrediction(input).predictions[0].horses) {
    const source = input.races[0].horses.find((item) => item.number === horse.number);
    const otherScores = Object.fromEntries(source.analysis.indexContributions.filter((row) => row.key !== "form").map((row) => [row.key, row.score]));
    assert.deepEqual(horse.unchangedScores, otherScores);
    assert.equal(horse.unchangedScores.course, 64);
    assert.equal(Object.hasOwn(horse.unchangedScores, "training"), false);
    assert.equal(horse.shadowRaw, calculateTmIndex({ ...otherScores, form: horse.shadowForm }, context));
    assert.equal(horse.shadowTm, Math.round(65 + (horse.shadowRaw - 65) * sampleFactor(source.pastRuns.length)));
  }
  assert.equal(JSON.stringify(input), before);
});

test("weight evidence is the exact denominator, limits each origin to five runs and preserves local blending", () => {
  const horse = makeHorse(1, 8);
  horse.pastRuns.push(...makeHorse(2, 7).pastRuns.map((run) => ({ ...run, course: "大井", finishPosition: 10 })));
  const evidence = buildRecentFormWeightEvidence(horse);
  for (const group of Object.values(evidence)) {
    assert.equal(group.count, 5);
    assert.ok(Math.abs(group.totalWeight - 4.2) < 1e-12);
    assert.deepEqual(group.runs.map((run) => run.weight), [1, 0.92, 0.84, 0.76, 0.6799999999999999]);
    assert.equal(group.normalizedAverage, group.runs.reduce((sum, run) => sum + run.weightedScore, 0) / group.totalWeight);
  }
  assert.equal(scoreRecentForm(horse, { normalizeWeights: true }), clamp(evidence.central.normalizedAverage * 0.85 + evidence.local.normalizedAverage * 0.15));
  assert.equal(scoreRecentForm(horse), clamp(evidence.central.legacyAverage * 0.85 + evidence.local.legacyAverage * 0.15));
  horse.pastRuns = horse.pastRuns.filter((run) => run.course === "大井");
  assert.equal(scoreRecentForm(horse, { normalizeWeights: true }), clamp(50 + (evidence.local.normalizedAverage - 50) * 0.35));
});

test("zero-run and one-run Form comparisons preserve fallback and experience correction", () => {
  const input = week();
  input.races[0].horses = [makeHorse(1, 0), makeHorse(2, 1)];
  const prediction = buildFormWeightsPrediction(input);
  for (const horse of prediction.predictions[0].horses) {
    assert.equal(horse.formDelta, 0);
    assert.equal(horse.tmDelta, 0);
  }
  assert.equal(prediction.predictions[0].horses[0].shadowForm, 50);
});

test("Form comparison refuses baseline drift, post-race evidence and wrong recency order", () => {
  const drift = week();
  drift.races[0].horses[0].tmIndex += 1;
  assert.throws(() => buildFormWeightsPrediction(drift), /Baseline replay/);
  const future = week();
  future.races[0].horses[0].pastRuns[0].date = future.meta.date;
  assert.throws(() => buildFormWeightsPrediction(future), /current or future/);
  const order = week();
  order.races[0].horses[0].pastRuns.reverse();
  assert.throws(() => buildFormWeightsPrediction(order), /newest first/);
  const sample = week();
  sample.races[0].horses[0].analysis.sampleAdjustment += 1;
  sample.races[0].horses[0].tmIndex += 1;
  assert.throws(() => buildFormWeightsPrediction(sample), /sample adjustment/);
});

test("Form freezes must be strictly pre-race and cannot masquerade as Course records", () => {
  assert.throws(() => buildFormWeightsArtifact(week(), { ...options, now: "2026-09-12T05:00:00Z" }), /already started/);
  const diagnostic = buildFormWeightsArtifact(week(), { ...options, prospective: false });
  assert.throws(() => validateFormWeightsArtifact(diagnostic), /Retrospective/);
  const frozen = buildFormWeightsArtifact(week(), options);
  validateFormWeightsArtifact(frozen);
  assert.equal(frozen.policy.courseChanged, false);
  assert.equal(frozen.policy.recencyWeightsChanged, false);
  assert.throws(() => validateCourseSurfaceArtifact(frozen), /version or policy/);
  frozen.predictions[0].horses[0].shadowTm += 1;
  assert.throws(() => validateFormWeightsArtifact(frozen), /hash mismatch/);
});

test("Form evaluation uses frozen leaders and requires matching identity and complete payouts", () => {
  const artifact = buildFormWeightsArtifact(week(), options);
  const results = resultsFor(artifact);
  const evaluated = evaluateFormWeightsArtifact(artifact, results);
  assert.equal(evaluated.summary.current.races, 1);
  assert.equal(evaluated.productionConnected, false);
  assert.equal(evaluated.adoptionDecision, "manual-review-required");
  for (const mode of ["current", "shadow"]) {
    const number = artifact.predictions[0][mode + "Leader"];
    assert.equal(evaluated.evaluated[0][mode].number, number);
    assert.equal(evaluated.summary[mode].winReturn, number === 1 ? 240 : 0);
    assert.equal(evaluated.summary[mode].placeHits, number === 1 ? 1 : 0);
  }
  for (const mutate of [
    (r) => { r.races[0].horses[0].horseName = "Wrong horse"; },
    (r) => { delete r.races[0].horses[0].placePayout; },
    (r) => { r.races[0].horses.pop(); },
    (r) => { r.races[0].horses[0].finishPosition = 0; },
  ]) {
    const incomplete = structuredClone(results);
    mutate(incomplete);
    const result = evaluateFormWeightsArtifact(artifact, incomplete);
    assert.equal(result.evaluated.length, 0);
    assert.equal(result.skipped.length, 1);
  }
  assert.throws(() => evaluateFormWeightsArtifact(artifact, { ...results, date: "2026-09-13" }), /date mismatch/);
});

test("policy and post-time checks still reject records with recomputed integrity hashes", () => {
  for (const mutate of [
    (a) => { a.policy.courseChanged = true; },
    (a) => { a.frozenAt = "2026-09-12T05:00:00Z"; },
  ]) {
    const artifact = buildFormWeightsArtifact(week(), options);
    mutate(artifact);
    const { predictionSha256, ...payload } = artifact;
    artifact.predictionSha256 = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    assert.throws(() => validateFormWeightsArtifact(artifact), /policy|strictly before/);
  }
});

test("saved field replays without mutation and report labels diagnostic evidence honestly", () => {
  const input = JSON.parse(readFileSync(new URL("../../week-data.json", import.meta.url), "utf8"));
  const before = JSON.stringify(input);
  const artifact = buildFormWeightsArtifact(input);
  assert.equal(artifact.predictions.flatMap((race) => race.horses).length, input.races.reduce((sum, race) => sum + race.horses.length, 0));
  assert.equal(JSON.stringify(input), before);
  assert.match(renderFormWeightsReport(artifact), /事前検証には数えない/);
  assert.match(renderFormWeightsReport(artifact), /本番未接続/);
});

test("weekly pipeline keeps Form-state and Form-weight comparisons separate", () => {
  const source = readFileSync(new URL("../../publish-race-batch.ps1", import.meta.url), "utf8");
  assert.match(source, /shadow:form:freeze -- --input tools\/week-data.next.json/);
  assert.match(source, /shadow:form-weights:freeze -- --input tools\/week-data.next.json/);
  assert.match(source, /git add \$FormWeightsShadow \$FormWeightsReport \$FormWeightsReportData/);
});

test("frozen files preserve the original time, reject changed inputs or models and never save retrospective runs", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "tm-form-freeze-"));
  t.after(() => {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
    rmSync(directory, { recursive: true, force: true });
  });
  const path = join(directory, "pre-race.json");
  const first = buildFormWeightsArtifact(week(), options);
  assert.deepEqual(preserveFrozenArtifact(path, first, validateFormWeightsArtifact), first);
  const originalBytes = readFileSync(path, "utf8");
  const later = buildFormWeightsArtifact(week(), { ...options, now: "2026-09-12T04:30:00Z" });
  assert.deepEqual(preserveFrozenArtifact(path, later, validateFormWeightsArtifact), first);
  const changedWeek = week();
  changedWeek.meta.note = "new data";
  for (const changed of [
    buildFormWeightsArtifact(changedWeek, options),
    buildFormWeightsArtifact(week(), { ...options, modelSha256: "b".repeat(64) }),
  ]) assert.throws(() => preserveFrozenArtifact(path, changed, validateFormWeightsArtifact), /existing record preserved/);
  assert.equal(readFileSync(path, "utf8"), originalBytes);
  const retrospectivePath = join(directory, "retrospective.json");
  const diagnostic = buildFormWeightsArtifact(week(), { ...options, prospective: false });
  assert.throws(() => preserveFrozenArtifact(retrospectivePath, diagnostic, validateFormWeightsArtifact), /Retrospective/);
  assert.equal(existsSync(retrospectivePath), false);
});
