import {
  publicRoleEvidenceScore,
  rankPublicRoleHorses,
  selectPublicDangerHorse,
  selectPublicValueEvidenceHorse,
  selectPublicValueHorse,
} from "../../src/lib/public-role-selection.js";
import { buildPaceShapeProfile } from "./pace-shape-shadow.mjs";

const finite = (value) => typeof value === "number" && Number.isFinite(value);
const rounded = (value) => Math.round(value * 100) / 100;
const factorScore = (horse, key) => horse?.analysis?.factorsDetail?.[key]?.score;

const paceRoleCandidate = (candidate, history) => {
  const profile = buildPaceShapeProfile(candidate.horse, history);
  const evidenceScore = publicRoleEvidenceScore(candidate);
  const weakest = Math.min(...["ability", "form", "training", "pace", "distance", "course", "trackBias", "load"]
    .map((key) => factorScore(candidate.horse, key))
    .filter(finite));
  const paceEvidenceAdjustment = profile.adjustment * 1.5;
  return {
    ...candidate,
    evidenceScore,
    weakest: Number.isFinite(weakest) ? weakest : null,
    paceProfile: profile,
    paceEvidenceAdjustment,
    roleQuality: rounded((evidenceScore ?? candidate.score) + paceEvidenceAdjustment),
  };
};

const rankPaceRoleCandidates = (race, history) => rankPublicRoleHorses(race)
  .map((candidate) => paceRoleCandidate(candidate, history));

const isValueCandidate = (candidate) =>
  candidate.rank >= 3 && candidate.rank <= 5 &&
  candidate.valueEligible && finite(candidate.marketGap) && candidate.marketGap >= 2;

const selectPaceValueCandidate = (candidates) => candidates
  .filter(isValueCandidate)
  .sort((left, right) =>
    right.roleQuality - left.roleQuality ||
    right.score - left.score ||
    (left.horse.number ?? 999) - (right.horse.number ?? 999)
  )[0] ?? null;

const isDangerCandidate = (candidate) => {
  const popularity = candidate.horse.popularity;
  if (!finite(popularity) || popularity > 4) return false;
  const rankGap = candidate.rank - popularity;
  if (rankGap >= 3) return true;
  return rankGap === 2 && (candidate.paceProfile.adjustment < 0 || (finite(candidate.weakest) && candidate.weakest <= 64));
};

const dangerStrength = (candidate) => {
  const rankGap = candidate.rank - candidate.horse.popularity;
  const weakness = finite(candidate.weakest) ? Math.max(0, 68 - candidate.weakest) : 0;
  const aidedRisk = Math.max(0, -candidate.paceProfile.adjustment) * 3;
  const resistanceProtection = Math.max(0, candidate.paceProfile.adjustment) * 2;
  return rounded(rankGap * 4 + candidate.leaderGap + weakness + aidedRisk - resistanceProtection);
};

const selectPaceDangerCandidate = (candidates) => candidates
  .filter(isDangerCandidate)
  .map((candidate) => ({ ...candidate, dangerStrength: dangerStrength(candidate) }))
  .sort((left, right) =>
    right.dangerStrength - left.dangerStrength ||
    right.leaderGap - left.leaderGap ||
    (left.horse.number ?? 999) - (right.horse.number ?? 999)
  )[0] ?? null;

const compactEvidence = (candidate) => candidate ? {
  horse: candidate.horse,
  indexRank: candidate.rank,
  tmIndex: candidate.score,
  evidenceScore: candidate.evidenceScore == null ? null : rounded(candidate.evidenceScore),
  weakest: candidate.weakest,
  roleQuality: candidate.roleQuality,
  dangerStrength: candidate.dangerStrength ?? null,
  paceEvidenceAdjustment: candidate.paceEvidenceAdjustment,
  paceProfile: candidate.paceProfile,
} : null;

const selectPublicRolePaceShadow = (race, history) => {
  const candidates = rankPaceRoleCandidates(race, history);
  const paceValue = selectPaceValueCandidate(candidates);
  const paceDanger = selectPaceDangerCandidate(candidates);
  return {
    productionValue: selectPublicValueHorse(race),
    evidenceValue: selectPublicValueEvidenceHorse(race),
    paceValue: paceValue?.horse ?? null,
    productionDanger: selectPublicDangerHorse(race),
    paceDanger: paceDanger?.horse ?? null,
    evidence: {
      value: compactEvidence(paceValue),
      danger: compactEvidence(paceDanger),
    },
    policy: {
      currentRaceResultUsed: false,
      futureRaceShapeAllowed: false,
      historicalOfficialLapsUsed: candidates.some((candidate) => candidate.paceProfile.runs.some((run) => run.paceClass != null)),
      productionConnected: false,
    },
  };
};

export {
  dangerStrength,
  rankPaceRoleCandidates,
  selectPublicRolePaceShadow,
};
