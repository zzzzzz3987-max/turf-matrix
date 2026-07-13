// Support AI v1 deterministic auxiliary scoring.

const clamp = (value, min = 35, max = 96) => Math.max(min, Math.min(max, Math.round(value)));

const scoreStable = (horse) => clamp(58 + (horse.trainer ? 6 : 0) + (horse.dataStatus?.training === "active" ? 6 : 0));

const frameScore = (number) => {
  if (number <= 4) return 68;
  if (number <= 10) return 64;
  if (number <= 14) return 60;
  return 58;
};

export { scoreStable, frameScore };
