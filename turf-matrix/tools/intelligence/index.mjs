// TURF MATRIX Intelligence Layer v1 skeleton.
// Keep deterministic scoring here; parsers/normalizers stay upstream and UI stays downstream.

import { FACTOR_KEYS, RACE_DAY_CONDITION } from "./constants.mjs";
import { scoreBlood, buildPedigreeAnalysis } from "./blood-ai.mjs";
import { buildTrainingAnalysis } from "./training-ai.mjs";
import { scoreValue } from "./value-ai.mjs";
import { buildVerdictPayload } from "./verdict-engine.mjs";
import { scoreZi, scoreRecentForm } from "./form-ai.mjs";
import { scoreDistance, scoreCourse } from "./course-ai.mjs";
import { scoreLap, scorePace } from "./pace-ai.mjs";
import { scoreStable, frameScore } from "./support-ai.mjs";
import { calculateTmIndex } from "./tm-index-engine.mjs";



const clamp = (value, min = 35, max = 96) => Math.max(min, Math.min(max, Math.round(value)));
const avg = (values, fallback = 60) => {
  const nums = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  return nums.length ? nums.reduce((sum, value) => sum + value, 0) / nums.length : fallback;
};
const normalizeHorseKey = (value) =>
  String(value ?? "")
    .normalize("NFKC")
    .replace(/\u3000/g, " ")
    .replace(/\s+/g, "")
    .trim();

const hasInvalidNumber = (value) => typeof value === "number" && !Number.isFinite(value);

const findInvalidNumbers = (value, path = "$", errors = []) => {
  if (hasInvalidNumber(value)) errors.push(path);
  if (Array.isArray(value)) {
    value.forEach((item, index) => findInvalidNumbers(item, `${path}[${index}]`, errors));
  } else if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, item]) => findInvalidNumbers(item, `${path}.${key}`, errors));
  }
  return errors;
};

const duplicates = (values) => {
  const seen = new Set();
  const duplicated = new Set();
  for (const value of values) {
    if (value == null || value === "") continue;
    if (seen.has(value)) duplicated.add(value);
    seen.add(value);
  }
  return [...duplicated];
};









const buildAnalysis = (horse) => {
  const displayName = horse.name ?? horse.currentRace?.horseName ?? horse.odds?.horseName ?? "対象馬";
  const displayNumber = horse.number ?? horse.currentRace?.horseNumber;
  const ability = scoreZi(horse);
  const form = scoreRecentForm(horse);
  const distance = scoreDistance(horse);
  const course = scoreCourse(horse);
  const lap = scoreLap(horse);
  const pace = scorePace(horse);
  const trainingAnalysis = buildTrainingAnalysis(horse);
  const training = trainingAnalysis.score;
  const trainingLap = trainingAnalysis.lapScore;
  const blood = scoreBlood(horse);
  const value = scoreValue(horse, ability);
  const stable = scoreStable(horse);
  const frame = frameScore(displayNumber);

  const factors = {
    ability,
    distance,
    lap,
    training,
    trainingLap,
    stable,
    frame,
    course,
    pace,
  };

  const tmIndex = calculateTmIndex({ ability, form, distance, course, training, blood, value, pace });

  const pedigreeAnalysis = buildPedigreeAnalysis(horse, blood);
  const bloodSummary = pedigreeAnalysis.headline ?? "4代血統を確認";
  const trainingReadable =
    trainingAnalysis.count
      ? trainingAnalysis.summary
      : "最終追切データは一部未取得のため、調教面は参考評価";
  const verdictPayload = buildVerdictPayload({
    horse,
    displayName,
    displayNumber,
    tmIndex,
    value,
    factors,
    scores: { ability, form, course, pace, training, blood, stable, frame },
    trainingAnalysis,
    trainingReadable,
    pedigreeAnalysis,
    bloodSummary,
  });

  return {
    tmIndex,
    tmValue: value,
    comment: verdictPayload.comment,
    analysis: verdictPayload.analysis,
  };

};

export { FACTOR_KEYS, RACE_DAY_CONDITION, buildAnalysis, normalizeHorseKey, findInvalidNumbers, duplicates };
