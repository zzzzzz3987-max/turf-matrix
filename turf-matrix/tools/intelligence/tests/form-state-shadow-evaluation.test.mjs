import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateFormStateEvaluation,
  evaluateRaceFormStatePrediction,
  resultFor,
} from "../../analyze/lib/form-state-shadow.mjs";

const horse = (number, name, currentForm, shadowForm, currentTm, shadowTm) => ({
  number,
  name,
  currentForm,
  shadowForm,
  formAdjustment: shadowForm - currentForm,
  currentTm,
  shadowTm,
});

test("Form result join requires matching number and normalized name", () => {
  const resultRace = { horses: [{ horseNumber: 1, horseName: " テスト馬 ", finishPosition: 2 }] };
  assert.equal(resultFor({ number: 1, name: "テスト馬" }, resultRace)?.finishPosition, 2);
  assert.equal(resultFor({ number: 1, name: "別馬" }, resultRace), null);
});

test("Form shadow evaluates frozen leaders without rebuilding scores", () => {
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
  const evaluated = evaluateRaceFormStatePrediction(prediction, results);
  assert.equal(evaluated.currentFormLeader.name, "A");
  assert.equal(evaluated.shadowFormLeader.name, "B");
  assert.equal(evaluated.shadowTmLeader.finish, 1);
});

test("Form shadow aggregates Form and TM outcomes separately", () => {
  const race = {
    horseCount: 2,
    adjustedHorseCount: 2,
    formLeaderChanged: true,
    tmLeaderChanged: true,
    currentFormLeader: { finish: 4 },
    shadowFormLeader: { finish: 1 },
    currentTmLeader: { finish: 4 },
    shadowTmLeader: { finish: 1 },
    currentFormPairwise: { comparable: 1, concordant: 0 },
    shadowFormPairwise: { comparable: 1, concordant: 1 },
    currentTmPairwise: { comparable: 1, concordant: 0 },
    shadowTmPairwise: { comparable: 1, concordant: 1 },
    maxAbsAdjustment: 3,
  };
  const aggregate = aggregateFormStateEvaluation([race]);
  assert.equal(aggregate.shadowFormWins, 1);
  assert.equal(aggregate.shadowTmWins, 1);
  assert.equal(aggregate.shadowFormPairwiseRate, 1);
  assert.equal(aggregate.maxAbsAdjustment, 3);
});
