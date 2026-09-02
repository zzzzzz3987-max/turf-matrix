const finite = (value) => typeof value === "number" && Number.isFinite(value);
const round = (value, digits = 1) => finite(value) ? Number(value.toFixed(digits)) : null;
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

export const BATTLE_MIN_INDEX = 80;
export const BATTLE_MIN_GAP = 3;
export const BATTLE_SHADOW_RULE_VERSION = "battle-readiness-v1";

const factorScore = (horse, key) => {
  const detail = horse?.analysis?.factorsDetail?.[key]?.score;
  if (finite(detail)) return detail;
  const factor = horse?.analysis?.factors?.[key];
  return finite(factor) ? factor : null;
};

const weightedAverage = (entries) => {
  const available = entries.filter(({ value }) => finite(value));
  const totalWeight = available.reduce((sum, entry) => sum + entry.weight, 0);
  return totalWeight
    ? available.reduce((sum, entry) => sum + entry.value * entry.weight, 0) / totalWeight
    : null;
};

export const isBattleRaceEligible = (race) =>
  race?.category !== "race"
  && race?.indexTop?.tmIndex >= BATTLE_MIN_INDEX
  && race?.indexGap >= BATTLE_MIN_GAP
  && race?.topConfidence !== "low";

export const buildBattleReadiness = ({ indexTop, indexSecond, evidenceProfile, indexGap }) => {
  const axisCore = weightedAverage([
    { value: factorScore(indexTop, "ability"), weight: 0.35 },
    { value: factorScore(indexTop, "form"), weight: 0.25 },
    { value: factorScore(indexTop, "training"), weight: 0.2 },
    { value: factorScore(indexTop, "pace"), weight: 0.2 },
  ]);
  const conditionFit = weightedAverage([
    { value: factorScore(indexTop, "distance"), weight: 0.5 },
    { value: factorScore(indexTop, "course"), weight: 0.5 },
  ]);
  const opponentDepth = weightedAverage([
    { value: indexSecond?.tmIndex, weight: 0.55 },
    { value: evidenceProfile?.score, weight: 0.45 },
  ]);
  const gapStrength = finite(indexGap) ? clamp(50 + indexGap * 6, 50, 92) : null;
  const readiness = weightedAverage([
    { value: indexTop?.tmIndex, weight: 0.35 },
    { value: gapStrength, weight: 0.2 },
    { value: axisCore, weight: 0.2 },
    { value: conditionFit, weight: 0.1 },
    { value: opponentDepth, weight: 0.15 },
  ]);
  const available = [axisCore, conditionFit, opponentDepth, gapStrength].filter(finite).length;

  return {
    ruleVersion: BATTLE_SHADOW_RULE_VERSION,
    score: round(readiness),
    coverage: round(available / 4, 2),
    components: {
      axisIndex: round(indexTop?.tmIndex),
      indexGap: round(indexGap),
      gapStrength: round(gapStrength),
      axisCore: round(axisCore),
      conditionFit: round(conditionFit),
      opponentDepth: round(opponentDepth),
    },
  };
};

const baselineOrder = (left, right) =>
  right.indexGap - left.indexGap
  || right.indexTop.tmIndex - left.indexTop.tmIndex
  || String(left.time ?? "").localeCompare(String(right.time ?? ""));

export const selectBattleRace = (signals) => signals
  .filter(isBattleRaceEligible)
  .sort(baselineOrder)[0] ?? null;

export const selectBattleRaceShadow = (signals) => signals
  .filter(isBattleRaceEligible)
  .filter((race) => finite(race.battleProfile?.score) && race.battleProfile.coverage >= 0.75)
  .sort((left, right) => right.battleProfile.score - left.battleProfile.score || baselineOrder(left, right))[0] ?? null;
