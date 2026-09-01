import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregateShadowEvaluation,
  evaluateRaceShadowPrediction,
  resultFor,
} from "../../analyze/lib/blood-pairing-cross-shadow.mjs";

const prediction = {
  raceId: "test-race",
  bundleId: "test-bundle",
  track: "東京",
  raceNumber: 1,
  raceName: "テスト",
  leaderSetChanged: true,
  horses: [
    { number: 1, name: "アルファ", currentBlood: 70, shadowBlood: 69, shadowAdjustment: -1, currentRank: 1, shadowRank: 2 },
    { number: 2, name: "ベータ", currentBlood: 69, shadowBlood: 70, shadowAdjustment: 1, currentRank: 2, shadowRank: 1 },
    { number: 3, name: "ガンマ", currentBlood: 65, shadowBlood: 65, shadowAdjustment: 0, currentRank: 3, shadowRank: 3 },
  ],
};
const results = {
  horses: [
    { horseNumber: 1, horseName: "アルファ", finishPosition: 4 },
    { horseNumber: 2, horseName: "ベータ", finishPosition: 1 },
    { horseNumber: 3, horseName: "ガンマ", finishPosition: 2 },
  ],
};

test("result joins require both horse number and normalized name", () => {
  assert.equal(resultFor({ number: 2, name: "ベータ" }, results)?.finishPosition, 1);
  assert.equal(resultFor({ number: 2, name: "別馬" }, results), null);
});

test("frozen Blood shadow evaluates current and shadow ranks independently", () => {
  const evaluated = evaluateRaceShadowPrediction(prediction, results);
  assert.equal(evaluated.currentLeaderBestFinish, 4);
  assert.equal(evaluated.shadowLeaderBestFinish, 1);
  assert.equal(evaluated.adjustedHorseCount, 2);
  assert.equal(evaluated.rankChangedHorseCount, 2);
});

test("aggregate evaluation preserves bounded score and comparable metrics", () => {
  const evaluated = evaluateRaceShadowPrediction(prediction, results);
  const aggregate = aggregateShadowEvaluation([evaluated]);
  assert.equal(aggregate.raceCount, 1);
  assert.equal(aggregate.currentLeaderWins, 0);
  assert.equal(aggregate.shadowLeaderWins, 1);
  assert.equal(aggregate.maxAbsAdjustment, 1);
  assert.equal(aggregate.currentPairwiseComparable, aggregate.shadowPairwiseComparable);
});

test("a scratched horse is removed before Blood ranks are recalculated", () => {
  const scratchedPrediction = {
    ...prediction,
    horses: [
      { number: 9, name: "取消馬", currentBlood: 80, shadowBlood: 80, shadowAdjustment: 0, currentRank: 1, shadowRank: 1 },
      ...prediction.horses.map((horse) => ({ ...horse, currentRank: horse.currentRank + 1, shadowRank: horse.shadowRank + 1 })),
    ],
  };
  const evaluated = evaluateRaceShadowPrediction(scratchedPrediction, results);
  assert.equal(evaluated.scratchedOrUnmatchedCount, 1);
  assert.equal(evaluated.currentLeaderBestFinish, 4);
  assert.equal(evaluated.shadowLeaderBestFinish, 1);
});
