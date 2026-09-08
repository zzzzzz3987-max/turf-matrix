import { scoreRecentForm, buildRecentFormWeightEvidence } from "../../intelligence/form-ai.mjs";
import { createFactorOnlyShadow } from "./factor-only-shadow.mjs";

export const FORM_WEIGHTS_VERSION = "form-normalized-weights-v1";
const shadow = createFactorOnlyShadow({
  factor: "form", label: "Form", version: FORM_WEIGHTS_VERSION,
  policy: { changedFactor: "form", weightsChanged: false, courseChanged: false,
    recencyWeightsChanged: false, normalizedAverage: true, resultsRead: false },
  scoreCurrent: scoreRecentForm,
  scoreCandidate: (horse) => scoreRecentForm(horse, { normalizeWeights: true }),
  buildEvidence: (horse) => {
    const dates = horse.pastRuns.map((run) => run.date ?? run.raceDate);
    if (dates.some((date, i) => i > 0 && date > dates[i - 1])) {
      throw new Error("Form past runs must be newest first");
    }
    return buildRecentFormWeightEvidence(horse);
  },
});

export const buildFormWeightsPrediction = shadow.buildPrediction;
export const buildFormWeightsArtifact = shadow.buildArtifact;
export const validateFormWeightsArtifact = shadow.validateArtifact;
export const evaluateFormWeightsArtifact = shadow.evaluateArtifact;
