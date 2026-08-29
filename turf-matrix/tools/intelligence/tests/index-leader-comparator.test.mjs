import test from "node:test";
import assert from "node:assert/strict";
import {
  INDEX_LEADER_COMPARATOR_CONFIG,
  INDEX_LEADER_FACTORS,
  applyIndexLeaderComparator,
  buildComparisonInput,
  buildStandardizer,
  trainIndexLeaderComparator,
} from "../../analyze/lib/index-leader-comparator.mjs";

const horse = (tmIndex, scores) => ({
  tmIndex,
  analysis: {
    factorsDetail: Object.fromEntries(INDEX_LEADER_FACTORS.map((key, index) => [
      key,
      { score: scores[index] },
    ])),
  },
});

const trainingRows = [
  { ...buildComparisonInput(horse(80, [80, 70, 72, 68, 70, 66, 64]), horse(79, [84, 75, 78, 72, 74, 70, 68])), secondAhead: 1 },
  { ...buildComparisonInput(horse(81, [82, 78, 76, 74, 72, 70, 68]), horse(80, [78, 74, 72, 70, 68, 66, 64])), secondAhead: 0 },
  { ...buildComparisonInput(horse(79, [76, 74, 70, 72, 69, 68, 65]), horse(79, [80, 78, 76, 75, 74, 72, 70])), secondAhead: 1 },
  { ...buildComparisonInput(horse(82, [84, 82, 80, 78, 76, 74, 72]), horse(80, [78, 76, 74, 72, 70, 68, 66])), secondAhead: 0 },
];

test("index leader comparator never accepts market inputs", () => {
  assert.deepEqual(INDEX_LEADER_FACTORS, ["ability", "form", "training", "course", "pace", "blood", "stable"]);
  assert.equal(INDEX_LEADER_FACTORS.includes("value"), false);
  assert.equal(INDEX_LEADER_FACTORS.includes("odds"), false);
  assert.equal(INDEX_LEADER_FACTORS.includes("popularity"), false);
});

test("three-point index leads are protected from shadow swaps", () => {
  const standardizer = buildStandardizer(trainingRows);
  const model = trainIndexLeaderComparator(trainingRows, standardizer);
  const row = {
    ...buildComparisonInput(
      horse(82, [70, 70, 70, 70, 70, 70, 70]),
      horse(79, [99, 99, 99, 99, 99, 99, 99]),
    ),
  };
  const result = applyIndexLeaderComparator([row], model, standardizer)[0];
  assert.equal(row.gap, 3);
  assert.equal(result.probability, null);
  assert.equal(result.swap, false);
});

test("training and predictions are deterministic for identical inputs", () => {
  const standardizer = buildStandardizer(trainingRows);
  const firstModel = trainIndexLeaderComparator(trainingRows, standardizer);
  const secondModel = trainIndexLeaderComparator(trainingRows, standardizer);
  assert.deepEqual(firstModel, secondModel);

  const row = buildComparisonInput(
    horse(80, [80, 76, 74, 72, 70, 68, 66]),
    horse(79, [83, 80, 78, 75, 74, 72, 70]),
  );
  assert.deepEqual(
    applyIndexLeaderComparator([row], firstModel, standardizer),
    applyIndexLeaderComparator([row], secondModel, standardizer),
  );
  assert.equal(INDEX_LEADER_COMPARATOR_CONFIG.swapProbability, 0.6);
});
