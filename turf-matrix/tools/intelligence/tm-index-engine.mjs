const clamp = (value, min = 45, max = 92) => Math.max(min, Math.min(max, Math.round(value)));

const BASE_WEIGHTS = {
  ability: 0.27,
  form: 0.2,
  distance: 0.12,
  course: 0.1,
  training: 0.12,
  blood: 0.1,
  value: 0.06,
  pace: 0.03,
};

const GRADE_WEIGHTS = {
  ...BASE_WEIGHTS,
  ability: 0.25,
  form: 0.2,
  training: 0.13,
  blood: 0.12,
  value: 0.05,
};

const SPECIAL_WEIGHTS = {
  ...BASE_WEIGHTS,
  ability: 0.29,
  form: 0.2,
  course: 0.11,
  blood: 0.08,
  value: 0.07,
};

const weightsFor = (context) => {
  if (context?.category === "grade") return GRADE_WEIGHTS;
  if (context?.category === "special") return SPECIAL_WEIGHTS;
  return BASE_WEIGHTS;
};

const calculateTmIndex = (scores, context = null) => {
  const weights = weightsFor(context);
  const available = Object.entries(weights).filter(([key]) => Number.isFinite(scores[key]));
  const totalWeight = available.reduce((sum, [, weight]) => sum + weight, 0);
  if (!totalWeight) return null;
  const weighted = available.reduce((sum, [key, weight]) => sum + scores[key] * weight, 0) / totalWeight;
  return clamp(weighted + 8);
};

const buildIndexContributions = (scores, context = null) => {
  const weights = weightsFor(context);
  return Object.entries(weights)
    .filter(([key]) => Number.isFinite(scores[key]))
    .map(([key, weight]) => ({
      key,
      score: scores[key],
      weight,
      contribution: Math.round(scores[key] * weight * 10) / 10,
    }))
    .sort((a, b) => b.contribution - a.contribution);
};

export { calculateTmIndex, buildIndexContributions, weightsFor };
