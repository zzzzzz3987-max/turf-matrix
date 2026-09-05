import assert from "node:assert/strict";
import test from "node:test";
import { scoreRecentForm } from "../form-ai.mjs";
import { scoreCourse } from "../course-ai.mjs";

const run = { course: "中山", surface: "芝", distance: 1800, fieldSize: 16, finishPosition: 2, margin: 0.2, last3F: 34 };
const horse = (runs) => ({ currentRace: { course: "中山", surface: "芝", distance: 1800 }, pastRuns: runs });

test("normalized Form does not penalize more observations of identical performance", () => {
  const scores = [1, 2, 3, 5].map((count) => scoreRecentForm(horse(Array.from({ length: count }, () => ({ ...run }))), { normalizeWeights: true }));
  assert.equal(new Set(scores).size, 1);
});

test("normalized Form still assigns greater importance to the newest result", () => {
  const poor = { ...run, finishPosition: 15, margin: 3 };
  assert.ok(scoreRecentForm(horse([run, poor]), { normalizeWeights: true }) > scoreRecentForm(horse([poor, run]), { normalizeWeights: true }));
});

test("Form candidate keeps missing data fallback and one-run score", () => {
  assert.equal(scoreRecentForm(horse([]), { normalizeWeights: true }), 50);
  assert.equal(scoreRecentForm(horse([run]), { normalizeWeights: true }), scoreRecentForm(horse([run])));
});

test("Course candidate excludes both same-course and same-type dirt records from turf", () => {
  const base = horse([{ ...run, course: "東京", finishPosition: 10 }]);
  const added = horse([...base.pastRuns, { ...run, surface: "ダ", finishPosition: 1 }, { ...run, course: "阪神", surface: "ダ", finishPosition: 1 }]);
  assert.equal(scoreCourse(base, { sameSurfaceOnly: true }), scoreCourse(added, { sameSurfaceOnly: true }));
  assert.notEqual(scoreCourse(base), scoreCourse(added));
});

test("Course candidate preserves same-surface evidence and missing-surface neutrality", () => {
  const h = horse([run, { ...run, course: "東京" }]);
  assert.equal(scoreCourse(h), scoreCourse(h, { sameSurfaceOnly: true }));
  const unknown = { ...h, currentRace: { ...h.currentRace, surface: null } };
  assert.equal(scoreCourse(unknown, { sameSurfaceOnly: true }), scoreCourse({ ...unknown, pastRuns: [] }, { sameSurfaceOnly: true }));
});
