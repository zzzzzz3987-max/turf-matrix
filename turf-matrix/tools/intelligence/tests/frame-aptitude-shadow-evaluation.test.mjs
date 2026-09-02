import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateFrameAptitudeEvaluation,
  evaluateRaceFrameAptitudePrediction,
  resultFor,
} from "../../analyze/lib/frame-aptitude-shadow.mjs";

const prediction = {
  raceId: "race-1",
  bundleId: "bundle-1",
  track: "新潟",
  raceNumber: 9,
  raceName: "検証特別",
  horses: [
    { number: 1, name: "アルファ", currentFrame: 68, shadowFrame: 62, frameAdjustment: -6, status: "active", baselinePlaceRate: 0.2, predictedPlaceRate: 0.16 },
    { number: 8, name: "ベータ", currentFrame: 64, shadowFrame: 70, frameAdjustment: 6, status: "active", baselinePlaceRate: 0.2, predictedPlaceRate: 0.27 },
    { number: 15, name: "ガンマ", currentFrame: 58, shadowFrame: 65, frameAdjustment: 7, status: "active", baselinePlaceRate: 0.2, predictedPlaceRate: 0.21 },
  ],
};
const resultRace = {
  horses: [
    { horseNumber: 1, horseName: "アルファ", finishPosition: 7 },
    { horseNumber: 8, horseName: "ベータ", finishPosition: 1 },
    { horseNumber: 15, horseName: "ガンマ", finishPosition: 3 },
  ],
};

test("frame shadow results join by number and normalized name", () => {
  assert.equal(resultFor(prediction.horses[0], resultRace).finishPosition, 7);
  assert.equal(resultFor({ number: 1, name: "別馬" }, resultRace), null);
});

test("frame evaluation compares frozen rankings and probabilities", () => {
  const evaluated = evaluateRaceFrameAptitudePrediction(prediction, resultRace);
  assert.equal(evaluated.leaderChanged, true);
  assert.equal(evaluated.currentLeader.name, "アルファ");
  assert.equal(evaluated.shadowLeader.name, "ベータ");
  const aggregate = aggregateFrameAptitudeEvaluation([evaluated]);
  assert.equal(aggregate.currentLeaderWins, 0);
  assert.equal(aggregate.shadowLeaderWins, 1);
  assert.equal(aggregate.positiveSampleSize, 2);
  assert.equal(aggregate.negativeSampleSize, 1);
});
