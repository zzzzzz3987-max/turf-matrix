import assert from "node:assert/strict";
import test from "node:test";
import { scoreRecentForm } from "../form-ai.mjs";
import { scoreCourse, buildCourseSurfaceEvidence } from "../course-ai.mjs";

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

test("Course surface candidate normalizes dirt aliases on both sides", () => {
  const base = { currentRace: { course: "中山", surface: "ダ", distance: 1800 }, pastRuns: [{ ...run, surface: "ダ" }] };
  const expected = scoreCourse(base, { sameSurfaceOnly: true });
  for (const target of ["ダ", "ダート", "ﾀﾞｰﾄ"]) {
    for (const past of ["ダ", "ダート", "ﾀﾞｰﾄ"]) {
      const h = { ...base, currentRace: { ...base.currentRace, surface: target }, pastRuns: [{ ...run, surface: past }] };
      assert.equal(scoreCourse(h, { sameSurfaceOnly: true }), expected);
      assert.equal(buildCourseSurfaceEvidence(h).sameCourse.length, 1);
    }
  }
});

test("unknown surfaces, obstacles and unknown course groups do not match each other", () => {
  for (const surface of [null, "", "障", "障芝", "不明"]) {
    const h = { currentRace: { course: "中山", surface }, pastRuns: [{ ...run, surface }] };
    assert.equal(buildCourseSurfaceEvidence(h).sameSurface.length, 0);
    assert.equal(scoreCourse(h, { sameSurfaceOnly: true }), 52);
  }
  const h = { currentRace: { course: "京都", surface: "芝" }, pastRuns: [{ ...run, course: "不明" }] };
  assert.equal(buildCourseSurfaceEvidence(h).sameType.length, 0);
});

test("adding turf winners does not inflate a dirt course candidate", () => {
  const h = { currentRace: { course: "中山", surface: "ダート" }, pastRuns: [{ ...run, surface: "ダ", finishPosition: 8 }] };
  const added = { ...h, pastRuns: [...h.pastRuns, { ...run, finishPosition: 1 }, { ...run, course: "阪神", finishPosition: 1 }] };
  assert.equal(scoreCourse(h, { sameSurfaceOnly: true }), scoreCourse(added, { sameSurfaceOnly: true }));
  assert.equal(buildCourseSurfaceEvidence(added).excludedSurfaceCount, 2);
});
