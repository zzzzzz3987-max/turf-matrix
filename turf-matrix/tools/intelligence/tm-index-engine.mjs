const clamp = (value, min = 45, max = 92) => Math.max(min, Math.min(max, Math.round(value)));

const BASE_WEIGHTS = {
  ability: 0.27,
  form: 0.2,
  distance: 0.12,
  course: 0.1,
  training: 0.12,
  blood: 0.1,
  pace: 0.03,
};

const GRADE_WEIGHTS = {
  ...BASE_WEIGHTS,
  ability: 0.25,
  form: 0.2,
  training: 0.13,
  blood: 0.12,
};

const SPECIAL_WEIGHTS = {
  ...BASE_WEIGHTS,
  ability: 0.29,
  form: 0.2,
  course: 0.11,
  blood: 0.08,
};

// Frozen from publication snapshots through 2026-08-08 (45 races / 545 runners).
// Only engines whose observed dispersion materially exceeded Ability/Form are calibrated.
const DISPERSION_BASIS = {
  "芝": {
    course: { mean: 69.44, sourceSd: 9.84, targetSd: 6.89 },
    training: { mean: 66.16, sourceSd: 8.96, targetSd: 6.89 },
    pace: { mean: 72.04, sourceSd: 6.67, targetSd: 6.89 },
  },
  "ダ": {
    course: { mean: 69.70, sourceSd: 9.52, targetSd: 6.85 },
    training: { mean: 67.25, sourceSd: 7.56, targetSd: 6.85 },
    pace: { mean: 71.25, sourceSd: 7.56, targetSd: 6.85 },
  },
};

const normalizeSurface = (value) => String(value ?? "").startsWith("ダ") ? "ダ" : value;

const calibrateIndexScores = (scores, context = null) => {
  const basis = DISPERSION_BASIS[normalizeSurface(context?.surface)];
  if (!basis) return { ...scores };
  return Object.fromEntries(Object.entries(scores).map(([key, score]) => {
    const stats = basis[key];
    if (!stats || !Number.isFinite(score) || !stats.sourceSd) return [key, score];
    const calibrated = stats.mean + (score - stats.mean) * (stats.targetSd / stats.sourceSd);
    return [key, calibrated];
  }));
};

const weightsFor = (context) => {
  if (context?.category === "grade") return GRADE_WEIGHTS;
  if (context?.category === "special") return SPECIAL_WEIGHTS;
  return BASE_WEIGHTS;
};

const calculateTmIndex = (scores, context = null) => {
  const weights = weightsFor(context);
  const effectiveScores = calibrateIndexScores(scores, context);
  const available = Object.entries(weights).filter(([key]) => Number.isFinite(effectiveScores[key]));
  const totalWeight = available.reduce((sum, [, weight]) => sum + weight, 0);
  if (!totalWeight) return null;
  const weighted = available.reduce((sum, [key, weight]) => sum + effectiveScores[key] * weight, 0) / totalWeight;
  return clamp(weighted + 8);
};

const buildIndexContributions = (scores, context = null) => {
  const weights = weightsFor(context);
  const effectiveScores = calibrateIndexScores(scores, context);
  return Object.entries(weights)
    .filter(([key]) => Number.isFinite(effectiveScores[key]))
    .map(([key, weight]) => ({
      key,
      score: scores[key],
      effectiveScore: Math.round(effectiveScores[key] * 10) / 10,
      weight,
      contribution: Math.round(effectiveScores[key] * weight * 10) / 10,
    }))
    .sort((a, b) => b.contribution - a.contribution);
};

export { DISPERSION_BASIS, calculateTmIndex, buildIndexContributions, calibrateIndexScores, weightsFor };
