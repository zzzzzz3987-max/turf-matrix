import { createHash } from "node:crypto";
import { diagnoseEvidenceOverlap } from "./evidence-overlap.mjs";
import { evaluateFrozenLeaders } from "./frozen-leader-evaluation.mjs";
import { normalizeCourseSurface } from "../../intelligence/course-ai.mjs";

export const OVERLAP_SHADOW_VERSION = "direct-distance-overlap-v1";
export const OVERLAP_VARIANTS = ["abilityOnly", "formOnly", "both"];
const policy = { primaryVariant: "both", secondaryVariants: ["abilityOnly", "formOnly"],
  weightsChanged: false, distanceFactorChanged: false, formNormalizationApplied: false,
  courseSurfaceCandidateApplied: false, resultsRead: false, automaticAdoption: false,
  tieBreak: "lowest-horse-number", stakePerRaceYen: 100 };
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const isHash = (value) => /^[0-9a-f]{64}$/.test(value ?? "");
const round = (value) => Math.round(value * 10000) / 10000;
const rank = (horses, score) => [...horses].sort((a, b) => score(b) - score(a) || a.number - b.number);
const checkedPostTime = (date, time) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "") || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time ?? "")) throw new Error("Invalid date or post time");
  const day = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== date) throw new Error("Invalid date");
  return Date.parse(`${date}T${time}:00+09:00`);
};
const checkedTimestamp = (value) => {
  if (typeof value !== "string" || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error("Invalid timestamp with timezone");
  return Date.parse(value);
};

export const buildOverlapShadowArtifact = (week, { prospective = false, now = new Date().toISOString(), modelSha256 = null } = {}) => {
  if (prospective && !isHash(modelSha256)) throw new Error("Missing model fingerprint for pre-race freeze");
  const frozenTime = checkedTimestamp(now);
  for (const race of week.races ?? []) {
    const post = checkedPostTime(week.meta?.date, race.time);
    if (prospective && frozenTime >= post) throw new Error("Pre-race freeze refused: a race has already started");
    for (const horse of race.horses ?? []) {
      if (!normalizeCourseSurface(race.surface) || horse.currentRace?.course !== race.track ||
          normalizeCourseSurface(horse.currentRace?.surface) !== normalizeCourseSurface(race.surface) ||
          !Number.isFinite(race.distance) || race.distance <= 0 || Number(horse.currentRace?.distance) !== race.distance) {
        throw new Error("Horse and race conditions differ or are missing");
      }
    }
  }
  const report = diagnoseEvidenceOverlap(week);
  const payload = {
    schemaVersion: 1, modelVersion: OVERLAP_SHADOW_VERSION, modelSha256,
    inputSha256: hash(week), frozenAt: now, raceDate: report.raceDate,
    status: prospective ? "frozen-pre-race" : "retrospective-diagnostic", productionConnected: false,
    policy: structuredClone(policy),
    predictions: report.races.map((race, i) => ({ ...race, date: report.raceDate, time: week.races[i].time })),
  };
  return { ...payload, predictionSha256: hash(payload) };
};

export const validateOverlapShadowArtifact = (artifact) => {
  const { predictionSha256, ...payload } = artifact;
  if (hash(payload) !== predictionSha256) throw new Error("Overlap prediction hash mismatch");
  if (artifact.schemaVersion !== 1 || artifact.modelVersion !== OVERLAP_SHADOW_VERSION ||
      !isHash(artifact.inputSha256) || !isHash(artifact.modelSha256) || artifact.productionConnected !== false ||
      hash(artifact.policy) !== hash(policy)) throw new Error("Invalid overlap version, fingerprint or policy");
  if (artifact.status !== "frozen-pre-race") throw new Error("Retrospective diagnostics are not prospective evidence");
  const frozenTime = checkedTimestamp(artifact.frozenAt);
  if (!Array.isArray(artifact.predictions) || !artifact.predictions.length) throw new Error("No predictions");
  const ids = new Set();
  for (const race of artifact.predictions) {
    if (!race.raceId || ids.has(race.raceId)) throw new Error("Missing or duplicate race identity");
    ids.add(race.raceId);
    if (race.date !== artifact.raceDate || frozenTime >= checkedPostTime(race.date, race.time)) throw new Error("Prediction is not strictly before the race");
    if (!Array.isArray(race.horses) || race.horses.length < 2) throw new Error("Incomplete frozen field");
    const numbers = new Set();
    for (const horse of race.horses) {
      if (!horse.name || !Number.isInteger(horse.number) || horse.number <= 0 || numbers.has(horse.number) ||
          !Number.isFinite(horse.currentTm)) throw new Error("Invalid frozen horse");
      numbers.add(horse.number);
      if (OVERLAP_VARIANTS.some((key) => !Number.isFinite(horse.candidates?.[key]?.tm))) throw new Error("Incomplete frozen variants");
    }
    for (const key of OVERLAP_VARIANTS) {
      const current = rank(race.horses, (horse) => horse.currentTm);
      const candidate = rank(race.horses, (horse) => horse.candidates[key].tm);
      const comparison = race.comparisons?.[key];
      if (comparison?.currentLeader !== current[0].number || comparison?.candidateLeader !== candidate[0].number ||
          comparison.leaderChanged !== (current[0].number !== candidate[0].number)) throw new Error("Frozen ranking mismatch");
    }
  }
};

const summarize = (rows) => Object.fromEntries(["current", "shadow"].map((mode) => {
  const races = rows.length;
  const wins = rows.filter((row) => row[mode].win).length;
  const placeHits = rows.filter((row) => row[mode].place).length;
  const winReturn = rows.reduce((sum, row) => sum + row[mode].winReturn, 0);
  const placeReturn = rows.reduce((sum, row) => sum + row[mode].placeReturn, 0);
  const stake = races * policy.stakePerRaceYen;
  return [mode, { races, wins, placeHits, winReturn, placeReturn, stakePerBetType: stake,
    winRate: races ? round(wins / races) : null, placeRate: races ? round(placeHits / races) : null,
    winRoiPercent: stake ? round(winReturn / stake * 100) : null,
    placeRoiPercent: stake ? round(placeReturn / stake * 100) : null }];
}));

export const evaluateOverlapShadowArtifact = (artifact, results) => {
  validateOverlapShadowArtifact(artifact);
  const variants = Object.fromEntries(OVERLAP_VARIANTS.map((key) => {
    const predictions = artifact.predictions.map((race) => ({ ...race,
      currentLeader: race.comparisons[key].currentLeader, shadowLeader: race.comparisons[key].candidateLeader,
      leaderChanged: race.comparisons[key].leaderChanged,
    }));
    const evaluated = evaluateFrozenLeaders({ raceDate: artifact.raceDate, predictions }, results);
    return [key, { ...evaluated, summary: summarize(evaluated.evaluated),
      changedLeaders: summarize(evaluated.evaluated.filter((race) => race.leaderChanged)) }];
  }));
  const payload = { schemaVersion: 1, modelVersion: OVERLAP_SHADOW_VERSION, modelSha256: artifact.modelSha256,
    raceDate: artifact.raceDate, predictionSha256: artifact.predictionSha256, resultSha256: hash(results),
    productionConnected: false, primaryVariant: policy.primaryVariant, adoptionDecision: "manual-review-required",
    variants };
  return { ...payload, evaluationSha256: hash(payload) };
};

export const aggregateOverlapEvaluations = (evaluations) => {
  const dates = new Map();
  const models = new Map();
  for (const evaluation of evaluations) {
    const { evaluationSha256, ...payload } = evaluation;
    if (hash(payload) !== evaluationSha256 || evaluation.schemaVersion !== 1 ||
        evaluation.modelVersion !== OVERLAP_SHADOW_VERSION || evaluation.primaryVariant !== policy.primaryVariant ||
        evaluation.productionConnected !== false || evaluation.adoptionDecision !== "manual-review-required" ||
        !isHash(evaluation.modelSha256) || !isHash(evaluation.predictionSha256) || !isHash(evaluation.resultSha256)) throw new Error("Invalid evaluation integrity or policy");
    checkedPostTime(evaluation.raceDate, "00:00");
    const previous = dates.get(evaluation.raceDate);
    if (previous) {
      if (previous !== evaluationSha256) throw new Error("Conflicting evaluations for the same date");
      continue;
    }
    dates.set(evaluation.raceDate, evaluationSha256);
    if (!models.has(evaluation.modelSha256)) models.set(evaluation.modelSha256, []);
    models.get(evaluation.modelSha256).push(evaluation);
  }
  return { modelVersion: OVERLAP_SHADOW_VERSION, primaryVariant: policy.primaryVariant,
    productionConnected: false, adoptionDecision: "manual-review-required",
    groups: [...models].map(([modelSha256, records]) => ({ modelSha256,
      dates: records.map((record) => record.raceDate).sort(),
      variants: Object.fromEntries(OVERLAP_VARIANTS.map((key) => {
        const rows = records.flatMap((record) => record.variants[key].evaluated);
        return [key, { summary: summarize(rows), changedLeaders: summarize(rows.filter((race) => race.leaderChanged)),
          skipped: records.flatMap((record) => record.variants[key].skipped.map((skip) => ({ ...skip, date: record.raceDate }))) }];
      })),
    })),
  };
};
