import {
  buildRaceShapeIndex,
  normalizeName,
  raceShapeKey,
} from "./race-shape-history.mjs";

const MIN_SCORE = 35;
const MAX_SCORE = 96;
const MAX_ADJUSTMENT = 2;
const RECENCY_WEIGHTS = [1, 0.75, 0.55, 0.4, 0.3];
const finite = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
const clamp = (value, min = MIN_SCORE, max = MAX_SCORE) => Math.max(min, Math.min(max, value));
const rounded = (value) => Math.round(value * 100) / 100;
const dateValue = (value) => {
  const parsed = Date.parse(String(value ?? "").trim().replace(/[./]/g, "-"));
  return Number.isFinite(parsed) ? parsed : null;
};

const isHistoricalRun = (run, raceDate) => {
  const runDate = dateValue(run?.date);
  const targetDate = dateValue(raceDate);
  return runDate != null && targetDate != null && runDate < targetDate;
};

const findHistoryHorse = (race, horse, run) => {
  const runNumber = Number(run?.horseNumber);
  const targetName = normalizeName(horse?.horseName ?? horse?.name ?? horse?.currentRace?.horseName);
  return (race?.horses ?? []).find((item) => {
    if (Number.isInteger(runNumber) && runNumber > 0 && Number(item.horseNumber) !== runNumber) return false;
    return !targetName || normalizeName(item.horseName) === targetName;
  }) ?? null;
};

const shapeImpact = (race, historyHorse, run = {}) => {
  if (!race || !historyHorse || race.shape === "neutral") return { impact: 0, reason: "中立形状" };
  const finish = Number(historyHorse.finishPosition);
  const topHalf = finish <= Math.ceil(Number(race.fieldSize) / 2);
  const margin = finite(run.margin) ? Number(run.margin) : null;
  const closeEnough = margin != null && margin <= 1.2;
  const gained = Number(historyHorse.positionChange) >= 0.15;

  if (race.shape === "front_collapse" && historyHorse.role === "front") {
    if (topHalf) return { impact: 2, reason: "前崩れを前方で踏ん張った" };
    if (closeEnough) return { impact: 1, reason: "前崩れで先行し大敗を免れた" };
  }
  if (race.shape === "front_collapse" && historyHorse.role === "rear" && finish <= 3 && gained) {
    return { impact: -1, reason: "前崩れの恩恵を受けた好走" };
  }
  if (race.shape === "front_survival" && historyHorse.role === "rear") {
    if (topHalf && gained) return { impact: 2, reason: "前残りを後方から押し上げた" };
    if (closeEnough && gained) return { impact: 1, reason: "前残りで後方から差を詰めた" };
  }
  if (race.shape === "front_survival" && historyHorse.role === "front" && finish <= 3) {
    return { impact: -1, reason: "前残りの恩恵を受けた好走" };
  }
  return { impact: 0, reason: "形状による明確な利不利なし" };
};

const buildPaceShapeProfile = (horse, history) => {
  const raceDate = horse?.currentRace?.raceDate;
  const index = history instanceof Map ? history : buildRaceShapeIndex(history);
  const matches = [];
  for (const run of horse?.pastRuns ?? []) {
    if (!isHistoricalRun(run, raceDate)) continue;
    const key = raceShapeKey(run.date, run.course ?? run.track, run.raceNumber ?? run.raceNo);
    const race = key ? index.get(key) : null;
    if (!race) continue;
    const historyHorse = findHistoryHorse(race, horse, run);
    if (!historyHorse) continue;
    const result = shapeImpact(race, historyHorse, run);
    matches.push({
      date: run.date,
      course: run.course ?? run.track ?? null,
      raceNumber: Number(run.raceNumber ?? run.raceNo),
      raceName: run.raceName ?? null,
      shape: race.shape,
      shapeConfidence: race.confidence,
      role: historyHorse.role,
      finishPosition: historyHorse.finishPosition,
      impact: result.impact,
      reason: result.reason,
    });
    if (matches.length >= RECENCY_WEIGHTS.length) break;
  }

  if (!matches.length) {
    return {
      status: "missing",
      adjustment: 0,
      matchedRunCount: 0,
      confidence: "Low",
      rawImpact: 0,
      runs: [],
    };
  }
  const weightTotal = matches.reduce((sum, _item, indexValue) => sum + RECENCY_WEIGHTS[indexValue], 0);
  const rawImpact = matches.reduce((sum, item, indexValue) => sum + item.impact * RECENCY_WEIGHTS[indexValue], 0) / weightTotal;
  const evidenceFactor = matches.length >= 3 ? 1 : matches.length === 2 ? 0.8 : 0.6;
  const adjustment = clamp(Math.round(rawImpact * evidenceFactor), -MAX_ADJUSTMENT, MAX_ADJUSTMENT);
  return {
    status: matches.length >= 2 ? "active" : "limited",
    adjustment,
    matchedRunCount: matches.length,
    confidence: matches.length >= 4 ? "A" : matches.length >= 3 ? "B" : matches.length >= 2 ? "C" : "Low",
    rawImpact: rounded(rawImpact),
    evidenceFactor,
    runs: matches,
  };
};

const buildPaceShapeShadow = (horse, currentPace, history) => {
  const current = finite(currentPace) ? Number(currentPace) : 60;
  const profile = buildPaceShapeProfile(horse, history);
  return {
    ...profile,
    currentScore: current,
    shadowScore: Math.round(clamp(current + profile.adjustment)),
    maxAdjustment: MAX_ADJUSTMENT,
    policy: {
      currentRaceResultUsed: false,
      futureRaceShapeAllowed: false,
      popularityOddsValueUsed: false,
      observedRaceLapUsed: false,
      raceOutcomeShapeProxyUsed: true,
      currentRacePaceScenarioChanged: false,
    },
  };
};

export {
  MAX_ADJUSTMENT,
  buildPaceShapeProfile,
  buildPaceShapeShadow,
  isHistoricalRun,
  shapeImpact,
};
