import { FACTOR_KEYS } from "./constants.mjs";
import { scoreBlood, buildPedigreeAnalysis } from "./blood-ai.mjs";
import { buildTrainingAnalysis } from "./training-ai.mjs";
import { scoreValue, buildValueAnalysis } from "./value-ai.mjs";
import { buildVerdictPayload } from "./verdict-engine.mjs";
import { scoreZi, scoreRecentForm, buildFormAnalysis, buildAbilityAnalysis } from "./form-ai.mjs";
import { scoreDistance, scoreCourse, buildCourseAnalysis } from "./course-ai.mjs";
import { scoreLap, scorePace, buildPaceAnalysis, buildRacePaceScenario } from "./pace-ai.mjs";
import { buildStableAnalysis, frameScore } from "./support-ai.mjs";
import { calculateTmIndex, buildIndexContributions } from "./tm-index-engine.mjs";
import { buildRaceContext } from "./race-context.mjs";
import { assessDataQuality } from "./data-quality-ai.mjs";
import { buildGoingAdjustment } from "./going-adjustment.mjs";
import { buildLoadAnalysis } from "./load-ai.mjs";
import { buildTrackBiasAnalysis } from "./track-bias-ai.mjs";
import { buildPaceContextShadow } from "./pace-context-shadow.mjs";

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

const applyExperienceDiscount = (score, horse) => {
  if (!Number.isFinite(score)) return score;
  const runCount = horse.pastRuns?.length ?? 0;
  const neutral = 65;
  const factor = runCount <= 0 ? 0.3 : runCount === 1 ? 0.5 : runCount === 2 ? 0.7 : 1;
  return Math.round(neutral + (score - neutral) * factor);
};

