import test from "node:test";
import assert from "node:assert/strict";
import {
  buildBattleReadiness,
  selectBattleRace,
  selectBattleRaceShadow,
} from "../../battle-race-selection.mjs";

const horse = (tmIndex, scores = {}) => ({
  tmIndex,
  analysis: {
    factorsDetail: Object.fromEntries(Object.entries(scores).map(([key, score]) => [key, { score }])),
  },
});

test("current battle-race ordering remains gap first", () => {
  const signals = [
    { id: "large-gap", category: "special", indexTop: { tmIndex: 81 }, indexGap: 6, topConfidence: "high", time: "14:00", battleProfile: { score: 74, coverage: 1 } },
    { id: "high-readiness", category: "grade", indexTop: { tmIndex: 85 }, indexGap: 3, topConfidence: "high", time: "15:00", battleProfile: { score: 88, coverage: 1 } },
  ];
  assert.equal(selectBattleRace(signals).id, "large-gap");
  assert.equal(selectBattleRaceShadow(signals).id, "high-readiness");
});

test("battle readiness combines axis, conditions, and both opponent layers", () => {
  const profile = buildBattleReadiness({
    indexTop: horse(84, { ability: 82, form: 74, training: 76, pace: 78, distance: 86, course: 80 }),
    indexSecond: { tmIndex: 79 },
    evidenceProfile: { score: 77 },
    indexGap: 5,
  });
  assert.equal(profile.coverage, 1);
  assert.equal(profile.components.axisCore, 78);
  assert.equal(profile.components.conditionFit, 83);
  assert.equal(profile.components.opponentDepth, 78.1);
  assert.ok(profile.score > 79 && profile.score < 83);
});

test("low confidence and ordinary races remain ineligible for both selectors", () => {
  const signals = [
    { id: "ordinary", category: "race", indexTop: { tmIndex: 90 }, indexGap: 10, topConfidence: "high", battleProfile: { score: 90, coverage: 1 } },
    { id: "low", category: "grade", indexTop: { tmIndex: 90 }, indexGap: 10, topConfidence: "low", battleProfile: { score: 90, coverage: 1 } },
  ];
  assert.equal(selectBattleRace(signals), null);
  assert.equal(selectBattleRaceShadow(signals), null);
});
