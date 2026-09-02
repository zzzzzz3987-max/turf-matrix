import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateStableOperationEvaluation,
  evaluateRaceStableOperationPrediction,
  resultFor,
} from "../../analyze/lib/stable-operation-shadow.mjs";

const prediction = {
  raceId: "race-1",
  bundleId: "bundle-1",
  track: "阪神",
  raceNumber: 9,
  raceName: "検証特別",
  horses: [
    { number: 1, name: "アルファ", trainer: "A", currentStable: 72, shadowStable: 69, stableAdjustment: -3, status: "active" },
    { number: 2, name: "ベータ", trainer: "B", currentStable: 70, shadowStable: 72, stableAdjustment: 2, status: "active" },
    { number: 3, name: "ガンマ", trainer: "C", currentStable: 68, shadowStable: 70, stableAdjustment: 2, status: "no_pattern_match" },
  ],
};

const resultRace = {
  horses: [
    { horseNumber: 1, horseName: "アルファ", finishPosition: 7 },
    { horseNumber: 2, horseName: "ベータ", finishPosition: 1 },
    { horseNumber: 3, horseName: "ガンマ", finishPosition: 3 },
  ],
};

test("stable shadow results join by horse number and normalized name", () => {
  assert.equal(resultFor(prediction.horses[0], resultRace).finishPosition, 7);
  assert.equal(resultFor({ number: 1, name: "別馬" }, resultRace), null);
});

test("stable evaluation compares frozen current and shadow rankings", () => {
  const evaluated = evaluateRaceStableOperationPrediction(prediction, resultRace);
  assert.equal(evaluated.leaderChanged, true);
  assert.equal(evaluated.currentLeader.name, "アルファ");
  assert.equal(evaluated.shadowLeader.name, "ベータ");
  assert.equal(evaluated.currentLeader.finish, 7);
  assert.equal(evaluated.shadowLeader.finish, 1);
  const aggregate = aggregateStableOperationEvaluation([evaluated]);
  assert.equal(aggregate.currentLeaderWins, 0);
  assert.equal(aggregate.shadowLeaderWins, 1);
  assert.equal(aggregate.maxAbsAdjustment, 3);
});
