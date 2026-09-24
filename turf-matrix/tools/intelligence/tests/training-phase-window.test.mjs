import assert from "node:assert/strict";
import test from "node:test";
import { buildTrainingProfile, buildTrainingAnalysis } from "../training-ai.mjs";

const session = (date, f4 = 52, f1 = 12) => ({ date, "4F": f4, "1F": f1,
  lap: { lap2: f1 + 0.3, lap1: f1 } });
const horse = (raceDate, slope) => ({ horseName: "PHASE_TEST", currentRace: { raceDate, stableSide: "栗東" },
  pastRuns: [], training: { slope, wood: [] } });

test("Wednesday workout stays in final preparation for weekend and substitute meetings", () => {
  for (const raceDate of ["2026-09-19", "2026-09-20", "2026-09-21", "2026-09-22"]) {
    const result = buildTrainingProfile(horse(raceDate, [session("20260916"), session("20260909")]));
    assert.equal(result.phaseRepresentatives.final.date, "20260916");
    assert.equal(result.phaseRepresentatives.oneWeek.date, "20260909");
    assert.equal(result.phasePolicy, "weekend-aligned-v2");
  }
});
test("a later slow clock does not displace the stronger final preparation on Monday", () => {
  const input = horse("2026-09-21", [session("20260916"), session("20260920", 66, 16)]);
  const before = structuredClone(input);
  const fixed = buildTrainingAnalysis(input);
  const legacy = buildTrainingAnalysis(input, { phasePolicy: "legacy-four-day" });
  assert.equal(fixed.final.date, "20260916");
  assert.equal(legacy.final.date, "20260920");
  assert.ok(fixed.score > legacy.score);
  assert.deepEqual(input, before);
});
test("Tuesday phase boundaries are disjoint at days 6, 7, 14 and 15", () => {
  const profile = buildTrainingProfile(horse("2026-09-22", [session("20260916"), session("20260915"),
    session("20260908"), session("20260907")]));
  assert.deepEqual(profile.sessions.map(({ daysBeforeRace, phase }) => [daysBeforeRace, phase]),
    [[6, "final"], [7, "oneWeek"], [14, "oneWeek"], [15, "intermediate"]]);
});
test("ordinary weekend preparation produces identical components and scores", () => {
  for (const date of ["2026-09-19", "2026-09-20"]) {
    const input = horse(date, [session("20260916"), session("20260913", 50, 11.5), session("20260909")]);
    const fixed = buildTrainingProfile(input);
    const legacy = buildTrainingProfile(input, { phasePolicy: "legacy-four-day" });
    assert.equal(fixed.score, legacy.score);
    assert.deepEqual(fixed.phaseRepresentatives, legacy.phaseRepresentatives);
    assert.deepEqual(fixed.components, legacy.components);
  }
});
test("race-day, future, unknown and impossible dates cannot affect scores or volume", () => {
  const good = session("20260916");
  const control = buildTrainingProfile(horse("2026-09-22", [good]));
  const invalid = ["20260922", "20260923", "20260230", "20260900", "unknown", null];
  const result = buildTrainingProfile(horse("2026-09-22", [good, ...invalid.map((date) => session(date, 47, 10))]));
  assert.equal(result.score, control.score);
  assert.equal(result.sessions.length, 1);
  assert.deepEqual(result.recentCounts, control.recentCounts);
  assert.equal(buildTrainingProfile(horse("invalid", [good])).status, "missing");
});
test("good-run comparison uses the same meeting-aligned window and excludes current/future races", () => {
  const input = horse("2026-09-21", [session("20260916"), session("20260812")]);
  input.pastRuns = [{ date: "2026-08-17", finishPosition: 2 }, { date: "2026-09-21", finishPosition: 1 },
    { date: "2026-09-22", finishPosition: 1 }];
  const profile = buildTrainingProfile(input);
  assert.equal(profile.goodRunComparison.sampleSize, 1);
  assert.equal(profile.goodRunComparison.baselines[0].sessions[0].phase, "final");
  assert.equal(profile.goodRunComparison.delta, 0);
});
test("short turnaround remains excluded from scoring and unknown policies fail closed", () => {
  const input = horse("2026-09-21", [session("20260916")]);
  input.pastRuns = [{ date: "2026-09-14", finishPosition: 2 }];
  assert.equal(buildTrainingAnalysis(input).indexEligible, false);
  assert.equal(buildTrainingAnalysis(input).score, null);
  assert.throws(() => buildTrainingProfile(input, { phasePolicy: "typo" }), /Unknown training phase policy/);
});
