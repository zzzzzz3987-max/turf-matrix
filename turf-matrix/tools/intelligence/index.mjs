import { FACTOR_KEYS } from "./constants.mjs";
import { scoreBlood, buildPedigreeAnalysis } from "./blood-ai.mjs";
import { buildTrainingAnalysis } from "./training-ai.mjs";
import { scoreValue } from "./value-ai.mjs";
import { buildVerdictPayload } from "./verdict-engine.mjs";
import { scoreZi, scoreRecentForm } from "./form-ai.mjs";
import { scoreDistance, scoreCourse } from "./course-ai.mjs";
import { scoreLap, scorePace } from "./pace-ai.mjs";
import { scoreStable, frameScore } from "./support-ai.mjs";
import { calculateTmIndex } from "./tm-index-engine.mjs";
import { buildRaceContext } from "./race-context.mjs";

const normalizeHorseKey = (value) =>
  String(value ?? "").normalize("NFKC").replace(/\u3000/g, " ").replace(/\s+/g, "").trim();

const findInvalidNumbers = (value, path = "$", errors = []) => {
  if (typeof value === "number" && !Number.isFinite(value)) errors.push(path);
  if (Array.isArray(value)) value.forEach((item, index) => findInvalidNumbers(item, `${path}[${index}]`, errors));
  else if (value && typeof value === "object") {
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

const buildAnalysis = (horse, suppliedContext) => {
  const context = suppliedContext ?? buildRaceContext(horse.currentRace);
  const displayName = horse.horseName ?? horse.name ?? horse.currentRace?.horseName ?? "対象馬";
  const displayNumber = horse.horseNumber ?? horse.number ?? horse.currentRace?.horseNumber;
  const ability = scoreZi(horse);
  const form = scoreRecentForm(horse);
  const distance = scoreDistance(horse);
  const course = scoreCourse(horse);
  const lap = scoreLap(horse);
  const pace = scorePace(horse);
  const trainingAnalysis = buildTrainingAnalysis(horse);
  const training = trainingAnalysis.score;
  const trainingLap = trainingAnalysis.lapScore;
  const blood = scoreBlood(horse, context);
  const value = scoreValue(horse, ability);
  const stable = scoreStable(horse);
  const frame = frameScore(displayNumber);
  const factors = { ability, distance, lap, training, trainingLap, stable, frame, course, pace };
  const tmIndex = calculateTmIndex({ ability, form, distance, course, training, blood, value, pace });
  const pedigreeAnalysis = buildPedigreeAnalysis(horse, blood, context);
  const bloodSummary = pedigreeAnalysis.headline;
  const trainingReadable = trainingAnalysis.count ? trainingAnalysis.summary : "調教時計は未取得です。調教面は控えめに評価します。";
  const verdict = buildVerdictPayload({
    horse,
    context,
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

  return { tmIndex, tmValue: value, comment: verdict.comment, analysis: verdict.analysis };
};

export { FACTOR_KEYS, buildAnalysis, buildRaceContext, normalizeHorseKey, findInvalidNumbers, duplicates };
