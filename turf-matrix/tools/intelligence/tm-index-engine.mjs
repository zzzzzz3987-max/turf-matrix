const clamp = (value, min = 45, max = 92) => Math.max(min, Math.min(max, Math.round(value)));

const WEIGHTS = {
  ability: 0.28,
  form: 0.18,
  distance: 0.13,
  course: 0.1,
  training: 0.12,
  blood: 0.09,
  value: 0.07,
  pace: 0.03,
};

const calculateTmIndex = (scores) => {
  const available = Object.entries(WEIGHTS).filter(([key]) => Number.isFinite(scores[key]));
  const totalWeight = available.reduce((sum, [, weight]) => sum + weight, 0);
  if (!totalWeight) return null;
  const weighted = available.reduce((sum, [key, weight]) => sum + scores[key] * weight, 0) / totalWeight;
  return clamp(weighted + 8);
};

export { calculateTmIndex };
