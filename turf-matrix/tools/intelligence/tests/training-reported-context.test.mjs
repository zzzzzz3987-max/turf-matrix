import test from "node:test";
import assert from "node:assert/strict";
import { reportedTrainingContext } from "../training-reported-context.mjs";
import { buildTrainingAnalysis } from "../training-ai.mjs";

const horse = {
  horseName: "マテンロウゲイル",
  currentRace: { raceDate: "2026-09-12", stableSide: "栗東" },
  training: { wood: [{ date: "20260902", course: "C", times: { "4F": 51.8, "1F": 11.2 }, lap: { lap2: 11.7, lap1: 11.2 } }] },
};

test("reported context matches horse, race and a recorded training session", () => {
  const result = reportedTrainingContext(horse);
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, "reported");
  assert.equal(result[0].sources.length, 2);
  assert.match(result[0].summary, /一杯/);
  assert.deepEqual(reportedTrainingContext({ ...horse, horseName: "別馬" }), []);
  assert.deepEqual(reportedTrainingContext({ ...horse, training: {} }), []);
  assert.deepEqual(reportedTrainingContext({ ...horse, currentRace: { raceDate: "2026-09-13" } }), []);
});

test("unverified, unsourced and future-dated reports stay out", () => {
  const record = { ...reportedTrainingContext(horse)[0], status: "verified", raceDate: "2026-09-12", horseName: horse.horseName };
  for (const change of [
    { status: "pending" }, { sources: [] }, { kind: "video" },
    { trainingDate: "2026-09-13" }, { trainingDate: "2026-02-30" },
    { sources: [{ ...record.sources[0], publishedDate: "2026-09-12" }] },
    { sources: [{ ...record.sources[0], publishedDate: "2026-09-01" }] },
  ]) assert.deepEqual(reportedTrainingContext(horse, [{ ...record, ...change }]), []);
});

test("reported context changes explanation, not scores, confidence or video status", () => {
  const withReport = buildTrainingAnalysis(horse);
  const withoutReport = buildTrainingAnalysis({ ...horse, horseName: "比較用の別馬" });
  assert.match(withReport.summary, /報道による補足/);
  assert.doesNotMatch(withoutReport.summary, /報道による補足/);
  for (const key of ["score", "clockScore", "lapScore", "confidence", "status", "grade", "videoReview"])
    assert.deepEqual(withReport[key], withoutReport[key], key);
});
