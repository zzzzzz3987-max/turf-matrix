// Value AI v1 deterministic odds-value scoring.
// Runs only from normalized odds data; no dummy odds or guessed popularity.

const clamp = (value, min = 35, max = 96) => Math.max(min, Math.min(max, Math.round(value)));

const scoreValue = (horse, abilityScore) => {
  if (!horse.odds?.winOdds || !horse.odds?.popularity) return 50;
  const popularity = horse.odds.popularity;
  const odds = horse.odds.winOdds;
  const gapBonus = (abilityScore - 65) * 0.45 + Math.max(0, popularity - 4) * 2.2;
  const longOddsRisk = odds > 50 ? (odds - 50) * 0.18 : 0;
  return clamp(52 + gapBonus - longOddsRisk);
};

export { scoreValue };

