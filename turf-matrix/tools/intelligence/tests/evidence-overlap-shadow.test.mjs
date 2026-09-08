import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { makeWeek } from "./fixtures/overlap-week.mjs";
import { diagnoseEvidenceOverlap } from "../../analyze/lib/evidence-overlap.mjs";
import { preserveFrozenArtifact } from "../../analyze/lib/factor-shadow-cli.mjs";
import { OVERLAP_VARIANTS, buildOverlapShadowArtifact, validateOverlapShadowArtifact,
  evaluateOverlapShadowArtifact, aggregateOverlapEvaluations } from "../../analyze/lib/evidence-overlap-shadow.mjs";
import { renderOverlapEvaluationReport, renderOverlapShadowReport } from "../../analyze/evidence-overlap-shadow.mjs";

const options = { prospective: true, now: "2026-09-12T04:00:00Z", modelSha256: "a".repeat(64) };
const rehash = (record, key = "predictionSha256") => {
  const { [key]: removed, ...payload } = record;
  return { ...payload, [key]: createHash("sha256").update(JSON.stringify(payload)).digest("hex") };
};
const resultsFor = (artifact) => ({ date: artifact.raceDate, races: artifact.predictions.map((race) => ({
  bundleId: race.raceId, horses: race.horses.map((horse, i) => ({
    horseNumber: horse.number, horseName: horse.name, finishPosition: i + 1,
    winPayout: i === 0 ? 250 : 0, placePayout: i === 0 ? 130 : 0,
  })),
})) });

test("all three predictions freeze together and match the diagnostic without changing inputs", () => {
  const input = makeWeek();
  const before = JSON.stringify(input);
  const frozen = buildOverlapShadowArtifact(input, options);
  const diagnostic = diagnoseEvidenceOverlap(input);
  validateOverlapShadowArtifact(frozen);
  assert.deepEqual(frozen.predictions[0].horses, diagnostic.races[0].horses);
  assert.equal(frozen.policy.primaryVariant, "both");
  assert.deepEqual(frozen.policy.secondaryVariants, ["abilityOnly", "formOnly"]);
  assert.equal(frozen.policy.formNormalizationApplied, false);
  assert.equal(frozen.productionConnected, false);
  assert.equal(JSON.stringify(input), before);
  assert.match(renderOverlapShadowReport(frozen), /発走前固定済み/);
});

test("post-time, missing conditions, diagnostics and modified frozen records cannot enter evaluation", () => {
  assert.throws(() => buildOverlapShadowArtifact(makeWeek(), { ...options, now: "2026-09-12T05:00:00Z" }), /already started/);
  const noTime = makeWeek();
  delete noTime.races[0].time;
  assert.throws(() => buildOverlapShadowArtifact(noTime, options), /post time/);
  const wrongDistance = makeWeek();
  wrongDistance.races[0].distance = 1600;
  assert.throws(() => buildOverlapShadowArtifact(wrongDistance, options), /conditions differ/);
  const diagnostic = buildOverlapShadowArtifact(makeWeek(), { ...options, prospective: false });
  assert.throws(() => evaluateOverlapShadowArtifact(diagnostic, resultsFor(diagnostic)), /Retrospective/);
  const changed = buildOverlapShadowArtifact(makeWeek(), options);
  changed.predictions[0].horses[0].candidates.both.tm++;
  assert.throws(() => validateOverlapShadowArtifact(changed), /hash mismatch/);
});

test("recomputed hashes cannot bypass frozen-time, primary-variant, identity and ranking rules", () => {
  for (const mutate of [
    (a) => { a.frozenAt = "2026-09-12T05:00:00Z"; },
    (a) => { a.policy.primaryVariant = "formOnly"; },
    (a) => { a.predictions.push(a.predictions[0]); },
    (a) => { a.predictions[0].horses[1].number = 1; },
    (a) => { delete a.predictions[0].horses[0].candidates.formOnly; },
    (a) => { a.predictions[0].comparisons.both.candidateLeader = 99; },
  ]) {
    const artifact = buildOverlapShadowArtifact(makeWeek(), options);
    mutate(artifact);
    assert.throws(() => validateOverlapShadowArtifact(rehash(artifact)), /before the race|policy|identity|horse|variants|ranking/);
  }
});

test("frozen leaders are evaluated at 100 yen per bet type with actual place payouts", () => {
  const frozen = buildOverlapShadowArtifact(makeWeek(), options);
  const before = JSON.stringify(frozen);
  const evaluation = evaluateOverlapShadowArtifact(frozen, resultsFor(frozen));
  for (const key of OVERLAP_VARIANTS) {
    const v = evaluation.variants[key];
    for (const mode of ["current", "shadow"]) {
      const pick = frozen.predictions[0].comparisons[key][mode === "current" ? "currentLeader" : "candidateLeader"];
      const s = v.summary[mode];
      assert.equal(s.races, 1);
      assert.equal(s.stakePerBetType, 100);
      assert.equal(s.winReturn, pick === 1 ? 250 : 0);
      assert.equal(s.winRoiPercent, pick === 1 ? 250 : 0);
      assert.equal(s.placeRoiPercent, pick === 1 ? 130 : 0);
      assert.equal(s.placeHits, pick === 1 ? 1 : 0);
    }
    assert.equal(v.changedLeaders.current.races, frozen.predictions[0].comparisons[key].leaderChanged ? 1 : 0);
  }
  assert.equal(evaluation.adoptionDecision, "manual-review-required");
  assert.equal(JSON.stringify(frozen), before);
  assert.match(renderOverlapEvaluationReport(evaluation), /100円均等/);
});

