import assert from "node:assert/strict";
import test from "node:test";
import { buildCoursePaceContextProfile, buildPaceContextShadow } from "../pace-context-shadow.mjs";

const horse = (positions, number = 3, fieldSize = 12) => ({
  horseName: "テストホース",
  horseNumber: number,
  currentRace: { raceDate: "2026-09-05", fieldSize },
  pastRuns: positions.map((position) => ({ passingOrder: [position], fieldSize })),
});

test("compact geometry favors front styles without double-counting an exact style rule", () => {
  const context = {
    surface: "芝",
    courseShape: { layout: "small", straight: "short" },
    paceScenario: { expectedPace: "標準", confidence: "high", fieldSize: 12 },
  };
  assert.equal(buildCoursePaceContextProfile(horse([1, 2, 2]), context).components.geometry, 1);
  assert.equal(buildCoursePaceContextProfile(horse([10, 11, 9]), context).components.geometry, -1);
  assert.equal(buildCoursePaceContextProfile(horse([1, 2, 2]), { ...context, styleBias: ["逃げ"] }).components.geometry, 0);
});

test("high pace cancels a positive front-bias reward", () => {
  const context = {
    surface: "芝",
    courseShape: { layout: "wide", straight: "long" },
    paceScenario: { expectedPace: "ハイ", confidence: "high", fieldSize: 12 },
    trackBias: {
      position: { status: "active", direction: "front", strength: "strong" },
      frame: { status: "monitor", direction: "neutral", strength: "watch" },
      sample: { raceCount: 5 },
    },
  };
  const profile = buildCoursePaceContextProfile(horse([1, 2, 2]), context);
  assert.equal(profile.components.trackPosition, 0);
  assert.equal(profile.components.paceConflictApplied, true);
});

test("straight 1000 uses frame zone but does not call it observed lane path", () => {
  const context = {
    surface: "芝",
    distance: 1000,
    courseShape: { turn: "straight", layout: "straight" },
    paceScenario: { expectedPace: "標準", confidence: "high", fieldSize: 12 },
  };
  const outer = buildCoursePaceContextProfile(horse([1, 2, 2], 12), context);
  const inner = buildCoursePaceContextProfile(horse([1, 2, 2], 1), context);
  assert.equal(outer.components.staticFrame, 1);
  assert.equal(inner.components.staticFrame, -1);
});

test("combined historical and current context adjustment is deterministic and bounded", () => {
  const value = horse([1, 2, 2], 12);
  value.pastRuns = [{ date: "2026-08-30", course: "新潟", raceNumber: 7, horseNumber: 12, passingOrder: [1], fieldSize: 12 }];
  const history = { races: [{
    key: "2026-08-30-niigata-07R",
    date: "2026-08-30",
    course: "niigata",
    raceNumber: 7,
    shape: "front_collapse",
    confidence: "high",
    fieldSize: 12,
    horses: [{ horseNumber: 12, horseName: "テストホース", finishPosition: 3, role: "front", positionChange: 0 }],
  }] };
  const context = {
    surface: "芝", distance: 1000,
    courseShape: { turn: "straight", layout: "straight" },
    paceScenario: { expectedPace: "標準", confidence: "high", fieldSize: 12 },
  };
  const first = buildPaceContextShadow(value, 95, context, history);
  const second = buildPaceContextShadow(value, 95, context, history);
  assert.deepEqual(first, second);
  assert.equal(first.adjustment, 2);
  assert.equal(first.shadowScore, 96);
  assert.equal(first.policy.observedLanePathUsed, false);
});

test("obstacle races remain outside the flat-course context adjustment", () => {
  const runner = horse([1, 1, 2], 2, 12);
  const profile = buildPaceContextShadow(runner, 70, {
    surface: "障",
    distance: 3250,
    fieldSize: 12,
    courseShape: { layout: "small", straight: "short" },
    paceScenario: { expectedPace: "ハイ", confidence: "high" },
  }, { races: [] });
  assert.equal(profile.status, "unsupported");
  assert.equal(profile.adjustment, 0);
  assert.equal(profile.shadowScore, 70);
});
