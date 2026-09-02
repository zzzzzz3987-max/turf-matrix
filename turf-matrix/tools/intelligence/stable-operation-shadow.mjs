import { createRequire } from "node:module";
import { matchesOperationPattern } from "../learn/stable-operation-learning.mjs";
import { normalizeKey, stableOperationSnapshot } from "./stable-operation-features.mjs";

const require = createRequire(import.meta.url);
const DEFAULT_MODEL = require("../../data/master/stable-operations.json");
const MAX_STABLE_ADJUSTMENT = 3;

const finite = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
const clamp = (value, min, max) => Math.max(min, Math.min(max, Math.round(value)));
const boundedAdjustment = (value) => clamp(value, -MAX_STABLE_ADJUSTMENT, MAX_STABLE_ADJUSTMENT);

const patternStrength = (pattern) => {
  if (!pattern?.accepted || !finite(pattern.adjustedLift)) return 0;
  const lift = Math.abs(Number(pattern.adjustedLift));
  return lift >= 0.08 && Number(pattern.sampleSize ?? 0) >= 20 ? 2 : 1;
};

const modelForTrainer = (model, trainer) => (model?.stables ?? []).find((stable) =>
  normalizeKey(stable.name) === normalizeKey(trainer)
) ?? null;

const isModelAvailableAt = (stableModel, raceDate) => {
  const modelEnd = String(stableModel?.period?.to ?? "");
  const target = String(raceDate ?? "");
  return /^\d{4}-\d{2}-\d{2}$/.test(modelEnd) && /^\d{4}-\d{2}-\d{2}$/.test(target) && modelEnd < target;
};

const buildStableOperationShadow = (horse, currentStableAnalysis = {}, model = DEFAULT_MODEL) => {
  const snapshot = stableOperationSnapshot(horse);
  const currentScore = finite(currentStableAnalysis.score) ? Number(currentStableAnalysis.score) : snapshot.trainer ? 70 : 58;
  const baseline = snapshot.trainer ? 70 : 58;
  const stableModel = modelForTrainer(model, snapshot.trainer);
  const modelAvailable = stableModel && isModelAvailableAt(stableModel, snapshot.raceDate);
  const positiveMatch = modelAvailable && stableModel.positivePattern?.accepted &&
    matchesOperationPattern(snapshot, stableModel.positivePattern.pattern)
    ? stableModel.positivePattern
    : null;
  const riskMatch = modelAvailable && stableModel.riskPattern?.accepted &&
    matchesOperationPattern(snapshot, stableModel.riskPattern.pattern)
    ? stableModel.riskPattern
    : null;
  const positiveAdjustment = patternStrength(positiveMatch);
  const riskAdjustment = -patternStrength(riskMatch);
  const operationAdjustment = clamp(positiveAdjustment + riskAdjustment, -2, 2);
  const targetScore = baseline + operationAdjustment;
  const adjustment = boundedAdjustment(targetScore - currentScore);
  const shadowScore = clamp(currentScore + adjustment, 55, 84);
  const status = !snapshot.trainer
    ? "missing_trainer"
    : !stableModel
      ? "no_validated_model"
      : !modelAvailable
        ? "future_leakage_blocked"
        : positiveMatch || riskMatch ? "active" : "no_pattern_match";
  const matched = [positiveMatch, riskMatch].filter(Boolean);

  return {
    modelVersion: "stable-operation-empirical-v2",
    status,
    currentScore,
    shadowScore,
    adjustment,
    baseline,
    operationAdjustment,
    trainer: snapshot.trainer,
    raceDate: snapshot.raceDate,
    modelPeriod: stableModel?.period ?? null,
    snapshot,
    positiveMatch,
    riskMatch,
    confidence: matched.length ? stableModel.confidence : "low",
    removedCurrentComponents: {
      genericRotation: Number(currentStableAnalysis.components?.rotation ?? 0),
      genericJockey: Number(currentStableAnalysis.components?.jockey ?? 0),
      genericTravel: Number(currentStableAnalysis.components?.travel ?? 0),
      trainingPatternDoubleCount: Number(currentStableAnalysis.components?.stablePattern ?? 0),
    },
    evidence: matched.map((pattern) => ({
      direction: pattern.direction,
      phrase: pattern.phrase,
      sampleSize: pattern.sampleSize,
      adjustedHitRate: pattern.adjustedHitRate,
      baselineHitRate: pattern.baselineHitRate,
      adjustedLift: pattern.adjustedLift,
      validationSampleSize: pattern.validation?.sampleSize ?? 0,
      validationLift: pattern.validation?.adjustedLift ?? null,
    })),
    policy: {
      productionConnected: false,
      currentRaceResultRead: false,
      currentRaceOddsPopularityRead: false,
      trainingPatternScoredInStable: false,
      genericOperationAssumptionsScored: false,
      maxStableAdjustment: MAX_STABLE_ADJUSTMENT,
    },
  };
};

export {
  MAX_STABLE_ADJUSTMENT,
  buildStableOperationShadow,
  isModelAvailableAt,
  modelForTrainer,
  patternStrength,
};
