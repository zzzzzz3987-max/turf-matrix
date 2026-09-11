import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { buildTrainingVideoDiagnosis } from "../training-video-diagnosis.mjs";

const require = createRequire(import.meta.url);
const oneWeek = require("../../../data/shadow/training-video-v2/2026-09-12-matenro-gale.json");
const final = require("../../../data/shadow/training-video-v2/2026-09-12-matenro-gale-final.json");
const horse = { horseName: "マテンロウゲイル", currentRace: { raceDate: "2026-09-12" } };
const options = { asOf: "2026-09-11T21:00:00+09:00" };
const profile = { sessions: [
  { date: "20260902", type: "wood", f4: 51.8, f3: 36.7, f1: 11.2 },
  { date: "20260909", type: "slope", f4: 53.9, f3: 40.3, f2: 26.3, f1: 13.2 },
] };
const diagnose = (records = [oneWeek, final], clocks = profile, opts = options) => buildTrainingVideoDiagnosis(horse, clocks, records, opts);

test("pilot joins both actual observations to the correct workout clocks without changing scores", () => {
  const result = diagnose();
  assert.equal(result.status, "provisional");
  assert.equal(result.clips.length, 2);
  assert.ok(result.clips.every((clip) => clip.clock.status === "matched"));
  assert.deepEqual(result.supportedDimensions, ["relativePosition", "straightness"]);
  assert.equal(result.productionEligible, false);
  assert.equal(result.scoreAdjustment, 0);
  assert.ok(result.summary.includes("一週前"));
  assert.ok(result.summary.includes("最終"));
});

test("different course and going, and unknown effort, prevent a raw clock trend", () => {
  const comparison = diagnose().phaseComparison;
  assert.equal(comparison.clockDelta, null);
  assert.equal(comparison.trend, "not_established");
  assert.equal(comparison.reasons.length, 3);
});

test("even matching recorded conditions only permit clock deltas, never a fitness conclusion", () => {
  const a = structuredClone(oneWeek);
  const b = structuredClone(final);
  a.context.effort = "documented_same_effort";
  b.context = { ...a.context };
  const clocks = structuredClone(profile);
  clocks.sessions[1].type = "wood";
  const comparison = diagnose([a, b], clocks).phaseComparison;
  assert.equal(comparison.status, "clock_comparison_only");
  assert.deepEqual(comparison.clockDelta, { f4: 2.1, f1: 2 });
  assert.equal(comparison.trend, "not_established");
});

test("clock conflict blocks the affected clip and does not borrow another day's clock", () => {
  const clocks = structuredClone(profile);
  clocks.sessions[0].f1 = 12;
  const result = diagnose([oneWeek], clocks);
  assert.equal(result.status, "needs_review");
  assert.equal(result.clips.length, 0);
  assert.equal(result.excluded[0].reason, "clock_values_disagree");
  assert.equal(diagnose([oneWeek], { sessions: [profile.sessions[1]] }).clips[0].clock.status, "unmatched");
});

test("future observations and race-day retrospective observations are excluded", () => {
  assert.equal(diagnose([oneWeek], profile, { asOf: "2026-09-10T12:00:00Z" }).clips.length, 0);
  const late = { ...oneWeek, observedAt: "2026-09-12T01:00:00+09:00" };
  const result = diagnose([oneWeek, late], profile, { asOf: "2026-09-13T00:00:00Z" });
  assert.equal(result.clips.length, 1);
  assert.equal(result.excluded[0].reason, "observation_not_available_before_cutoff");
});

test("horse, race date and phase must match", () => {
  assert.equal(diagnose([{ ...oneWeek, horseName: "OTHER" }]).status, "not_reviewed");
  assert.equal(diagnose([{ ...oneWeek, raceDate: "2026-09-13" }]).status, "not_reviewed");
  assert.equal(diagnose([{ ...oneWeek, phase: "final" }]).excluded[0].reason, "phase_date_mismatch");
});

