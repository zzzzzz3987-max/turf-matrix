import assert from "node:assert/strict";
import test from "node:test";
import { selectPublicRoleFrameShadow } from "../public-role-frame-shadow.mjs";

const horse = (number, tmIndex, marketGap, evidence, frame) => ({
  id: `h${number}`,
  number,
  name: `馬${number}`,
  tmIndex,
  popularity: number,
  currentRace: { raceDate: "2026-09-06", course: "新潟", surface: "芝", distance: 1600, horseNumber: number },
  analysis: {
    factors: { frame },
    factorsDetail: {
      ability: { score: evidence }, form: { score: evidence }, training: { score: evidence }, pace: { score: evidence },
      distance: { score: evidence }, course: { score: evidence }, frame: { score: frame },
      value: { eligible: number >= 3, marketGap, ev: 1.2 },
    },
  },
  pastRuns: [],
});

const frameModel = (innerLift, middleLift) => ({
  period: { from: "2026-06-01", to: "2026-08-30" },
  levels: {
    course_surface_distance_field: {
      minimumSampleSize: 12,
      cells: {
        "niigata|turf|mile|large": {
          baselineHitRate: 0.2,
          zones: {
            inner: { sampleSize: 40, hitRate: 0.2 + innerLift, adjustedHitRate: 0.2 + innerLift, adjustedLift: innerLift, reliability: 0.5 },
            middle: { sampleSize: 40, hitRate: 0.2 + middleLift, adjustedHitRate: 0.2 + middleLift, adjustedLift: middleLift, reliability: 0.5 },
          },
        },
      },
    },
  },
});

const race = (thirdEvidence = 70, fourthEvidence = 70) => ({
  id: "2026-09-06-新潟-09R",
  bundleId: "2026-09-06-niigata-09R",
  track: "新潟",
  surface: "芝",
  distance: 1600,
  fieldSize: 15,
  horses: [
    horse(1, 82, 0, 80, 68),
    horse(2, 80, 0, 78, 68),
    horse(3, 77, 3, thirdEvidence, 68),
    horse(6, 76, 3, fourthEvidence, 64),
    horse(12, 74, 3, 65, 60),
  ],
});

test("validated frame evidence breaks a close value-candidate tie", () => {
  const selected = selectPublicRoleFrameShadow(race(), { races: [] }, frameModel(-0.05, 0.05));
  assert.equal(selected.paceValue.number, 3);
  assert.equal(selected.frameValue.number, 6);
  assert.equal(selected.evidence.frameEvidenceAdjustment, 1);
});

test("bounded frame evidence cannot override a clear evidence lead", () => {
  const selected = selectPublicRoleFrameShadow(race(74, 70), { races: [] }, frameModel(-0.05, 0.05));
  assert.equal(selected.paceValue.number, 3);
  assert.equal(selected.frameValue.number, 3);
});

test("a model from the race day cannot alter value selection", () => {
  const model = frameModel(-0.05, 0.05);
  model.period.to = "2026-09-06";
  const selected = selectPublicRoleFrameShadow(race(), { races: [] }, model);
  assert.equal(selected.frameValue.number, selected.paceValue.number);
  assert.equal(selected.evidence.frameEvidenceAdjustment, 0);
});

test("current result fields do not alter the frame value selection", () => {
  const first = race();
  const second = structuredClone(first);
  second.horses[2].finishPosition = 1;
  second.horses[3].finishPosition = 18;
  assert.equal(
    selectPublicRoleFrameShadow(first, { races: [] }, frameModel(-0.05, 0.05)).frameValue.number,
    selectPublicRoleFrameShadow(second, { races: [] }, frameModel(-0.05, 0.05)).frameValue.number
  );
});
