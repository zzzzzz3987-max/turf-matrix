import assert from "node:assert/strict";
import test from "node:test";
import { selectPublicRoleEvidenceShadow } from "../public-role-evidence-shadow.mjs";

const horse = (number, tmIndex, popularity, factorScores, options = {}) => ({
  id: `h${number}`,
  number,
  name: `馬${number}`,
  tmIndex,
  popularity,
  currentRace: { raceDate: "2026-09-06" },
  pastRuns: [],
  analysis: {
    goingAnalysis: { adjustment: options.going ?? 0 },
    factorsDetail: {
      ...Object.fromEntries(Object.entries(factorScores).map(([key, score]) => [key, { score }])),
      ability: {
        score: factorScores.ability,
        components: options.opponentQuality == null ? [] : [{ key: "opponentCareer", score: options.opponentQuality }],
      },
      distance: {
        score: factorScores.distance,
        components: {
          direction: { adjustment: options.distanceDirection ?? 0 },
          transition: { adjustment: options.distanceTransition ?? 0 },
          cadence: { adjustment: options.distanceCadence ?? 0 },
        },
      },
      load: { score: factorScores.load ?? 65, adjustment: options.load ?? 0, tolerance: { adjustment: options.loadTolerance ?? 0 } },
      trackBias: { score: factorScores.trackBias ?? 65, adjustment: options.trackBias ?? 0 },
      pace: { score: factorScores.pace, contextFit: { adjustment: options.paceFit ?? 0 } },
      value: { eligible: options.valueEligible === true, marketGap: options.marketGap ?? 0, ev: options.ev ?? 1.2 },
    },
  },
});

const good = { ability: 72, form: 70, training: 69, blood: 68, stable: 66, distance: 72, course: 70, pace: 70, load: 65, trackBias: 65 };

test("value selection abstains when candidates lack supporting evidence", () => {
  const weak = { ...good, ability: 64, form: 62, training: 62, distance: 58, course: 64, pace: 63 };
  const race = { horses: [
    horse(1, 82, 1, good),
    horse(2, 80, 2, good),
    horse(3, 76, 8, weak, { valueEligible: true, marketGap: 5, distanceDirection: -2 }),
  ] };
  const selected = selectPublicRoleEvidenceShadow(race, { races: [] });
  assert.equal(selected.evidenceValue, null);
  assert.equal(selected.policy.abstentionAllowed, true);
});

test("value selection prefers broad evidence over a larger EV or market gap", () => {
  const race = { horses: [
    horse(1, 84, 1, good),
    horse(2, 81, 2, good),
    horse(3, 77, 9, { ...good, ability: 68, form: 67, training: 64 }, { valueEligible: true, marketGap: 6, ev: 4.5 }),
    horse(4, 76, 7, { ...good, ability: 74, form: 72, training: 71, distance: 74 }, { valueEligible: true, marketGap: 3, ev: 1.4, paceFit: 1 }),
  ] };
  const selected = selectPublicRoleEvidenceShadow(race, { races: [] });
  assert.equal(selected.evidenceValue.id, "h4");
  assert.equal(selected.policy.evUsedForRanking, false);
});

test("multiple condition weaknesses can flag a popular horse with a two-rank gap", () => {
  const race = { horses: [
    horse(1, 84, 3, good),
    horse(2, 82, 4, good),
    horse(3, 78, 1, { ...good, distance: 58, form: 62 }, { distanceDirection: -2, load: -1 }),
  ] };
  const selected = selectPublicRoleEvidenceShadow(race, { races: [] });
  assert.equal(selected.evidenceDanger.id, "h3");
  assert.ok(selected.evidence.danger.riskPoints >= 2);
});

test("strong-opponent and adverse-flow evidence protect a popular horse", () => {
  const race = { horses: [
    horse(1, 84, 3, good),
    horse(2, 82, 4, good),
    horse(3, 78, 1, { ...good, form: 63 }, { opponentQuality: 75 }),
  ] };
  const history = {
    races: [{
      key: "2026-08-30-niigata-07R",
      date: "2026-08-30",
      fieldSize: 12,
      shape: "front_collapse",
      outcome: { label: "差し決着" },
      pace: { classification: "front_loaded", label: "前傾" },
      horses: [{ horseNumber: 3, horseName: "馬3", finishPosition: 3, flowImpact: 2, flowReason: "逆展開" }],
    }],
  };
  race.horses[2].pastRuns = [{ date: "2026-08-30", course: "新潟", raceNumber: 7, horseNumber: 3 }];
  const selected = selectPublicRoleEvidenceShadow(race, history);
  assert.equal(selected.evidenceDanger, null);
});

test("result fields never change evidence role selection", () => {
  const race = { horses: [
    horse(1, 82, 1, good),
    horse(2, 80, 2, good),
    horse(3, 76, 7, good, { valueEligible: true, marketGap: 4 }),
  ] };
  const withResults = structuredClone(race);
  withResults.horses[2].finishPosition = 1;
  withResults.horses[2].winPayout = 900;
  const before = selectPublicRoleEvidenceShadow(race, { races: [] });
  const after = selectPublicRoleEvidenceShadow(withResults, { races: [] });
  assert.equal(before.evidenceValue.id, after.evidenceValue.id);
  assert.equal(before.evidenceDanger?.id ?? null, after.evidenceDanger?.id ?? null);
  assert.deepEqual(before.evidence.value.components, after.evidence.value.components);
});