test("identical records deduplicate; conflicting versions cannot inflate coverage", () => {
  assert.equal(diagnose([oneWeek, structuredClone(oneWeek)]).clips.length, 1);
  const other = structuredClone(oneWeek);
  other.findings[0].code = "relative_loss";
  const result = diagnose([oneWeek, other]);
  assert.equal(result.clips.length, 0);
  assert.ok(result.excluded.every((item) => item.reason === "conflicting_review_versions"));
});

test("missing clocks remain explicit even when a visual observation exists", () => {
  const result = diagnose([oneWeek], { sessions: [] });
  assert.equal(result.status, "needs_review");
  assert.equal(result.clips[0].findings.length, 1);
  assert.equal(result.clips[0].clock.status, "unmatched");
  assert.equal(result.scoreAdjustment, 0);
});

test("timestamps require timezone and valid calendar dates", () => {
  for (const asOf of [undefined, "2026-09-11", "2026-09-11T12:00:00", "2026-09-31T12:00:00Z", "bad"]) {
    assert.throws(() => diagnose([], profile, { asOf }), /timezone-aware/);
  }
});

test("every recorded intermediate split is checked, not only 4F and 1F", () => {
  for (const field of ["f3", "f2"]) {
    const clocks = structuredClone(profile);
    clocks.sessions[1][field] += 0.2;
    assert.equal(diagnose([final], clocks).excluded[0].reason, "clock_values_disagree");
    delete clocks.sessions[1][field];
    assert.equal(diagnose([final], clocks).clips[0].clock.reason, "clock_splits_missing");
  }
  assert.deepEqual(diagnose([final]).clips[0].clock.checkedSplits, ["4F", "3F", "2F", "1F"]);
});

test("invalid optional splits cannot silently pass the clock join", () => {
  for (const value of [null, "40.3", -1, 0]) {
    const review = structuredClone(final);
    review.overlay.times["3F"] = value;
    assert.equal(diagnose([review]).clips[0].clock.reason, "overlay_clocks_invalid");
  }
});

test("ambiguous observed footage keeps its caution notes without producing a finding", () => {
  const review = require("../../../data/shadow/training-video-v2/2026-09-12-filius-final.json");
  const result = buildTrainingVideoDiagnosis(
    { ...horse, horseName: review.horseName },
    { sessions: [{ date: "20260909", type: "wood", f4: 52.5, f3: 38.2, f1: 11.5 }] },
    [review], { asOf: "2026-09-11T13:00:00Z" });
  assert.equal(result.status, "needs_review");
  assert.equal(result.clips[0].clock.status, "matched");
  assert.equal(result.clips[0].findings.length, 0);
  assert.ok(result.clips[0].reviewNotes[0].includes("重なる"));
  assert.equal(result.scoreAdjustment, 0);
  assert.ok(result.summary.includes("観察記録はある"));
});

test("new runner observations join same-day clocks but never approve a production bonus", () => {
  for (const slug of ["gaia-mente", "gt-adaman", "gran-vinos"]) {
    const review = require(`../../../data/shadow/training-video-v2/2026-09-12-${slug}-final.json`);
    const times = review.overlay.times;
    const clocks = { sessions: [{ date: "20260909", type: "wood", f4: times["4F"], f3: times["3F"], f1: times["1F"] }] };
    const result = buildTrainingVideoDiagnosis({ ...horse, horseName: review.horseName }, clocks, [review],
      { asOf: "2026-09-11T13:00:00Z" });
    assert.equal(result.status, "provisional");
    assert.deepEqual(result.supportedDimensions, ["relativePosition"]);
    assert.equal(result.productionEligible, false);
    assert.equal(result.scoreAdjustment, 0);
    assert.equal(result.clips[0].independentReview, "pending");
  }
});

test("diagnosis is deterministic and does not mutate the clocks or observations", () => {
  const snapshot = JSON.stringify([horse, profile, oneWeek, final]);
  assert.deepEqual(diagnose(), diagnose());
  assert.equal(JSON.stringify([horse, profile, oneWeek, final]), snapshot);
});
