import assert from "node:assert/strict";
import test from "node:test";
import { aggregatePaceShapeEvaluation, evaluateRacePaceShapePrediction } from "../../analyze/lib/pace-shape-shadow.mjs";

const horse = (number, name, currentPace, shadowPace, finish) => ({
  number, name, currentPace, shadowPace,
  paceAdjustment: shadowPace - currentPace,
  matchedRunCount: 1,
  currentTm: 70 + number,
  shadowTm: 70 + number,
  finish,
});

test("Pace shadow evaluation compares frozen scores with later results", () => {
  const prediction = {
    raceId: "r1", bundleId: "b1", track: "新潟", raceNumber: 7, raceName: "テスト",
    horses: [horse(1, "A", 72, 72, 3), horse(2, "B", 70, 73, 1), horse(3, "C", 68, 68, 2)],
  };
  const results = { horses: prediction.horses.map((item) => ({ horseNumber: item.number, horseName: item.name, finishPosition: item.finish })) };
  const race = evaluateRacePaceShapePrediction(prediction, results);
  assert.equal(race.currentPaceLeader.name, "A");
  assert.equal(race.shadowPaceLeader.name, "B");
  const aggregate = aggregatePaceShapeEvaluation([race]);
  assert.equal(aggregate.currentPaceWins, 0);
  assert.equal(aggregate.shadowPaceWins, 1);
  assert.equal(aggregate.adjustedHorseCount, 1);
});
