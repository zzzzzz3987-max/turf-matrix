import assert from "node:assert/strict";
import test from "node:test";
import { resolveCourseGeometry } from "../course-geometry.mjs";
import { buildCourseAnalysis, geometrySimilarity } from "../course-ai.mjs";

test("generic geometry covers JRA venues when an exact profile is absent", () => {
  const fixtures = [
    ["札幌", "芝", 1200], ["函館", "ダ", 1700], ["福島", "芝", 1200], ["新潟", "ダ", 1800],
    ["東京", "芝", 1600], ["中山", "芝", 1200], ["中京", "ダ", 1900], ["京都", "芝", 1400],
    ["阪神", "芝", 1800], ["小倉", "ダ", 1700],
  ];
  for (const [course, surface, distance] of fixtures) {
    assert.ok(resolveCourseGeometry({ course, surface, distance }), `${course}${surface}${distance}`);
  }
});

test("Niigata straight 1000 and inner dirt routes stay distinct", () => {
  assert.equal(resolveCourseGeometry({ course: "新潟", surface: "芝", distance: 1000 }).turn, "straight");
  assert.equal(resolveCourseGeometry({ course: "新潟", surface: "ダ", distance: 1800 }).layout, "inner");
});

test("Course analysis records similar geometry without changing its score", () => {
  const horse = {
    currentRace: { course: "東京", surface: "芝", distance: 1600 },
    pastRuns: [
      { course: "東京", surface: "芝", distance: 1800, fieldSize: 16, finishPosition: 2, margin: 0.2, raceName: "形態テスト" },
    ],
  };
  const before = 71;
  const analysis = buildCourseAnalysis(horse, {
    profile: "マイル",
    summary: "東京芝1600m。",
    courseShape: resolveCourseGeometry(horse.currentRace),
  }, { course: before, distance: 75 });
  assert.equal(analysis.score, before);
  assert.equal(analysis.geometryFit.scoreConnected, false);
  assert.equal(analysis.geometryFit.matchedRunCount, 1);
  assert.match(analysis.evidence.join(" "), /形態テスト/);
});

test("geometry similarity distinguishes incompatible layouts", () => {
  const straight = resolveCourseGeometry({ course: "新潟", surface: "芝", distance: 1000 });
  const inner = resolveCourseGeometry({ course: "新潟", surface: "ダ", distance: 1800 });
  assert.ok(geometrySimilarity(straight, inner) < 0.75);
});
