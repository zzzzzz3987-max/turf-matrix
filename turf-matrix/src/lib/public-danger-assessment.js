import { rankPublicRoleHorses } from "./public-role-selection.js";

const finite = (value) => typeof value === "number" && Number.isFinite(value);
const observed = (factor) => factor?.status === "active" && factor.indexEligible !== false;
const usableScore = (factor) => observed(factor) && finite(factor.score);

// Candidate policy only. Historical results and the live selector remain unchanged.
export const DANGER_ASSESSMENT_VERSION = "evidence-gate-v1-shadow";

export const assessPublicDangerCandidates = (race) => {
  const ranked = rankPublicRoleHorses(race);
  return ranked.map((candidate) => {
    const { horse } = candidate;
    const factors = horse.analysis?.factorsDetail ?? {};
    const risks = [];
    const protections = [];
    const add = (key, group, label) => risks.push({ key, group, label });
    const low = (key, threshold) => usableScore(factors[key]) && factors[key].score < threshold;
    if (low("ability", 64)) add("ability", "performance", "能力評価が低め");
    if (low("form", 64)) add("form", "performance", "近走内容に不安");
    if (low("training", 64)) add("training", "training", "調教評価が低め");
    if (low("distance", 60)) add("distance", "suitability", "今回距離への適性に不安");
    if (low("course", 60)) add("course", "suitability", "今回コースへの適性に不安");
    const going = horse.analysis?.goingAnalysis;
    if (observed(going) && finite(going.adjustment) && going.adjustment <= -2 && going.relevantRunCount >= 2) {
      add("going", "suitability", "今回の馬場で過去実績が低下");
    }
    const pace = factors.pace?.contextFit;
    if (observed(factors.pace) && observed(pace) && pace.scenarioConfidence === "high" &&
        finite(pace.adjustment) && pace.adjustment <= -2) {
      add("pace", "raceShape", "想定展開との相性に不安");
    }
    const bias = factors.trackBias;
    if (observed(bias) && bias.scoringMode !== "shadow" && finite(bias.adjustment) && bias.adjustment <= -2) {
      add("trackBias", "raceShape", "確認済みの馬場傾向と不一致");
    }
    const ability = factors.ability;
    const abilityRank = usableScore(ability)
      ? 1 + ranked.filter(({ horse: other }) => {
        const otherAbility = other.analysis?.factorsDetail?.ability;
        return usableScore(otherAbility) && otherAbility.score > ability.score;
      }).length : null;
    if (usableScore(ability) && ability.score >= 72 && abilityRank <= 3) protections.push("能力上位");
    const opponent = Array.isArray(ability?.components)
      ? ability.components.find((component) => component.key === "opponentCareer") : null;
    if (observed(ability) && usableScore(opponent) && opponent.score >= 68) protections.push("強い相手との実績");

    const validMarket = Number.isInteger(horse.popularity) && horse.popularity >= 1 && horse.popularity <= 4 &&
      finite(horse.odds) && horse.odds > 1;
    const rankGap = validMarket ? candidate.competitionRank - horse.popularity : null;
    const marketMismatch = validMarket && rankGap >= 3;
    const groups = [...new Set(risks.map((risk) => risk.group))];
    // Ability/form and distance/course/going share evidence; don't count them twice.
    const groundedRisk = groups.some((group) => ["performance", "suitability"].includes(group));
    const eligible = marketMismatch && candidate.leaderGap >= 3 && groups.length >= 2 &&
      groundedRisk && protections.length === 0;
    const reasons = [];
    if (!validMarket) reasons.push("market_unavailable");
    else if (!marketMismatch) reasons.push("no_rank_mismatch");
    if (marketMismatch && candidate.leaderGap < 3) reasons.push("close_scores");
    if (marketMismatch && (groups.length < 2 || !groundedRisk)) reasons.push("insufficient_independent_evidence");
    if (marketMismatch && protections.length) reasons.push("positive_evidence");
    return { ...candidate, rankGap, abilityRank, risks, riskGroups: groups, protections, reasons,
      classification: eligible ? "danger" : marketMismatch ? "market_mismatch" : "none" };
  });
};

export const selectPublicDangerEvidenceHorse = (race) => assessPublicDangerCandidates(race)
  .filter((candidate) => candidate.classification === "danger")
  .sort((left, right) => right.riskGroups.length - left.riskGroups.length ||
    right.rankGap - left.rankGap || right.leaderGap - left.leaderGap ||
    (left.horse.number ?? 999) - (right.horse.number ?? 999))[0]?.horse ?? null;
