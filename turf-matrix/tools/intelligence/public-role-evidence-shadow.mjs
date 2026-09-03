import {
  rankPaceRoleCandidates,
  selectPublicRolePaceShadow,
} from "./public-role-pace-shadow.mjs";

const finite = (value) => typeof value === "number" && Number.isFinite(value);
const rounded = (value) => Math.round(value * 100) / 100;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const detail = (horse, key) => horse?.analysis?.factorsDetail?.[key] ?? {};
const scoreOf = (horse, key) => detail(horse, key).score;
const adjustmentOf = (value) => finite(value) ? value : 0;

const weightedScore = (entries) => {
  const usable = entries.filter(([value]) => finite(value));
  const weight = usable.reduce((sum, [, itemWeight]) => sum + itemWeight, 0);
  return weight
    ? rounded(usable.reduce((sum, [value, itemWeight]) => sum + value * itemWeight, 0) / weight)
    : null;
};

const abilityComponent = (horse, key) => detail(horse, "ability")?.components
  ?.find((component) => component.key === key)?.score;

const distanceAdjustment = (horse, key) => adjustmentOf(detail(horse, "distance")?.components?.[key]?.adjustment);

const conditionEvidence = (candidate) => {
  const horse = candidate.horse;
  const pace = detail(horse, "pace");
  const load = detail(horse, "load");
  const trackBias = detail(horse, "trackBias");
  const going = horse?.analysis?.goingAnalysis ?? {};
  const distanceDirection = distanceAdjustment(horse, "direction");
  const distanceTransition = distanceAdjustment(horse, "transition");
  const distanceCadence = distanceAdjustment(horse, "cadence");
  const currentPaceFit = adjustmentOf(pace?.contextFit?.adjustment);
  const opponentQuality = abilityComponent(horse, "opponentCareer");

  const foundationScore = weightedScore([
    [scoreOf(horse, "ability"), 0.38],
    [scoreOf(horse, "form"), 0.27],
    [scoreOf(horse, "training"), 0.20],
    [scoreOf(horse, "blood"), 0.10],
    [scoreOf(horse, "stable"), 0.05],
  ]);
  const conditionScore = weightedScore([
    [scoreOf(horse, "distance"), 0.32],
    [scoreOf(horse, "course"), 0.23],
    [scoreOf(horse, "pace"), 0.22],
    [scoreOf(horse, "load"), 0.11],
    [scoreOf(horse, "trackBias"), 0.12],
  ]);
  const qualityScore = weightedScore([
    [foundationScore, 0.58],
    [conditionScore, 0.42],
  ]);

  const supports = [];
  const risks = [];
  const protections = [];
  const add = (collection, key, label, severity = 1) => collection.push({ key, label, severity });

  if (scoreOf(horse, "ability") >= 72) add(supports, "ability", "地力上位");
  if (scoreOf(horse, "form") >= 68) add(supports, "form", "近走内容良好");
  if (scoreOf(horse, "training") >= 68) add(supports, "training", "調教良好");
  if (scoreOf(horse, "distance") >= 70 && distanceDirection >= 0 && distanceTransition >= 0) add(supports, "distance", "今回距離に対応");
  if (adjustmentOf(load.adjustment) > 0) add(supports, "load", "斤量実績あり");
  if (adjustmentOf(trackBias.adjustment) > 0) add(supports, "trackBias", "馬場傾向が味方");
  if (adjustmentOf(going.adjustment) > 0) add(supports, "going", "今回馬場が合う");
  if (candidate.paceProfile.adjustment > 0) add(supports, "paceHistory", "過去に展開へ逆らった走り");
  if (currentPaceFit > 0) add(supports, "paceFit", "今回展開が合う");

  if (scoreOf(horse, "ability") < 64) add(risks, "ability", "地力評価が低い", 2);
  if (scoreOf(horse, "form") < 64) add(risks, "form", "近走内容が弱い");
  if (scoreOf(horse, "training") < 64) add(risks, "training", "調教評価が低い");
  if (scoreOf(horse, "distance") < 60 || distanceDirection <= -2 || distanceTransition <= -2) {
    add(risks, "distance", "距離条件に不安", 2);
  }
  if (distanceCadence <= -2) add(risks, "cadence", "根幹・非根幹の適性に不安");
  if (adjustmentOf(load.adjustment) < 0) add(risks, "load", "斤量条件に不安");
  if (adjustmentOf(trackBias.adjustment) < 0) add(risks, "trackBias", "馬場傾向と不一致");
  if (adjustmentOf(going.adjustment) < 0) add(risks, "going", "今回馬場に不安");
  if (candidate.paceProfile.adjustment < 0) add(risks, "paceHistory", "過去好走に展開利");
  if (currentPaceFit < 0) add(risks, "paceFit", "今回展開と不一致");

  if (finite(opponentQuality) && opponentQuality >= 68) add(protections, "opponent", "強い相手との実績");
  if (candidate.paceProfile.adjustment > 0) add(protections, "paceHistory", "逆展開でも崩れにくい");
  if (distanceDirection >= 2 || distanceTransition >= 2) add(protections, "distance", "距離変更への実績");
  if (detail(horse, "load")?.tolerance?.adjustment > 0) add(protections, "load", "重い斤量を克服済み");

  return {
    foundationScore,
    conditionScore,
    qualityScore,
    supports,
    risks,
    protections,
    riskPoints: risks.reduce((sum, item) => sum + item.severity, 0),
    protectionPoints: protections.reduce((sum, item) => sum + item.severity, 0),
    components: {
      opponentQuality: finite(opponentQuality) ? opponentQuality : null,
      distanceDirection,
      distanceTransition,
      distanceCadence,
      load: adjustmentOf(load.adjustment),
      trackBias: adjustmentOf(trackBias.adjustment),
      going: adjustmentOf(going.adjustment),
      historicalPace: candidate.paceProfile.adjustment,
      currentPaceFit,
    },
  };
};

