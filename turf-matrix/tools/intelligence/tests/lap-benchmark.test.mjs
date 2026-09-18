import test from "node:test";
import assert from "node:assert/strict";
import { buildLapBenchmark } from "../lap-benchmark.mjs";

const race = (key, overrides = {}) => ({ key, date: "2026-08-01", course: "hanshin", distance: 2000,
  trackCode: "17", turfConditionCode: "1", dirtConditionCode: "0",
  pace: { classification: "back_loaded" }, lapProfile: { scope: "race", last5F: 60 }, ...overrides });
const target = race("target", { lapProfile: { scope: "race", last5F: 58 } });
const peers = () => Array.from({ length: 20 }, (_, i) => race(`peer-${i}`));
const evaluate = (races, cutoff = "2026-09-01") => buildLapBenchmark(target, { races }, cutoff);

test("compares matched race sectionals without adding points", () => {
  assert.deepEqual(evaluate(peers()), { status: "available", sampleSize: 20,
    medianLast5F: 60, fasterThanMedianSeconds: 2, fasterPercentile: 100, scoreAdjustment: 0 });
});
test("does not mix course distance layout going or pace", () => {
  for (const change of [{ course: "tokyo" }, { distance: 1800 }, { trackCode: "18" },
    { turfConditionCode: "2" }, { pace: { classification: "front_loaded" } }]) {
    assert.equal(evaluate(peers().map(r => ({ ...r, ...change }))).sampleSize, 0);
  }
});
test("excludes current/future results, self and duplicate race keys", () => {
  const baseline = evaluate(peers());
  assert.deepEqual(evaluate([...peers(), ...peers(), target, race("today", { date: "2026-09-01" }),
    race("future", { date: "2026-09-02" }), race("undated", { date: null })]), baseline);
  assert.equal(evaluate(peers(), "2026-08-01").status, "missing");
});
test("small cohorts and missing context never produce a percentile", () => {
  assert.equal(evaluate(peers().slice(1)).fasterPercentile, null);
  for (const change of [{ trackCode: "52" }, { turfConditionCode: "0" }, { distance: null }, { date: null }]) {
    assert.equal(buildLapBenchmark({ ...target, ...change }, { races: peers() }, "2026-09-01").status, "missing");
  }
});
test("ties use midrank and input order does not affect comparisons", () => {
  const equal = peers().map(r => ({ ...r, lapProfile: { scope: "race", last5F: 58 } }));
  assert.equal(evaluate(equal).fasterPercentile, 50);
  assert.deepEqual(evaluate(equal), evaluate(equal.reverse()));
});