const buildAnalysis = (horse, suppliedContext) => {
  const context = suppliedContext ?? buildRaceContext(horse.currentRace);
  const displayName = horse.horseName ?? horse.name ?? horse.currentRace?.horseName ?? "対象馬";
  const displayNumber = horse.horseNumber ?? horse.number ?? horse.currentRace?.horseNumber;
  const ability = scoreZi(horse);
  const abilityAnalysis = buildAbilityAnalysis(horse, ability);
  const form = scoreRecentForm(horse);
  const formAnalysis = buildFormAnalysis(horse, form);
  const distance = scoreDistance(horse);
  const course = scoreCourse(horse);
  const courseAnalysis = buildCourseAnalysis(horse, context, { course, distance });
  const lap = scoreLap(horse);
  const pace = scorePace(horse, context);
  const goingAnalysis = buildGoingAdjustment(horse, context);
  const basePaceAnalysis = buildPaceAnalysis(horse, context, { pace, lap });
  const paceContextShadow = buildPaceContextShadow(
    horse,
    pace,
    context,
    context.raceShapeHistory ?? { races: [] },
  );
  const paceContextProfile = paceContextShadow.currentContext;
  const historicalFlow = paceContextShadow.historical;
  const historicalSummary = historicalFlow.matchedRunCount
    ? `過去${historicalFlow.matchedRunCount}走の展開利不利を照合。${historicalFlow.adjustment > 0 ? "展開に逆らった走りを確認。" : historicalFlow.adjustment < 0 ? "展開の恩恵を受けた好走を確認。" : "明確な偏りはありません。"}`
    : "過去走の展開利不利は照合材料が限定的です。";
  const paceAnalysis = {
    ...basePaceAnalysis,
    contextFit: paceContextProfile,
    historicalFlow,
    integratedFit: {
      status: paceContextShadow.status,
      label: paceContextProfile.label,
      adjustment: paceContextShadow.adjustment,
      confidence: paceContextShadow.confidence,
      going: goingAnalysis.going,
      goingStatus: goingAnalysis.status,
      goingAdjustment: goingAnalysis.adjustment,
      scoreConnected: false,
    },
    summary: `${basePaceAnalysis.summary} 今回のコース・枠・想定ペース・確定済み馬場傾向との相性は${paceContextProfile.label}。${context.going ? goingAnalysis.summary : "公式馬場状態は取得後に反映します。"}${historicalSummary}`,
    strengths: [...basePaceAnalysis.strengths, ...historicalFlow.runs.slice(0, 2).map((run) => run.reason), ...paceContextProfile.evidence],
    evidence: [...basePaceAnalysis.evidence, ...paceContextShadow.evidence],
  };
  const trainingAnalysis = buildTrainingAnalysis(horse);
  const hasTrainingEvidence = trainingAnalysis.count > 0 || Boolean(trainingAnalysis.videoReview);
  const training = trainingAnalysis.score;
  const trainingLap = trainingAnalysis.lapScore;
  const trainingForIndex = hasTrainingEvidence ? training : null;
  const blood = scoreBlood(horse, context);
  const baseIndex = calculateTmIndex({ ability, form, distance, course, training: trainingForIndex, blood, pace }, context);
  const value = scoreValue(horse, ability, baseIndex);
  const valueAnalysis = buildValueAnalysis(horse, value);
  const stableAnalysis = buildStableAnalysis(horse, trainingAnalysis);
  const stable = stableAnalysis.score;
  const frame = frameScore(displayNumber);
  const factors = { ability, distance, lap, training, trainingLap, stable, frame, course, pace };
  const rawTmIndex = calculateTmIndex({ ability, form, distance, course, training: trainingForIndex, blood, pace }, context);
  const experienceAdjustedIndex = applyExperienceDiscount(rawTmIndex, horse);
  const goingAdjustment = goingAnalysis.adjustment ?? 0;
  const loadAnalysis = buildLoadAnalysis(horse, context);
  const loadAdjustment = loadAnalysis.adjustment ?? 0;
  const trackBiasAnalysis = buildTrackBiasAnalysis(horse, context);
  const trackBiasAdjustment = trackBiasAnalysis.adjustment ?? 0;
  const tmIndex = Number.isFinite(experienceAdjustedIndex)
    ? Math.max(45, Math.min(92, experienceAdjustedIndex + goingAdjustment + loadAdjustment + trackBiasAdjustment))
    : experienceAdjustedIndex;
  const runCount = horse.pastRuns?.length ?? 0;
  const sampleAdjustment = runCount < 3 && Number.isFinite(rawTmIndex) && Number.isFinite(experienceAdjustedIndex)
    ? experienceAdjustedIndex - rawTmIndex
    : 0;
  const indexContributions = buildIndexContributions({ ability, form, distance, course, training: trainingForIndex, blood, pace }, context);
  const pedigreeAnalysis = buildPedigreeAnalysis(horse, blood, context);
  const bloodSummary = pedigreeAnalysis.headline;
  const trainingReadable = trainingAnalysis.count
    ? trainingAnalysis.summary
    : trainingAnalysis.videoReview
      ? trainingAnalysis.summary
      : "調教時計・映像評価は未取得です。調教は評価保留とし、指数には加点も減点もしていません。";
  const dataQuality = assessDataQuality(horse);

  const verdict = buildVerdictPayload({
    horse,
    context,
    displayName,
    displayNumber,
    tmIndex,
    rawTmIndex,
    sampleAdjustment,
    goingAdjustment,
    goingAnalysis,
    loadAdjustment,
    loadAnalysis,
    trackBiasAdjustment,
    trackBiasAnalysis,
    value,
    factors,
    scores: { ability, form, course, pace, training: trainingForIndex, blood, stable, frame },
    trainingAnalysis,
    trainingReadable,
    pedigreeAnalysis,
    bloodSummary,
    abilityAnalysis,
    formAnalysis,
    courseAnalysis,
    paceAnalysis,
    valueAnalysis,
    stableAnalysis,
    indexContributions,
    dataQuality,
  });

  return { tmIndex, tmValue: value, comment: verdict.comment, analysis: verdict.analysis };
};

export { FACTOR_KEYS, buildAnalysis, buildRaceContext, buildRacePaceScenario, normalizeHorseKey, findInvalidNumbers, duplicates };
