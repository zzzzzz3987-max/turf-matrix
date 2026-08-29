export const INDEX_LEADER_FACTORS = [
  "ability",
  "form",
  "training",
  "course",
  "pace",
  "blood",
  "stable",
];

export const INDEX_LEADER_COMPARATOR_CONFIG = Object.freeze({
  modelVersion: "index-leader-comparator-v0.1-shadow",
  maxGapToReview: 2,
  swapProbability: 0.6,
  ridgeLambda: 0.2,
  iterations: 3000,
  learningRate: 0.08,
});

const mean = (values) => values.length
  ? values.reduce((sum, value) => sum + value, 0) / values.length
  : 0;

const standardDeviation = (values) => {
  if (!values.length) return 1;
  const average = mean(values);
  const result = Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length);
  return result || 1;
};

const sigmoid = (value) => value >= 0
  ? 1 / (1 + Math.exp(-value))
  : Math.exp(value) / (1 + Math.exp(value));

export const isFiniteScore = (value) =>
  value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));

export const factorScore = (horse, key) => {
  const value = horse?.analysis?.factorsDetail?.[key]?.score;
  return isFiniteScore(value) ? Number(value) : null;
};

export const buildComparisonInput = (leader, second) => {
  const featureDeltas = Object.fromEntries(INDEX_LEADER_FACTORS.map((key) => [
    key,
    isFiniteScore(factorScore(leader, key)) && isFiniteScore(factorScore(second, key))
      ? factorScore(second, key) - factorScore(leader, key)
      : null,
  ]));
  const gap = Number(leader?.tmIndex) - Number(second?.tmIndex);
  return {
    gap,
    featureDeltas,
    complete: Number.isFinite(gap) && INDEX_LEADER_FACTORS.every((key) => isFiniteScore(featureDeltas[key])),
  };
};

export const buildStandardizer = (rows) => {
  if (!rows.length) throw new Error("Index leader comparator requires at least one training row");
  return Object.fromEntries([
    ...INDEX_LEADER_FACTORS.map((key) => {
      const values = rows.map((row) => Number(row.featureDeltas[key]));
      return [key, { mean: mean(values), sd: standardDeviation(values) }];
    }),
    ["gap", {
      mean: mean(rows.map((row) => Number(row.gap))),
      sd: standardDeviation(rows.map((row) => Number(row.gap))),
    }],
  ]);
};

const vectorFor = (row, standardizer) => [
  ...INDEX_LEADER_FACTORS.map((key) =>
    (row.featureDeltas[key] - standardizer[key].mean) / standardizer[key].sd),
  (row.gap - standardizer.gap.mean) / standardizer.gap.sd,
];

export const trainIndexLeaderComparator = (rows, standardizer = buildStandardizer(rows)) => {
  const { ridgeLambda, iterations, learningRate } = INDEX_LEADER_COMPARATOR_CONFIG;
  const dimensions = INDEX_LEADER_FACTORS.length + 1;
  const weights = Array(dimensions).fill(0);
  let intercept = 0;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const gradient = Array(dimensions).fill(0);
    let interceptGradient = 0;
    for (const row of rows) {
      const vector = vectorFor(row, standardizer);
      const prediction = sigmoid(intercept + vector.reduce(
        (sum, value, index) => sum + value * weights[index],
        0,
      ));
      const error = prediction - row.secondAhead;
      interceptGradient += error;
      vector.forEach((value, index) => { gradient[index] += error * value; });
    }
    intercept -= learningRate * interceptGradient / rows.length;
    weights.forEach((weight, index) => {
      const regularized = gradient[index] / rows.length + ridgeLambda * weight;
      weights[index] -= learningRate * regularized;
    });
  }

  return { intercept, weights };
};

export const comparisonProbability = (row, model, standardizer) => {
  if (!row.complete || row.gap > INDEX_LEADER_COMPARATOR_CONFIG.maxGapToReview) return null;
  const vector = vectorFor(row, standardizer);
  return sigmoid(model.intercept + vector.reduce(
    (sum, value, index) => sum + value * model.weights[index],
    0,
  ));
};

export const applyIndexLeaderComparator = (rows, model, standardizer) => rows.map((row) => {
  const probability = comparisonProbability(row, model, standardizer);
  const swap = probability !== null
    && probability >= INDEX_LEADER_COMPARATOR_CONFIG.swapProbability;
  return { ...row, probability, swap, selected: swap ? row.second : row.leader };
});
