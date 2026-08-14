import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPaceAnalysis,
  buildRacePaceScenario,
  classifyRunningStyle,
  scorePace,
} from "../pace-ai.mjs";

const horse = (name, positions, fieldSize = 12) => ({
  horseName: name,
  pastRuns: positions.map((position) => ({ passingOrder: [position], fieldSize, last3F: 34.5 })),
});

test("running style is derived from recent normalized passing positions", () => {
  assert.equal(classifyRunningStyle(horse("逃げ", [1, 1, 2, 1])), "逃げ");
  assert.equal(classifyRunningStyle(horse("先行", [2, 3, 4, 3])), "先行");
  assert.equal(classifyRunningStyle(horse("差し", [5, 6, 7, 6])), "差し");
  assert.equal(classifyRunningStyle(horse("追込", [10, 11, 12, 10])), "追込");
});

test("multiple escape and front runners produce a high pace scenario", () => {
  const runners = [
    horse("逃げ1", [1, 1, 2]),
    horse("逃げ2", [1, 2, 1]),
    horse("逃げ3", [1, 1, 1]),
    horse("先行1", [2, 3, 4]),
    horse("先行2", [3, 3, 4]),
    horse("先行3", [4, 3, 2]),
    horse("先行4", [3, 4, 4]),
    horse("差し", [6, 7, 8]),
  ];
  const scenario = buildRacePaceScenario(runners);
  assert.equal(scenario.expectedPace, "ハイ");
  assert.equal(scenario.counts["逃げ"], 3);
  assert.equal(scenario.counts["先行"], 4);
  assert.match(scenario.reason, /逃げ候補3頭・先行候補4頭/);
});

test("a race without an escape candidate and few front runners is slow", () => {
  const runners = [
    horse("先行1", [2, 3, 4]),
    horse("先行2", [3, 4, 4]),
    horse("差し1", [6, 7, 8]),
    horse("差し2", [7, 8, 6]),
    horse("追込", [10, 11, 12]),
  ];
  assert.equal(buildRacePaceScenario(runners).expectedPace, "スロー");
});

test("a lone escape candidate without early pressure is slow", () => {
  const runners = [
    horse("逃げ", [1, 1, 2]),
    horse("先行", [3, 4, 4]),
    horse("差し1", [6, 7, 8]),
    horse("差し2", [7, 8, 6]),
    horse("追込", [10, 11, 12]),
  ];
  assert.equal(buildRacePaceScenario(runners).expectedPace, "スロー");
});

test("pace fit reverses between a high and slow scenario", () => {
  const front = horse("先行", [2, 3, 4, 3]);
  const closer = horse("追込", [10, 11, 12, 10]);
  const highContext = { paceScenario: { expectedPace: "ハイ", confidence: "high" } };
  const slowContext = { paceScenario: { expectedPace: "スロー", confidence: "high" } };

  assert.ok(scorePace(closer, highContext) > scorePace(closer, slowContext));
  assert.ok(scorePace(front, slowContext) > scorePace(front, highContext));
});

test("pace analysis publishes field-level evidence", () => {
  const target = horse("差し", [5, 6, 7, 6]);
  const context = {
    paceScenario: {
      expectedPace: "ハイ",
      confidence: "high",
      reason: "逃げ候補3頭・先行候補4頭からハイ想定",
    },
  };
  const analysis = buildPaceAnalysis(target, context);
  assert.equal(analysis.expectedPace, "ハイ");
  assert.equal(analysis.scenarioFitAdjustment, 4);
  assert.ok(analysis.strengths.some((item) => item.includes("逃げ候補3頭")));
});
