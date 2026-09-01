import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPairingCrossReference,
  buildPairingCrossShadow,
  leaveOneHorseOut,
} from "../blood-pairing-statistics.mjs";

const minimumSamples = {
  reference: 5,
  active: 12,
  high: 30,
  uniqueHorsesActive: 5,
  uniqueHorsesHigh: 10,
};

const statistic = ({ sampleSize = 20, uniqueHorseCount = 10, top3 = 9, horseContributions = {} } = {}) => ({
  sampleSize,
  uniqueHorseCount,
  wins: 3,
  top3,
  winRate: 0.15,
  hitRate: top3 / sampleSize,
  avgFinish: 5,
  eligible: sampleSize >= 12 && uniqueHorseCount >= 5,
  confidence: "mid",
  horseContributions,
});

const entity = (value) => ({
  overall: { all: value },
  courseSurfaceDistance: {},
  surfaceDistance: {},
  courseSurfaceGoing: {},
  surfaceSeason: {},
});

const baseHorse = (overrides = {}) => ({
  name: "テストホース",
  currentRace: { course: "東京", surface: "芝", distance: 1600, going: "良" },
  pedigree: {
    sire: "キズナ",
    broodmareSire: "ハーツクライ",
    sireSire: "ディープインパクト",
    ancestors: [
      { generation: 2, branch: "dam.sire.sire", name: "サンデーサイレンス" },
    ],
  },
  ...overrides,
});

const baseStatistics = (entities = {}) => ({
  baseline: { hitRate: 0.3 },
  minimumSamples,
  entities: {
    sireBroodmareSire: {},
    sireBroodmareSireLineId: {},
    sireLineIdBroodmareSire: {},
    sireLineIdBroodmareSireLineId: {},
    cross: {},
    ...entities,
  },
});

test("exact sire and broodmare-sire pairing wins over broader fallback", () => {
  const result = buildPairingCrossShadow({
    horse: baseHorse(),
    statistics: baseStatistics({
      sireBroodmareSire: { "キズナ::ハーツクライ": entity(statistic()) },
      sireLineIdBroodmareSireLineId: { "deep_impact::heart_cry": entity(statistic({ top3: 12 })) },
    }),
  });
  assert.equal(result.pairing?.fallbackLevel, "父×母父");
  assert.ok(result.pairingAdjustment > 0);
});

test("insufficient exact pairing falls back to broader pairing", () => {
  const result = buildPairingCrossShadow({
    horse: baseHorse(),
    statistics: baseStatistics({
      sireBroodmareSire: { "キズナ::ハーツクライ": entity(statistic({ sampleSize: 6, uniqueHorseCount: 4, top3: 3 })) },
      sireLineIdBroodmareSireLineId: { "deep_impact::heart_cry": entity(statistic()) },
    }),
  });
  assert.equal(result.pairing?.fallbackLevel, "父系×母父系");
  assert.equal(result.pairingReference?.fallbackLevel, "父×母父");
});

test("production reference exposes samples without a score adjustment", () => {
  const statistics = {
    ...baseStatistics({
      sireBroodmareSire: { "キズナ::ハーツクライ": entity(statistic()) },
    }),
    evaluationCutoff: "20260831",
  };
  const result = buildPairingCrossReference({ horse: baseHorse(), statistics });

  assert.equal(result.status, "reference_only");
  assert.equal(result.scoreApplied, false);
  assert.equal(result.pairing.fallbackLevel, "父×母父");
  assert.equal(result.pairing.sampleSize, 20);
  assert.equal(result.pairing.evaluationCutoff, "20260831");
  assert.equal(result.pairing.scoreApplied, false);
  assert.equal("adjustment" in result, false);
  assert.equal("adjustment" in result.pairing, false);
});

test("one result never becomes active evidence", () => {
  const result = buildPairingCrossShadow({
    horse: baseHorse(),
    statistics: baseStatistics({
      sireBroodmareSire: { "キズナ::ハーツクライ": entity(statistic({ sampleSize: 1, uniqueHorseCount: 1, top3: 1 })) },
    }),
  });
  assert.equal(result.status, "unavailable");
  assert.equal(result.adjustment, 0);
});

test("leave-one-horse-out can invalidate evidence", () => {
  const reduced = leaveOneHorseOut(statistic({
    sampleSize: 13,
    uniqueHorseCount: 5,
    top3: 7,
    horseContributions: {
      "テストホース": { sampleSize: 2, wins: 1, top3: 1, finishTotal: 4 },
    },
  }), "テストホース", minimumSamples);
  assert.equal(reduced.sampleSize, 11);
  assert.equal(reduced.uniqueHorseCount, 4);
  assert.equal(reduced.eligible, false);
});

test("pairing and cross adjustment is deterministic and bounded", () => {
  const horse = baseHorse({
    odds: 999,
    popularity: 18,
    pedigree: {
      sire: "キズナ",
      broodmareSire: "ハーツクライ",
      sireSire: "ディープインパクト",
      ancestors: [
        { generation: 2, branch: "dam.sire.sire", name: "サンデーサイレンス" },
        { generation: 3, branch: "sire.sire.sire", name: "Shared" },
        { generation: 4, branch: "dam.sire.sire.sire", name: "Shared" },
      ],
    },
  });
  const statistics = baseStatistics({
    sireBroodmareSire: { "キズナ::ハーツクライ": entity(statistic({ top3: 20 })) },
    cross: { "shared::3x4": entity(statistic({ top3: 20 })) },
  });
  const first = buildPairingCrossShadow({ horse, statistics });
  const second = buildPairingCrossShadow({ horse: { ...horse, odds: 1.1, popularity: 1 }, statistics });
  assert.deepEqual(first, second);
  assert.ok(Math.abs(first.adjustment) <= 2);
  assert.ok(Math.abs(first.crossAdjustment) <= 0.5);
});
