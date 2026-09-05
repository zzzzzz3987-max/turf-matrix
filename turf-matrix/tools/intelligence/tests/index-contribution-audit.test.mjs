import assert from "node:assert/strict";
import test from "node:test";
import { traceIndex, tracePair } from "../../analyze/audit-index-contributions.mjs";

const horse = (overrides = {}) => ({
  name: "fixture", tmIndex: 79,
  analysis: {
    indexContributions: [{ key: "ability", score: 70, weight: 0.3 }, { key: "form", score: 70, weight: 0.2 }],
    rawTmIndex: 78, sampleAdjustment: 0, goingAdjustment: 0,
    loadAdjustment: 1, trackBiasAdjustment: 0, ...overrides,
  },
});

test("audit normalizes contributions by available weight, not by one", () => {
  const trace = traceIndex(horse(), {});
  assert.equal(trace.factors.ability, 42);
  assert.equal(trace.factors.form, 28);
  assert.equal(trace.raw, 78);
  assert.equal(trace.final, 79);
  assert.equal(trace.finalMatches, true);
});

test("audit pair attributes final gap including rounding and clipping", () => {
  const a = horse({ loadAdjustment: 20 });
  a.tmIndex = 92;
  const b = horse({ sampleAdjustment: -7, goingAdjustment: -1 });
  b.tmIndex = 71;
  const pair = tracePair(a, b, {});
  assert.equal(pair.leader.finalClip, -6);
  assert.ok(Math.abs(pair.reconstructedGap - pair.gap) < 1e-10);
});

test("audit refuses absent correction fields instead of assuming neutral", () => {
  const value = horse();
  delete value.analysis.loadAdjustment;
  assert.throws(() => traceIndex(value, {}), /Missing loadAdjustment/);
});

test("audit exposes inconsistent saved index", () => {
  const value = horse();
  value.tmIndex = 80;
  assert.equal(traceIndex(value, {}).finalMatches, false);
});
