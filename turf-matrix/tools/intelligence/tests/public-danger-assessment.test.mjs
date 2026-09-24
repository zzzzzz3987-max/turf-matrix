import test from "node:test";
import assert from "node:assert/strict";
import { assessPublicDangerCandidates, selectPublicDangerEvidenceHorse } from "../../../src/lib/public-danger-assessment.js";
import { selectPublicDangerHorse } from "../../../src/lib/public-role-selection.js";

const factor = (score, extra = {}) => ({ score, status: "active", ...extra });
const raceWith = (factors = {}, extra = {}) => ({ horses: [
  ...[85, 83, 81].map((tmIndex, index) => ({ number: index + 1, tmIndex, popularity: index + 2, odds: 5 })),
  { number: 4, tmIndex: 75, popularity: 1, odds: 2.5, analysis: { factorsDetail: factors }, ...extra },
] });
const assessment = (race) => assessPublicDangerCandidates(race).find((item) => item.horse.number === 4);

test("rank disagreement alone is not evidence of danger; production stays unchanged", () => {
  const race = raceWith();
  assert.equal(selectPublicDangerHorse(race).number, 4);
  assert.equal(selectPublicDangerEvidenceHorse(race), null);
  assert.equal(assessment(race).classification, "market_mismatch");
});
test("two independent observed concerns qualify without changing the race", () => {
  const race = raceWith({ form: factor(60), distance: factor(55) });
  const before = structuredClone(race);
  assert.equal(selectPublicDangerEvidenceHorse(race).number, 4);
  assert.deepEqual(race, before);
});
test("missing, partial, deferred and nonfinite values cannot create risk", () => {
  for (const status of ["missing", "partial", "deferred", "unavailable", "reference_only", undefined]) {
    const race = raceWith({ form: factor(30, { status }), training: factor(30, { status }) });
    assert.deepEqual(assessment(race).risks, []);
  }
  assert.deepEqual(assessment(raceWith({ form: factor(null), training: factor(NaN), course: factor(30, { indexEligible: false }) })).risks, []);
});
test("correlated performance and suitability concerns each count once", () => {
  assert.equal(selectPublicDangerEvidenceHorse(raceWith({ ability: factor(50), form: factor(50) })), null);
  assert.equal(selectPublicDangerEvidenceHorse(raceWith({ distance: factor(50), course: factor(50) })), null);
});
test("training and speculative pace alone cannot trigger danger", () => {
  const pace = factor(50, { contextFit: { status: "active", scenarioConfidence: "high", adjustment: -3 } });
  assert.equal(selectPublicDangerEvidenceHorse(raceWith({ training: factor(50), pace })), null);
  pace.contextFit.scenarioConfidence = "low";
  assert.equal(assessment(raceWith({ pace })).risks.length, 0);
});
test("strong ability or established opponent quality protects candidates", () => {
  for (const ability of [factor(75), factor(65, { components: [{ key: "opponentCareer", ...factor(70) }] })]) {
    const item = assessment(raceWith({ ability, form: factor(50), distance: factor(50) }));
    assert.equal(item.classification, "market_mismatch");
    assert.ok(item.protections.length);
  }
});
test("close scores, tied leaders and invalid market data abstain", () => {
  const factors = { form: factor(50), distance: factor(50) };
  assert.equal(selectPublicDangerEvidenceHorse(raceWith(factors, { tmIndex: 84 })), null);
  const race = raceWith(factors);
  race.horses.forEach((horse) => { horse.tmIndex = 80; });
  assert.equal(assessment(race).classification, "none");
  for (const extra of [{ odds: null }, { odds: 0 }, { popularity: 0 }, { popularity: -1 }, { popularity: 1.5 }]) {
    assert.equal(assessment(raceWith(factors, extra)).classification, "none");
  }
});
test("single going observation and shadow bias are not corroborating evidence", () => {
  const race = raceWith({ form: factor(50), trackBias: factor(50, { adjustment: -3, scoringMode: "shadow" }) });
  race.horses[3].analysis.goingAnalysis = { status: "active", adjustment: -3, relevantRunCount: 1 };
  assert.equal(selectPublicDangerEvidenceHorse(race), null);
  race.horses[3].analysis.goingAnalysis.relevantRunCount = 2;
  assert.equal(selectPublicDangerEvidenceHorse(race).number, 4);
});
