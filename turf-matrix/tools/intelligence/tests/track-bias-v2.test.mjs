import assert from "node:assert/strict";
import test from "node:test";
import { buildTrackBiasProfile, resolveTrackBias, trackBiasAdjustment } from "../track-bias-ai.mjs";

const sourceRace = (raceNo) => ({
  date: "2026-09-05",
  track: "札幌",
  surface: "芝",
  raceNo,
  fieldSize: 6,
  horses: [
    { horseNumber: 1, finish: 1, popularity: 4, corner4: 1 },
    { horseNumber: 2, finish: 2, popularity: 5, corner4: 2 },
    { horseNumber: 3, finish: 3, popularity: 6, corner4: 3 },
    { horseNumber: 4, finish: 4, popularity: 3, corner4: 4 },
    { horseNumber: 5, finish: 5, popularity: 2, corner4: 5 },
    { horseNumber: 6, finish: 6, popularity: 1, corner4: 6 },
  ],
});

test("v2 profile separates position bias and frame-zone bias", () => {
  const profile = buildTrackBiasProfile({
    track: "札幌",
    surface: "芝",
    races: [1, 2, 3, 4].map(sourceRace),
    mode: "same_day",
  });
  assert.equal(profile.status, "active");
  assert.equal(profile.position.direction, "front");
  assert.equal(profile.frame.direction, "inner");
  assert.equal(profile.laneEvidence.status, "unavailable");
  assert.match(profile.laneEvidence.reason, /実走進路/);
});

test("same-day resolver only uses earlier race numbers", () => {
  const snapshot = {
    sourceDate: "2026-09-05",
    targetDate: "2026-09-05",
    scoringMode: "shadow",
    races: [1, 2, 3, 4, 5, 6].map(sourceRace),
  };
  const profile = resolveTrackBias(snapshot, { raceDate: "2026-09-05", course: "札幌", surface: "芝", raceNo: 5 });
  assert.equal(profile.sample.raceCount, 4);
  assert.equal(profile.sourceThroughRaceNo, 4);
});

test("shadow v2 bias never changes production TM adjustment", () => {
  const profile = buildTrackBiasProfile({
    track: "札幌",
    surface: "芝",
    races: [1, 2, 3, 4].map(sourceRace),
    mode: "same_day",
    scoringMode: "shadow",
  });
  const horse = { horseNumber: 1, currentRace: { fieldSize: 6 }, pastRuns: [{ passingOrder: [1] }, { passingOrder: [2] }] };
  assert.equal(trackBiasAdjustment(horse, { trackBias: profile, fieldSize: 6 }), 0);
});
