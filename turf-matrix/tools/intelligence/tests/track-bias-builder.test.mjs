import test from "node:test";
import assert from "node:assert/strict";
import { buildProfile, buildSnapshot, classifyPosition } from "../../analyze/build-track-bias-snapshot.mjs";

test("fourth-corner groups use field-relative thresholds", () => {
  assert.equal(classifyPosition(3, 12), "front");
  assert.equal(classifyPosition(6, 12), "middle");
  assert.equal(classifyPosition(9, 12), "rear");
});

test("profile activation requires races, no rear placings, front wins, and popularity support", () => {
  const races = Array.from({ length: 4 }, () => ({
    horses: [
      { finish: 1, popularity: 2, group: "front" },
      { finish: 2, popularity: 3, group: "front" },
      { finish: 3, popularity: 4, group: "middle" },
      { finish: 4, popularity: 1, group: "rear" },
    ],
  }));
  const profile = buildProfile({ track: "新潟", surface: "ダート", races });

  assert.equal(profile.status, "active");
  assert.equal(profile.strength, "moderate");
  assert.equal(profile.sample.rearTop3Count, 0);
});

test("previous-day snapshot recognizes Nakayama and Hanshin course codes", () => {
  const race = (courseCode, courseName) => ({
    Race: { CourseCode: courseCode, CourseName: courseName, RaceNo: 1 },
    Horses: [
      { FinishPosition: 1, FinalPopularity: 2, Corner4: 1 },
      { FinishPosition: 2, FinalPopularity: 3, Corner4: 2 },
      { FinishPosition: 3, FinalPopularity: 1, Corner4: 3 },
    ],
  });
  const snapshot = buildSnapshot({
    sourceDate: "2026-09-05",
    targetDate: "2026-09-06",
    liveResults: { RaceDate: "2026-09-05", Races: [race("06", "中山"), race("09", "阪神")] },
    publishedSignals: {
      races: [
        { track: "中山", number: 1, surface: "芝" },
        { track: "阪神", number: 1, surface: "ダ" },
      ],
    },
  });

  assert.deepEqual(snapshot.profiles.map(({ track, surface }) => ({ track, surface })), [
    { track: "阪神", surface: "ダート" },
    { track: "中山", surface: "芝" },
  ]);
});