const evidenceRoleCandidate = (candidate) => {
  const condition = conditionEvidence(candidate);
  const historicalPaceTieBreak = clamp(candidate.paceProfile.adjustment * 0.75, -1.5, 1.5);
  return {
    ...candidate,
    condition,
    evidenceRoleQuality: rounded((condition.qualityScore ?? candidate.score) + historicalPaceTieBreak),
  };
};

const rankEvidenceRoleCandidates = (race, history) => rankPaceRoleCandidates(race, history)
  .map(evidenceRoleCandidate);

const isEvidenceValueCandidate = (candidate) =>
  candidate.rank >= 3 && candidate.rank <= 5 &&
  candidate.valueEligible && finite(candidate.marketGap) && candidate.marketGap >= 2 &&
  finite(candidate.condition.qualityScore) && candidate.condition.qualityScore >= 68 &&
  (!finite(candidate.ability) || candidate.ability >= 66) &&
  candidate.condition.supports.length >= 2 &&
  candidate.condition.riskPoints <= 1;

const selectEvidenceValueCandidate = (candidates) => candidates
  .filter(isEvidenceValueCandidate)
  .sort((left, right) =>
    right.evidenceRoleQuality - left.evidenceRoleQuality ||
    right.condition.supports.length - left.condition.supports.length ||
    right.marketGap - left.marketGap ||
    right.score - left.score ||
    (left.horse.number ?? 999) - (right.horse.number ?? 999)
  )[0] ?? null;

const dangerStrength = (candidate) => {
  const popularity = candidate.horse.popularity;
  const rankGap = candidate.rank - popularity;
  return rounded(
    rankGap * 4 +
    candidate.leaderGap +
    candidate.condition.riskPoints * 2 -
    candidate.condition.protectionPoints * 2 -
    Math.max(0, candidate.condition.supports.length - 2) * 0.5
  );
};

const isEvidenceDangerCandidate = (candidate) => {
  const popularity = candidate.horse.popularity;
  if (!finite(popularity) || popularity > 4) return false;
  const rankGap = candidate.rank - popularity;
  if (rankGap < 2) return false;
  if (rankGap < 3 && candidate.condition.riskPoints < 2) return false;
  if (candidate.condition.protectionPoints > candidate.condition.riskPoints) return false;
  return candidate.dangerStrength >= 10;
};

const selectEvidenceDangerCandidate = (candidates) => candidates
  .map((candidate) => ({ ...candidate, dangerStrength: dangerStrength(candidate) }))
  .filter(isEvidenceDangerCandidate)
  .sort((left, right) =>
    right.dangerStrength - left.dangerStrength ||
    right.condition.riskPoints - left.condition.riskPoints ||
    right.leaderGap - left.leaderGap ||
    (left.horse.number ?? 999) - (right.horse.number ?? 999)
  )[0] ?? null;

const compactEvidence = (candidate) => candidate ? {
  horse: candidate.horse,
  indexRank: candidate.rank,
  tmIndex: candidate.score,
  marketGap: candidate.marketGap,
  evidenceRoleQuality: candidate.evidenceRoleQuality,
  dangerStrength: candidate.dangerStrength ?? null,
  foundationScore: candidate.condition.foundationScore,
  conditionScore: candidate.condition.conditionScore,
  qualityScore: candidate.condition.qualityScore,
  supports: candidate.condition.supports,
  risks: candidate.condition.risks,
  protections: candidate.condition.protections,
  riskPoints: candidate.condition.riskPoints,
  protectionPoints: candidate.condition.protectionPoints,
  components: candidate.condition.components,
} : null;

const selectPublicRoleEvidenceShadow = (race, history) => {
  const paceSelection = selectPublicRolePaceShadow(race, history);
  const candidates = rankEvidenceRoleCandidates(race, history);
  const evidenceValue = selectEvidenceValueCandidate(candidates);
  const evidenceDanger = selectEvidenceDangerCandidate(candidates);
  return {
    productionValue: paceSelection.productionValue,
    paceValue: paceSelection.paceValue,
    evidenceValue: evidenceValue?.horse ?? null,
    productionDanger: paceSelection.productionDanger,
    paceDanger: paceSelection.paceDanger,
    evidenceDanger: evidenceDanger?.horse ?? null,
    evidence: {
      value: compactEvidence(evidenceValue),
      danger: compactEvidence(evidenceDanger),
    },
    policy: {
      currentRaceResultUsed: false,
      futureRaceShapeAllowed: false,
      marketUsedForEligibilityAndFinalTieBreakOnly: true,
      evUsedForRanking: false,
      abstentionAllowed: true,
      productionConnected: false,
      tmIndexChanged: false,
    },
  };
};

export {
  conditionEvidence,
  dangerStrength,
  evidenceRoleCandidate,
  isEvidenceDangerCandidate,
  isEvidenceValueCandidate,
  rankEvidenceRoleCandidates,
  selectPublicRoleEvidenceShadow,
};
