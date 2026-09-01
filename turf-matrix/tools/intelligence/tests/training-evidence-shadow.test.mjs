import assert from "node:assert/strict";
import test from "node:test";
import { buildTrainingEvidenceShadow, empiricalSessionScore, oneWeekPrimaryBase, qualityOnlyBase } from "../training-evidence-shadow.mjs";

const profile = (overrides = {}) => ({
  score: 72,
  baseScore: 70,
  status: "active",
  sessions: [{ score: 75 }],
  phaseRepresentatives: {
    final: { score: 68 },
    oneWeek: { score: 82 },
  },
  components: {
    phaseQuality: 74,
    recentBest: 82,
    consistency: 70,
    volume: 78,
    freshness: 84,
  },
  ...overrides,
});

test("quality-only candidate does not use volume or freshness as performance points", () => {
  const original = profile();
  const changed = profile({
    components: { ...original.components, volume: 45, freshness: 44 },
  });
  assert.equal(qualityOnlyBase(original), qualityOnlyBase(changed));
});

test("one-week-primary candidate gives the main phase weight to one-week work", () => {
  const strongOneWeek = oneWeekPrimaryBase(profile());
  const weakOneWeek = oneWeekPrimaryBase(profile({
    phaseRepresentatives: { final: { score: 68 }, oneWeek: { score: 60 } },
  }));
  assert.ok(strongOneWeek > weakOneWeek);
});

test("training shadow keeps stable, good-run, and video evidence adjustment", () => {
  const result = buildTrainingEvidenceShadow(profile(), 72, "oneWeekPrimary");
  assert.equal(result.evidenceAdjustment, 2);
});

test("training shadow adjustment is bounded to three points", () => {
  const result = buildTrainingEvidenceShadow(profile({
    score: 55,
    baseScore: 55,
    phaseRepresentatives: { final: { score: 92 }, oneWeek: { score: 94 } },
    components: { phaseQuality: 93, recentBest: 94, consistency: 92, volume: 45, freshness: 44 },
  }), 55, "oneWeekPrimary");
  assert.equal(result.adjustment, 3);
  assert.equal(result.shadowScore, 58);
});

test("missing training remains unchanged", () => {
  const result = buildTrainingEvidenceShadow(profile({ sessions: [], status: "missing" }), 60);
  assert.equal(result.adjustment, 0);
  assert.equal(result.shadowScore, 60);
  assert.equal(result.status, "missing");
});

test("empirical clock scoring compares slope clocks within the correct training center", () => {
  const fast = empiricalSessionScore({ type: "slope", f4: 53, f1: 12.3, lap: { lap2: 12.8, lap1: 12.3 } }, "栗東");
  const slow = empiricalSessionScore({ type: "slope", f4: 62, f1: 15, lap: { lap2: 14.8, lap1: 15 } }, "栗東");
  assert.ok(fast.score > slow.score);
  assert.equal(fast.baselineId, "slope-ritto");
});

test("empirical clock baseline is result and market independent", () => {
  const result = buildTrainingEvidenceShadow(profile({
    sessions: [{ type: "wood", course: "D", f4: 51.5, f1: 11.4, lap: { lap2: 12, lap1: 11.4 }, phase: "final", daysBeforeRace: 3, dateValue: 1 }],
  }), 72, "empiricalQuality", { stableSide: "美浦", finish: 1, odds: 99 });
  const changed = buildTrainingEvidenceShadow(profile({
    sessions: [{ type: "wood", course: "D", f4: 51.5, f1: 11.4, lap: { lap2: 12, lap1: 11.4 }, phase: "final", daysBeforeRace: 3, dateValue: 1 }],
  }), 72, "empiricalQuality", { stableSide: "美浦", finish: 18, odds: 1.1 });
  assert.deepEqual(result, changed);
});