test("missing, mismatched, duplicate and unfinished results exclude the same race for every variant", () => {
  const frozen = buildOverlapShadowArtifact(makeWeek(), options);
  for (const mutate of [
    (r) => { r.races[0].horses[0].horseName = "Wrong horse"; },
    (r) => { r.races[0].horses.pop(); },
    (r) => { delete r.races[0].horses[0].placePayout; },
    (r) => { r.races[0].horses[0].finishPosition = 0; },
    (r) => { r.races.push(r.races[0]); },
    (r) => { r.races[0].horses.push(r.races[0].horses[0]); },
  ]) {
    const results = resultsFor(frozen);
    mutate(results);
    const evaluation = evaluateOverlapShadowArtifact(frozen, results);
    for (const key of OVERLAP_VARIANTS) {
      assert.equal(evaluation.variants[key].evaluated.length, 0);
      assert.equal(evaluation.variants[key].skipped.length, 1);
      assert.equal(evaluation.variants[key].summary.shadow.winRoiPercent, null);
    }
  }
  assert.throws(() => evaluateOverlapShadowArtifact(frozen, { ...resultsFor(frozen), date: "2026-09-13" }), /date mismatch/);
});

test("cumulative evaluation deduplicates exact repeats, rejects conflicts and isolates model versions", () => {
  const first = buildOverlapShadowArtifact(makeWeek(), options);
  const a = evaluateOverlapShadowArtifact(first, resultsFor(first));
  const dedup = aggregateOverlapEvaluations([a, a]);
  assert.equal(dedup.groups.length, 1);
  assert.deepEqual(dedup.groups[0].dates, [a.raceDate]);
  assert.equal(dedup.groups[0].variants.both.summary.current.races, 1);
  const changedResults = resultsFor(first);
  changedResults.races[0].horses[0].winPayout++;
  const changed = evaluateOverlapShadowArtifact(first, changedResults);
  assert.throws(() => aggregateOverlapEvaluations([a, changed]), /Conflicting/);
  const next = makeWeek();
  next.meta.date = "2026-09-13";
  for (const horse of next.races[0].horses) horse.currentRace.raceDate = next.meta.date;
  const second = buildOverlapShadowArtifact(next, { ...options, modelSha256: "b".repeat(64) });
  const b = evaluateOverlapShadowArtifact(second, resultsFor(second));
  assert.equal(aggregateOverlapEvaluations([a, b]).groups.length, 2);
  a.variants.both.evaluated[0].current.winReturn = 999;
  assert.throws(() => aggregateOverlapEvaluations([a]), /integrity/);
  assert.deepEqual(aggregateOverlapEvaluations([]).groups, []);
});

test("repeat freezes preserve original bytes and cannot overwrite a changed input or model", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "tm-overlap-freeze-"));
  t.after(() => {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
    rmSync(directory, { recursive: true, force: true });
  });
  const path = join(directory, "pre-race.json");
  const first = buildOverlapShadowArtifact(makeWeek(), options);
  preserveFrozenArtifact(path, first, validateOverlapShadowArtifact);
  const bytes = readFileSync(path, "utf8");
  const later = buildOverlapShadowArtifact(makeWeek(), { ...options, now: "2026-09-12T04:30:00Z" });
  assert.equal(preserveFrozenArtifact(path, later, validateOverlapShadowArtifact).frozenAt, first.frozenAt);
  const input = makeWeek();
  input.meta.changed = true;
  assert.throws(() => preserveFrozenArtifact(path, buildOverlapShadowArtifact(input, options), validateOverlapShadowArtifact), /existing record preserved/);
  const newModel = buildOverlapShadowArtifact(makeWeek(), { ...options, modelSha256: "b".repeat(64) });
  assert.throws(() => preserveFrozenArtifact(path, newModel, validateOverlapShadowArtifact), /existing record preserved/);
  assert.equal(readFileSync(path, "utf8"), bytes);
  const diagnosticPath = join(directory, "diagnostic.json");
  const diagnostic = buildOverlapShadowArtifact(makeWeek(), { ...options, prospective: false });
  assert.throws(() => preserveFrozenArtifact(diagnosticPath, diagnostic, validateOverlapShadowArtifact), /Retrospective/);
  assert.equal(existsSync(diagnosticPath), false);
});

test("weekly pipeline freezes and stages overlap without replacing existing candidates", () => {
  const script = readFileSync(new URL("../../publish-race-batch.ps1", import.meta.url), "utf8");
  assert.match(script, /shadow:overlap:freeze -- --input tools\/week-data.next.json/);
  assert.match(script, /git add \$OverlapShadow \$OverlapReport \$OverlapReportData/);
  assert.match(script, /shadow:form-weights:freeze/);
  assert.match(script, /shadow:course:freeze/);
});
