import { rankPaceRoleCandidates, selectPublicRolePaceShadow } from "./public-role-pace-shadow.mjs";
import { buildFrameAptitudeShadow } from "./frame-ai.mjs";

const finite = (value) => typeof value === "number" && Number.isFinite(value);
const rounded = (value) => Math.round(value * 100) / 100;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const factorScore = (horse, key) => horse?.analysis?.factorsDetail?.[key]?.score ?? horse?.analysis?.factors?.[key];

const raceContextForFrame = (race) => ({
  date: String(race?.id ?? race?.bundleId ?? "").slice(0, 10),
  course: race?.track ?? race?.course,
  surface: race?.surface,
  distance: race?.distance,
  fieldSize: race?.fieldSize ?? race?.horses?.length,
});

const confidenceWeight = (confidence) => {
  if (["A", "B", "C"].includes(confidence)) return 1;
  if (confidence === "D") return 0.5;
  return 0;
};

const frameRoleCandidate = (candidate, race, frameModel) => {
  const currentFrame = factorScore(candidate.horse, "frame");
  const frameProfile = buildFrameAptitudeShadow(candidate.horse, raceContextForFrame(race), currentFrame, frameModel);
  const adjustedLift = Number(frameProfile.match?.adjustedLift ?? 0);
  const frameEvidenceAdjustment = frameProfile.status === "active"
    ? rounded(clamp(adjustedLift * 20 * confidenceWeight(frameProfile.confidence), -1, 1))
    : 0;
  return {
    ...candidate,
    frameProfile,
    frameEvidenceAdjustment,
    frameRoleQuality: rounded(candidate.roleQuality + frameEvidenceAdjustment),
  };
};

const rankFrameRoleCandidates = (race, paceHistory, frameModel) => rankPaceRoleCandidates(race, paceHistory)
  .map((candidate) => frameRoleCandidate(candidate, race, frameModel));

const isValueCandidate = (candidate) =>
  candidate.rank >= 3 && candidate.rank <= 5 && candidate.valueEligible && finite(candidate.marketGap) && candidate.marketGap >= 2;

const selectFrameValueCandidate = (candidates) => candidates
  .filter(isValueCandidate)
  .sort((left, right) =>
    right.frameRoleQuality - left.frameRoleQuality ||
    right.roleQuality - left.roleQuality ||
    right.score - left.score ||
    (left.horse.number ?? 999) - (right.horse.number ?? 999)
  )[0] ?? null;

const compactEvidence = (candidate) => candidate ? {
  horse: candidate.horse,
  indexRank: candidate.rank,
  tmIndex: candidate.score,
  evidenceScore: candidate.evidenceScore,
  paceEvidenceAdjustment: candidate.paceEvidenceAdjustment,
  roleQuality: candidate.roleQuality,
  frameEvidenceAdjustment: candidate.frameEvidenceAdjustment,
  frameRoleQuality: candidate.frameRoleQuality,
  frameProfile: candidate.frameProfile,
} : null;

const selectPublicRoleFrameShadow = (race, paceHistory, frameModel) => {
  const paceSelection = selectPublicRolePaceShadow(race, paceHistory);
  const candidates = rankFrameRoleCandidates(race, paceHistory, frameModel);
  const frameValue = selectFrameValueCandidate(candidates);
  return {
    productionValue: paceSelection.productionValue,
    evidenceValue: paceSelection.evidenceValue,
    paceValue: paceSelection.paceValue,
    frameValue: frameValue?.horse ?? null,
    evidence: compactEvidence(frameValue),
    policy: {
      currentRaceResultUsed: false,
      futureRaceShapeAllowed: false,
      futureFrameModelAllowed: false,
      frameAdjustmentBound: 1,
      productionConnected: false,
      tmIndexChanged: false,
    },
  };
};

export {
  confidenceWeight,
  frameRoleCandidate,
  rankFrameRoleCandidates,
  selectPublicRoleFrameShadow,
};
