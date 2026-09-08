import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { scoreCourse } from "../course-ai.mjs";
import { buildIndexContributions, calculateTmIndex } from "../tm-index-engine.mjs";
import { buildCourseSurfaceArtifact, buildCourseSurfacePrediction, evaluateCourseSurfaceArtifact, validateCourseSurfaceArtifact } from "../../analyze/lib/course-surface-shadow.mjs";

const context = { category: "special", surface: "芝" };
const makeHorse = (number, count = 3) => {
  const horse = {
    number, name: "Horse" + number,
    currentRace: { raceDate: "2026-09-12", course: "中山", surface: "芝", distance: 1800 },
    pastRuns: Array.from({ length: count }, (_, i) => ({
      date: "2026-08-" + String(20 - i).padStart(2, "0"),
      course: "中山", surface: i === 0 ? "芝" : "ダ",
      fieldSize: 12, finishPosition: i === 0 ? 8 : 1, margin: i === 0 ? 1 : 0,
    })),
  };
  const scores = { ability: 72, form: 65, course: scoreCourse(horse), distance: 70, blood: 68, pace: 70 };
  const raw = calculateTmIndex(scores, context);
  const adjusted = Math.round(65 + (raw - 65) * (count === 0 ? 0.3 : count === 1 ? 0.5 : count === 2 ? 0.7 : 1));
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

test("course-only prediction preserves inputs and every non-course factor, including missing training", () => {
  const input = week();
  const before = JSON.stringify(input);
  const prediction = buildCourseSurfacePrediction(input).predictions[0];
  for (const horse of prediction.horses) {
    assert.equal(horse.unchangedScores.form, 65);
    assert.equal(Object.hasOwn(horse.unchangedScores, "training"), false);
    assert.equal(horse.shadowRaw, calculateTmIndex({ ...horse.unchangedScores, course: horse.shadowCourse }, context));
    const count = input.races[0].horses.find((h) => h.number === horse.number).pastRuns.length;
    assert.equal(horse.shadowTm, Math.round(65 + (horse.shadowRaw - 65) * (count === 2 ? 0.7 : 1)));
    assert.ok(horse.shadowCourse < horse.currentCourse);
  }
  assert.equal(JSON.stringify(input), before);
});

test("baseline mismatch, future past runs and inconsistent conditions refuse comparison", () => {
  const input = week();
  input.races[0].horses[0].tmIndex += 1;
  assert.throws(() => buildCourseSurfacePrediction(input), /Baseline replay/);
  const future = week();
  future.races[0].horses[0].pastRuns[0].date = "2026-09-12";
  assert.throws(() => buildCourseSurfacePrediction(future), /current or future/);
  const mismatch = week();
  mismatch.races[0].horses[0].currentRace.surface = "ダ";
  assert.throws(() => buildCourseSurfacePrediction(mismatch), /conditions differ/);
});

test("freeze rejects post-time and retrospective artifacts cannot count as prospective", () => {
  assert.throws(() => buildCourseSurfaceArtifact(week(), { ...options, now: "2026-09-12T05:00:00Z" }), /already started/);
  const diagnostic = buildCourseSurfaceArtifact(week(), { ...options, prospective: false });
  assert.throws(() => validateCourseSurfaceArtifact(diagnostic), /Retrospective/);
  const frozen = buildCourseSurfaceArtifact(week(), options);
  validateCourseSurfaceArtifact(frozen);
  frozen.frozenAt = "2026-09-11T00:00:00Z";
  assert.throws(() => validateCourseSurfaceArtifact(frozen), /hash mismatch/);
});

test("evaluation joins exact identities and never substitutes a missing leader", () => {
  const artifact = buildCourseSurfaceArtifact(week(), options);
  const results = resultsFor(artifact);
  const evaluation = evaluateCourseSurfaceArtifact(artifact, results);
  assert.equal(evaluation.evaluated.length, 1);
  assert.equal(evaluation.adoptionDecision, "manual-review-required");
  results.races[0].horses[0].horseName = "Other horse";
  assert.equal(evaluateCourseSurfaceArtifact(artifact, results).evaluated.length, 0);
  assert.equal(evaluateCourseSurfaceArtifact(artifact, results).skipped.length, 1);
  results.date = "2026-09-13";
  assert.throws(() => evaluateCourseSurfaceArtifact(artifact, results), /date mismatch/);
});

test("missing payout is not a losing bet and place hits use actual payout", () => {
  const artifact = buildCourseSurfaceArtifact(week(), options);
  const results = resultsFor(artifact);
  const result = evaluateCourseSurfaceArtifact(artifact, results);
  const pick = artifact.predictions[0].currentLeader;
  assert.equal(result.summary.current.placeHits, pick === 1 ? 1 : 0);
  delete results.races[0].horses[0].placePayout;
  assert.equal(evaluateCourseSurfaceArtifact(artifact, results).evaluated.length, 0);
});

test("current saved field replays fully without changing published data", () => {
  const input = JSON.parse(readFileSync(new URL("../../week-data.json", import.meta.url), "utf8"));
  const before = JSON.stringify(input);
  const prediction = buildCourseSurfacePrediction(input);
  assert.equal(prediction.predictions.flatMap((race) => race.horses).length,
    input.races.reduce((sum, race) => sum + race.horses.length, 0));
  assert.equal(JSON.stringify(input), before);
});

test("weekly publish is wired to freeze and stage the course-only comparison", () => {
  const source = readFileSync(new URL("../../publish-race-batch.ps1", import.meta.url), "utf8");
  assert.match(source, /shadow:course:freeze -- --input tools\/week-data.next.json/);
  assert.match(source, /git add \$CourseShadow \$CourseReport \$CourseReportData/);
});
