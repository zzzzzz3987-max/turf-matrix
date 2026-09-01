import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateTrainingEvidenceEvaluation,
  evaluateRaceTrainingEvidencePrediction,
  resultFor,
} from "../../analyze/lib/training-evidence-shadow.mjs";

const horse = (number, name, currentTraining, shadowTraining, currentTm, shadowTm) => ({
  number,
  name,
  currentTraining,
  shadowTraining,
  trainingAdjustment: shadowTraining - currentTraining,
  currentTm,
  shadowTm,
});

test("Training result join requires matching number and normalized name", () => {
  const resultRace = { horses: [{ horseNumber: 1, horseName: " テスト馬 ", finishPosition: 2 }] };
  assert.equal(resultFor({ number: 1, name: "テスト馬" }, resultRace)?.finishPosition, 2);
  assert.equal(resultFor({ number: 1, name: "別馬" }, resultRace), null);
});

test("Training shadow evaluates frozen leaders without rebuilding scores", () => {
  const prediction = {
    raceId: "race-1",
    bundleId: "bundle-1",
    track: "東京",
    raceNumber: 9,
    raceName: "テスト",
    horses: [
      horse(1, "A", 80, 77, 82, 81),
      horse(2, "B", 77, 80, 81, 82),
    ],
  };
  const results = { horses: [
    { horseNumber: 1, horseName: "A", finishPosition: 4 },
    { horseNumber: 2, horseName: "B", finishPosition: 1 },
  ] };
  const evaluated = evaluateRaceTrainingEvidencePrediction(prediction, results);
  assert.equal(evaluated.currentTrainingLeader.name, "A");
  assert.equal(evaluated.shadowTrainingLeader.name, "B");
  assert.equal(evaluated.shadowTmLeader.finish, 1);
});

test("Training shadow aggregates Training and TM outcomes separately", () => {
  const race = {
    horseCount: 2,
    adjustedHorseCount: 2,
    trainingLeaderChanged: true,
    tmLeaderChanged: true,
    currentTrainingLeader: { finish: 4 },
    shadowTrainingLeader: { finish: 1 },
    currentTmLeader: { finish: 4 },
    shadowTmLeader: { finish: 1 },
    currentTrainingPairwise: { comparable: 1, concordant: 0 },
    shadowTrainingPairwise: { comparable: 1, concordant: 1 },
    currentTmPairwise: { comparable: 1, concordant: 0 },
    shadowTmPairwise: { comparable: 1, concordant: 1 },
    maxAbsAdjustment: 3,
  };
  const aggregate = aggregateTrainingEvidenceEvaluation([race]);
  assert.equal(aggregate.shadowTrainingWins, 1);
  assert.equal(aggregate.shadowTmWins, 1);
  assert.equal(aggregate.shadowTrainingPairwiseRate, 1);
  assert.equal(aggregate.maxAbsAdjustment, 3);
});
