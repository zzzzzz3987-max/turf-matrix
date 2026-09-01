import test from "node:test";
import assert from "node:assert/strict";
import { evaluateGradedRaceReadiness, summarizeGradedRaceReadiness } from "../graded-race-readiness.mjs";

const horse = (name = "テストホース") => ({
  name,
  number: 1,
  odds: 4.2,
  popularity: 2,
  pedigree: { ancestors: Array.from({ length: 30 }, (_, index) => ({ name: `祖先${index}` })) },
  analysis: {
    status: "tm-index-v1.7",
    factorsDetail: {
      blood: { score: 72, status: "active", evidenceV2: [{ sample: 20 }] },
      training: { score: 74, status: "active", goodRunComparison: { status: "active" }, videoReview: { note: "確認済み" } },
      load: { status: "active" },
      pace: { status: "active" },
    },
  },
});

const race = (overrides = {}) => ({
  id: "2026-09-06-中山-11R",
  track: "中山",
  number: 11,
  name: "テスト重賞",
  grade: "G3",
  weather: "晴",
  going: "良",
  trackBias: { status: "active" },
  horses: [horse()],
  ...overrides,
});

test("a complete graded race is ready for publication", () => {
  const result = summarizeGradedRaceReadiness(race(), { stage: "publish" });
  assert.equal(result.status, "ready");
  assert.equal(result.metrics.videoReviewed, 1);
  assert.equal(result.metrics.bloodStatEvidence, 1);
});

test("odds and conditions are warnings during analysis but blockers at publication", () => {
  const incomplete = race({ weather: null, going: null, horses: [{ ...horse(), odds: null, popularity: null }] });
  assert.equal(summarizeGradedRaceReadiness(incomplete, { stage: "analysis" }).status, "conditional");
  const publish = summarizeGradedRaceReadiness(incomplete, { stage: "publish" });
  assert.equal(publish.status, "blocked");
  assert.deepEqual(publish.issues.filter((item) => item.severity === "blocker").map((item) => item.key), ["odds", "weather", "going"]);
});

test("three-generation pedigrees remain usable but are reported as partial", () => {
  const partial = horse("血統一部取得馬");
  partial.pedigree.ancestors = partial.pedigree.ancestors.slice(0, 14);
  const result = summarizeGradedRaceReadiness(race({ horses: [partial] }));
  assert.equal(result.status, "conditional");
  assert.deepEqual(result.issues.find((item) => item.key === "pedigree4")?.horses, ["血統一部取得馬"]);
});

test("only graded races are included in the weekly readiness summary", () => {
  const result = evaluateGradedRaceReadiness({ races: [race(), { ...race(), id: "special", grade: null }] }, { stage: "publish" });
  assert.equal(result.raceCount, 1);
  assert.equal(result.status, "ready");
});
