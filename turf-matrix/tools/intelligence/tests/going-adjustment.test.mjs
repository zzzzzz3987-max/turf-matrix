import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGoingAdjustment,
  normalizeGoing,
  shrinkFactorFor,
} from "../going-adjustment.mjs";

const run = ({
  surface = "芝",
  trackCondition = "良",
  margin = 0.8,
  finishPosition = 5,
  fieldSize = 12,
  raceName = "条件戦",
} = {}) => ({
  surface,
  trackCondition,
  margin,
  finishPosition,
  fieldSize,
  raceName,
});

const horse = (pastRuns) => ({
  horseName: "TEST",
  currentRace: { surface: "芝" },
  pastRuns,
});

test("going normalization handles supported TARGET labels", () => {
  assert.equal(normalizeGoing("良"), "good");
  assert.equal(normalizeGoing("稍"), "yielding");
  assert.equal(normalizeGoing("稍重"), "yielding");
  assert.equal(normalizeGoing("重"), "heavy");
  assert.equal(normalizeGoing("不良"), "heavy");
  assert.equal(normalizeGoing(" 未取得 "), null);
});

test("good and yielding tracks do not change TM INDEX in v1", () => {
  const h = horse([
    run({ trackCondition: "重", margin: 0, finishPosition: 1 }),
    run({ trackCondition: "良", margin: 1.5, finishPosition: 9 }),
  ]);
  const good = buildGoingAdjustment(h, { surface: "芝", going: "良" });
  const yielding = buildGoingAdjustment(h, { surface: "芝", going: "稍重" });

  assert.equal(good.adjustment, 0);
  assert.equal(good.status, "not_applicable");
  assert.equal(yielding.adjustment, 0);
  assert.equal(yielding.status, "not_applicable");
});

test("unexperienced heavy track remains neutral", () => {
  const result = buildGoingAdjustment(horse([
    run({ trackCondition: "良" }),
    run({ trackCondition: "稍重" }),
  ]), { surface: "芝", going: "重" });

  assert.equal(result.adjustment, 0);
  assert.equal(result.status, "unexperienced");
  assert.equal(result.relevantRunCount, 0);
});

test("heavy-track adjustment compares the same horse against its good-track baseline", () => {
  const result = buildGoingAdjustment(horse([
    run({ trackCondition: "重", margin: 0, finishPosition: 1 }),
    run({ trackCondition: "不良", margin: 0.2, finishPosition: 2 }),
    run({ trackCondition: "重", margin: 0.3, finishPosition: 2 }),
    run({ trackCondition: "良", margin: 1.8, finishPosition: 10 }),
    run({ trackCondition: "良", margin: 1.4, finishPosition: 8 }),
    run({ trackCondition: "良", margin: 1.2, finishPosition: 7 }),
  ]), { surface: "芝", going: "不良" });

  assert.equal(result.adjustment, 2);
  assert.equal(result.status, "active");
  assert.equal(result.relevantRunCount, 3);
  assert.equal(result.shrinkFactor, 0.65);
});

test("turf and dirt evidence never mix", () => {
  const result = buildGoingAdjustment(horse([
    run({ surface: "ダ", trackCondition: "重", margin: 0, finishPosition: 1 }),
    run({ surface: "ダ", trackCondition: "不良", margin: 0.1, finishPosition: 1 }),
    run({ surface: "芝", trackCondition: "良", margin: 1.1, finishPosition: 7 }),
  ]), { surface: "芝", going: "重" });

  assert.equal(result.adjustment, 0);
  assert.equal(result.status, "unexperienced");
  assert.equal(result.relevantRunCount, 0);
});

test("sample shrinkage is monotonic and never implemented as a score cap", () => {
  assert.deepEqual(
    [0, 1, 2, 3, 4, 6].map(shrinkFactorFor),
    [0, 0.25, 0.45, 0.65, 0.8, 1],
  );

  const moderate = buildGoingAdjustment(horse([
    run({ trackCondition: "重", margin: 0.4, finishPosition: 3 }),
    run({ trackCondition: "重", margin: 0.5, finishPosition: 4 }),
    run({ trackCondition: "重", margin: 0.5, finishPosition: 4 }),
    run({ trackCondition: "良", margin: 1, finishPosition: 6 }),
    run({ trackCondition: "良", margin: 1.1, finishPosition: 7 }),
  ]), { surface: "芝", going: "重" });
  const strong = buildGoingAdjustment(horse([
    run({ trackCondition: "重", margin: 0, finishPosition: 1 }),
    run({ trackCondition: "重", margin: 0.1, finishPosition: 1 }),
    run({ trackCondition: "重", margin: 0.2, finishPosition: 2 }),
    run({ trackCondition: "良", margin: 1.8, finishPosition: 10 }),
    run({ trackCondition: "良", margin: 1.6, finishPosition: 9 }),
  ]), { surface: "芝", going: "重" });

  assert.ok(strong.rawDifference > moderate.rawDifference);
  assert.ok(strong.adjustment >= moderate.adjustment);
  assert.ok(Math.abs(strong.adjustment) <= 2);
});
