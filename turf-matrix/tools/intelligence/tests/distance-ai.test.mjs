import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCadenceProfile,
  buildDirectionProfile,
  buildDistanceProfile,
  buildTransitionProfile,
  distanceType,
} from "../distance-ai.mjs";
import { buildCourseAnalysis } from "../course-ai.mjs";

const horseFor = (targetDistance, pastRuns) => ({
  currentRace: { raceDate: "2026-09-06", course: "札幌", surface: "芝", distance: targetDistance },
  pastRuns,
});

test("classifies 400m multiples as core distances", () => {
  assert.equal(distanceType(1200).key, "core");
  assert.equal(distanceType(1600).key, "core");
  assert.equal(distanceType(2000).key, "core");
  assert.equal(distanceType(2400).key, "core");
  assert.equal(distanceType(1500).key, "non_core");
  assert.equal(distanceType(1800).key, "non_core");
});

test("a strong 1400m finish supports 1500m extension more than a late fade", () => {
  const strong = horseFor(1500, [{
    date: "2026-08-20", surface: "芝", distance: 1400, fieldSize: 16,
    finishPosition: 1, margin: 0, passingOrder: [8, 7, 5, 1],
  }]);
  const faded = horseFor(1500, [{
    date: "2026-08-20", surface: "芝", distance: 1400, fieldSize: 16,
    finishPosition: 10, margin: 2, passingOrder: [1, 1, 1, 10],
  }]);

  const strongProfile = buildDirectionProfile(strong);
  const fadedProfile = buildDirectionProfile(faded);
  assert.equal(strongProfile.key, "extension");
  assert.equal(strongProfile.change, 100);
  assert.ok(strongProfile.score > fadedProfile.score);
  assert.ok(strongProfile.adjustment > fadedProfile.adjustment);
});

test("one isolated win cannot create an excessive direction or cadence adjustment", () => {
  const horse = horseFor(1500, [{
    date: "2026-08-20", surface: "芝", distance: 1400, fieldSize: 16,
    finishPosition: 1, margin: 0, passingOrder: [6, 5, 4, 1],
  }]);
  const profile = buildDistanceProfile(horse);
  assert.ok(profile.direction.adjustment <= 3);
  assert.ok(profile.cadence.adjustment <= 2);
  assert.ok(profile.score <= profile.baseScore + 5);
});

test("core and non-core history are evaluated as separate distance categories", () => {
  const coreHorse = horseFor(2000, [
    { date: "2026-08-20", surface: "芝", distance: 2000, fieldSize: 16, finishPosition: 1, margin: 0 },
    { date: "2026-07-20", surface: "芝", distance: 1600, fieldSize: 14, finishPosition: 2, margin: 0.1 },
    { date: "2026-06-20", surface: "芝", distance: 1800, fieldSize: 12, finishPosition: 1, margin: 0 },
  ]);
  const nonCoreHorse = horseFor(1800, coreHorse.pastRuns);

  const core = buildCadenceProfile(coreHorse);
  const nonCore = buildCadenceProfile(nonCoreHorse);
  assert.equal(core.label, "根幹距離");
  assert.equal(core.sampleCount, 2);
  assert.equal(nonCore.label, "非根幹距離");
  assert.equal(nonCore.sampleCount, 1);
});

test("course analysis explains distance direction and core category", () => {
  const horse = horseFor(1500, [{
    date: "2026-08-20", course: "札幌", surface: "芝", distance: 1400,
    fieldSize: 16, finishPosition: 2, margin: 0.1, passingOrder: [5, 4, 3, 2], raceName: "距離検証",
  }]);
  const analysis = buildCourseAnalysis(horse, { profile: "マイル", summary: "札幌芝1500m。" });
  assert.match(analysis.distanceSummary, /100m延長/);
  assert.match(analysis.distanceSummary, /非根幹距離/);
  assert.equal(analysis.distanceComponents.cadence.label, "非根幹距離");
});

test("repeated successful extensions create stronger individual evidence than repeated fades", () => {
  const successful = horseFor(1800, [
    { date: "2026-08-20", surface: "芝", distance: 1600, fieldSize: 16, finishPosition: 2, margin: 0.1, passingOrder: [6, 5, 3, 2] },
    { date: "2026-07-20", surface: "芝", distance: 1400, fieldSize: 16, finishPosition: 7, margin: 0.8, passingOrder: [8, 7, 7, 7] },
    { date: "2026-06-20", surface: "芝", distance: 1600, fieldSize: 14, finishPosition: 3, margin: 0.2, passingOrder: [7, 6, 4, 3] },
    { date: "2026-05-20", surface: "芝", distance: 1400, fieldSize: 14, finishPosition: 8, margin: 1.1, passingOrder: [7, 7, 8, 8] },
  ]);
  const fading = horseFor(1800, successful.pastRuns.map((run) => (
    run.distance === 1600
      ? { ...run, finishPosition: 12, margin: 2.2, passingOrder: [1, 1, 2, 12] }
      : { ...run, finishPosition: 3, margin: 0.2 }
  )));

  const strong = buildTransitionProfile(successful);
  const weak = buildTransitionProfile(fading);
  assert.equal(strong.sampleCount, 2);
  assert.ok(strong.score > weak.score);
  assert.ok(strong.adjustment > weak.adjustment);
});

test("missing target distance stays neutral instead of assuming 2000m", () => {
  const profile = buildDistanceProfile({ currentRace: { surface: "芝" }, pastRuns: [] });
  assert.equal(profile.target, null);
  assert.equal(profile.score, 58);
});
