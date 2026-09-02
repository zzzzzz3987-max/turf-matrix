import assert from "node:assert/strict";
import test from "node:test";
import { selectPublicRolePaceShadow } from "../public-role-pace-shadow.mjs";

const horse = (number, score, popularity, factors, profile = {}) => ({
  id: `h${number}`,
  number,
  name: `馬${number}`,
  tmIndex: score,
  popularity,
  currentRace: { raceDate: "2026-09-05" },
  pastRuns: profile.run ? [{ date: "2026-08-30", course: "新潟", raceNumber: 7, horseNumber: number, margin: 0.4 }] : [],
  analysis: {
    factorsDetail: {
      ...Object.fromEntries(Object.entries(factors).map(([key, value]) => [key, { score: value }])),
      value: { eligible: profile.valueEligible === true, marketGap: profile.marketGap ?? 0 },
    },
  },
});

const historyFor = (rows) => ({
  races: [{
    key: "2026-08-30-niigata-07R",
    date: "2026-08-30",
    fieldSize: 12,
    shape: "front_collapse",
    outcome: { label: "差し決着" },
    pace: { classification: "front_loaded", label: "前傾", first3F: 33.8, last3F: 36 },
    horses: rows,
  }],
});

test("against-flow evidence breaks a close value-candidate tie", () => {
  const race = { horses: [
    horse(1, 82, 1, { ability: 82, form: 80 }),
    horse(2, 80, 2, { ability: 80, form: 79 }),
    horse(3, 76, 7, { ability: 72, form: 72, pace: 72 }, { run: true, valueEligible: true, marketGap: 4 }),
    horse(4, 75, 8, { ability: 73, form: 73, pace: 73 }, { run: true, valueEligible: true, marketGap: 4 }),
  ] };
  const history = historyFor([
    { horseNumber: 3, horseName: "馬3", finishPosition: 3, role: "front", positionChange: 0, flowAssessment: "against_flow_strong", flowImpact: 2, flowReason: "前傾・差し決着に逆らって前方で踏ん張った" },
    { horseNumber: 4, horseName: "馬4", finishPosition: 2, role: "rear", positionChange: 0.4, flowAssessment: "flow_aided", flowImpact: -1, flowReason: "前傾・差し決着の展開利を受けた好走" },
  ]);
  const result = selectPublicRolePaceShadow(race, history);
  assert.equal(result.paceValue.id, "h3");
  assert.equal(result.evidence.value.paceProfile.adjustment, 1);
  assert.equal(result.policy.historicalOfficialLapsUsed, true);
});

test("against-flow resilience protects a popular horse from the danger tie-break", () => {
  const race = { horses: [
    horse(1, 84, 3, { ability: 78, pace: 70 }),
    horse(2, 82, 2, { ability: 77, pace: 69 }),
    horse(3, 80, 1, { ability: 63, pace: 62 }, { run: true }),
    horse(4, 78, 2, { ability: 63, pace: 62 }, { run: true }),
  ] };
  const history = historyFor([
    { horseNumber: 3, horseName: "馬3", finishPosition: 3, role: "front", positionChange: 0, flowAssessment: "against_flow_strong", flowImpact: 2, flowReason: "逆展開" },
    { horseNumber: 4, horseName: "馬4", finishPosition: 2, role: "rear", positionChange: 0.3, flowAssessment: "flow_aided", flowImpact: -1, flowReason: "展開利" },
  ]);
  const result = selectPublicRolePaceShadow(race, history);
  assert.equal(result.paceDanger.id, "h4");
});

test("future race shape never changes role selection", () => {
  const race = { horses: [
    horse(1, 82, 1, { ability: 80 }),
    horse(2, 80, 2, { ability: 78 }),
    horse(3, 76, 7, { ability: 72, form: 72 }, { run: true, valueEligible: true, marketGap: 4 }),
  ] };
  const base = historyFor([{ horseNumber: 3, horseName: "馬3", finishPosition: 3, role: "front", positionChange: 0, flowImpact: 2, flowReason: "逆展開" }]);
  const future = structuredClone(base);
  future.races.push({ ...structuredClone(base.races[0]), key: "2026-09-12-niigata-07R", date: "2026-09-12" });
  assert.deepEqual(selectPublicRolePaceShadow(race, base), selectPublicRolePaceShadow(race, future));
});
