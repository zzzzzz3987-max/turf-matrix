import test from "node:test";
import assert from "node:assert/strict";
import { collectPublicRoleRecords, summarizePublicRoleRecords } from "../../analyze/lib/public-role-performance.mjs";

test("public role results use only the selected pre-race horse", () => {
  const records = collectPublicRoleRecords({
    date: "2026-08-29",
    snapshot: { races: [{ bundleId: "race-1" }] },
    results: {
      races: [{
        bundleId: "race-1",
        horses: [
          { horseNumber: 3, finishPosition: 1, winPayout: 1290, placePayout: 300 },
          { horseNumber: 6, finishPosition: 8, winPayout: 0, placePayout: 0 },
        ],
      }],
    },
    selectConclusion: () => ({
      value: { horse: { number: 3, name: "注目馬", popularity: 5 } },
      danger: { horse: { number: 6, name: "人気馬", popularity: 1 } },
    }),
  });

  assert.deepEqual(records.map((record) => [record.role, record.finishPosition]), [
    ["value", 1],
    ["danger", 8],
  ]);
});

test("role summary separates hit rates, missed top-three rate, and returns", () => {
  const summary = summarizePublicRoleRecords([
    { finishPosition: 1, payoutAvailable: true, winPayout: 600, placePayout: 200 },
    { finishPosition: 4, payoutAvailable: true, winPayout: 0, placePayout: 0 },
    { finishPosition: 2, payoutAvailable: false, winPayout: null, placePayout: null },
  ]);

  assert.equal(summary.sampleSize, 3);
  assert.equal(summary.topThreeRate, 66.7);
  assert.equal(summary.missedTopThreeRate, 33.3);
  assert.equal(summary.payoutSampleSize, 2);
  assert.equal(summary.winReturnRate, 300);
  assert.equal(summary.placeReturnRate, 100);
});

test('non-finish is a losing start, not a top-three finish; non-starters are excluded', () => {
  const rows = [
    { finishPosition: 1, abnormalityCode: '0', payoutAvailable: true, winPayout: 420, placePayout: 150 },
    { finishPosition: 0, abnormalityCode: '4', payoutAvailable: true, winPayout: 0, placePayout: 0 },
    ...['1', '2', '3'].map(abnormalityCode => ({ finishPosition: 0, abnormalityCode, payoutAvailable: true, winPayout: 100, placePayout: 100 })),
    { finishPosition: 0, payoutAvailable: true, winPayout: 0, placePayout: 0 },
    { finishPosition: -1 },
    { finishPosition: 1.5 },
  ];
  const result = summarizePublicRoleRecords(rows);
  assert.equal(result.sampleSize, 2);
  assert.equal(result.topThree, 1);
  assert.equal(result.missedTopThree, 1);
  assert.equal(result.excludedCount, 6);
  assert.equal(result.winReturnRate, 210);
  assert.equal(result.placeReturnRate, 75);
});

test('collection preserves abnormality code for downstream settlement', () => {
  const records = collectPublicRoleRecords({ date: '2026-09-12',
    snapshot: { races: [{ bundleId: 'race' }] },
    results: { races: [{ bundleId: 'race', horses: [{ horseNumber: 13, finishPosition: 0, abnormalityCode: '4', winPayout: 0, placePayout: 0 }] }] },
    selectConclusion: () => ({ value: { horse: { number: 13, name: 'non-finisher' } } }),
  });
  assert.equal(records[0].abnormalityCode, '4');
  assert.equal(summarizePublicRoleRecords(records).topThree, 0);
  assert.equal(summarizePublicRoleRecords(records).sampleSize, 1);
});
