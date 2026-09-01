import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregateAbilityCeilingEvaluation,
  evaluateRaceAbilityCeilingPrediction,
  resultFor,
} from "../../analyze/lib/ability-ceiling-shadow.mjs";

const horse = (number, name, currentAbility, shadowAbility, currentTm, shadowTm) => ({
  number,
  name,
  currentAbility,
  shadowAbility,
  abilityAdjustment: shadowAbility - currentAbility,
  currentTm,
  shadowTm,
});

test("ability shadow result join requires horse number and normalized name", () => {
  const resultRace = { horses: [{ horseNumber: 1, horseName: "テスト ホース", finishPosition: 2 }] };
  assert.equal(resultFor({ number: 1, name: "テストホース" }, resultRace)?.finishPosition, 2);
  assert.equal(resultFor({ number: 1, name: "別馬" }, resultRace), null);
});

test("ability shadow evaluates frozen leaders without market inputs", () => {
  const prediction = {
    raceId: "r1",
    bundleId: "b1",
    horses: [
      horse(1, "現行", 72, 69, 80, 79),
      horse(2, "影", 70, 73, 79, 81),
      horse(3, "第三", 65, 65, 70, 70),
    ],
  };
  const result = evaluateRaceAbilityCeilingPrediction(prediction, {
    horses: [
      { horseNumber: 1, horseName: "現行", finishPosition: 3 },
      { horseNumber: 2, horseName: "影", finishPosition: 1 },
      { horseNumber: 3, horseName: "第三", finishPosition: 2 },
    ],
  });
  assert.equal(result.currentTmLeader.name, "現行");
  assert.equal(result.shadowTmLeader.name, "影");
  assert.equal(result.shadowTmLeader.finish, 1);
  assert.equal(result.tmLeaderChanged, true);
});

test("ability shadow aggregation keeps Ability and TM outcomes separate", () => {
  const base = {
    horseCount: 3,
    adjustedHorseCount: 2,
    abilityLeaderChanged: true,
    tmLeaderChanged: true,
    currentAbilityLeader: { finish: 3 },
    shadowAbilityLeader: { finish: 1 },
    currentTmLeader: { finish: 3 },
    shadowTmLeader: { finish: 1 },
    currentAbilityPairwise: { comparable: 3, concordant: 1 },
    shadowAbilityPairwise: { comparable: 3, concordant: 2 },
    currentTmPairwise: { comparable: 3, concordant: 1 },
    shadowTmPairwise: { comparable: 3, concordant: 2 },
    maxAbsAdjustment: 3,
  };
  const result = aggregateAbilityCeilingEvaluation([base]);
  assert.equal(result.currentAbilityWins, 0);
  assert.equal(result.shadowAbilityWins, 1);
  assert.equal(result.currentTmPlaces, 1);
  assert.equal(result.shadowTmWins, 1);
});
