#!/usr/bin/env node
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  evidenceOpponent,
  indexRanking,
  isFiniteNumber,
  scoreOf,
  valueOf,
} from "../race-signal-selection.mjs";
import { loadFrozenPublicRoleDays } from "./lib/public-role-archive.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FACTOR_KEYS = ["ability", "form", "training", "pace", "distance", "course"];
const MODEL_FEATURES = [
  "index",
  "gap",
  "leaderCore",
  "weakestCore",
  "risks",
  "opponent1Index",
  "opponent2Evidence",
  "leaderEv",
];
const MODEL_CONFIG = Object.freeze({
  modelVersion: "battle-race-pair-v0.1-shadow",
  minIndex: 75,
  minGap: 1,
  minProbability: 0.5,
  ridgeLambda: 0.5,
  iterations: 3000,
  learningRate: 0.05,
});
const normalizeName = (value) => String(value ?? "").normalize("NFKC").replace(/[\s\u3000]/g, "");
const round1 = (value) => Number(value.toFixed(1));

const factorScore = (horse, key) => horse?.analysis?.factorsDetail?.[key]?.score;
const average = (values) => {
  const available = values.filter(isFiniteNumber);
  return available.length ? available.reduce((sum, value) => sum + value, 0) / available.length : null;
};

const riskCount = (horse) => {
  const detail = horse?.analysis?.factorsDetail ?? {};
  return [
    isFiniteNumber(detail.load?.adjustment) && detail.load.adjustment < 0,
    isFiniteNumber(detail.pace?.score) && detail.pace.score < 65,
    isFiniteNumber(detail.trackBias?.adjustment) && detail.trackBias.adjustment < 0,
    isFiniteNumber(detail.distance?.score) && detail.distance.score < 60,
    ["active", "partial"].includes(detail.training?.status) && isFiniteNumber(detail.training?.score) && detail.training.score < 65,
    isFiniteNumber(detail.blood?.score) && detail.blood.score < 60,
  ].filter(Boolean).length;
};

const buildCandidate = (race) => {
  const ranked = indexRanking(race);
  const leader = ranked[0] ?? null;
  const opponent1 = ranked[1] ?? null;
  const selectedOpponent2 = evidenceOpponent(race);
  if (!leader || !opponent1 || !selectedOpponent2?.horse) return null;
  const coreScores = FACTOR_KEYS.map((key) => factorScore(leader, key)).filter(isFiniteNumber);
  const leaderValue = valueOf(leader) ?? {};
  return {
    race,
    leader,
    opponent1,
    opponent2: selectedOpponent2.horse,
    index: scoreOf(leader),
    gap: scoreOf(leader) - scoreOf(opponent1),
    confidence: String(leader?.analysis?.confidence ?? "").toLowerCase(),
    leaderCore: average(coreScores),
    coreCoverage: coreScores.length / FACTOR_KEYS.length,
    weakestCore: coreScores.length ? Math.min(...coreScores) : null,
    risks: riskCount(leader),
    opponent1Index: scoreOf(opponent1),
    opponent2Evidence: selectedOpponent2.profile.score,
    opponent2Coverage: selectedOpponent2.profile.coverage,
    leaderEv: leaderValue.ev,
    leaderOdds: leader.odds,
  };
};

const baselineEligible = (candidate) =>
  candidate &&
  candidate.race.category !== "race" &&
  candidate.index >= 80 &&
  candidate.gap >= 3 &&
  candidate.confidence !== "low";

const STRATEGIES = {
  baseline: {
    eligible: baselineEligible,
    compare: (left, right) => right.gap - left.gap || right.index - left.index,
  },
  strong_gap: {
    eligible: (candidate) => baselineEligible(candidate) && candidate.gap >= 4,
    compare: (left, right) => right.gap - left.gap || right.index - left.index,
  },
  quality_guard: {
    eligible: (candidate) =>
      baselineEligible(candidate) &&
      candidate.coreCoverage >= 5 / 6 &&
      candidate.leaderCore >= 69 &&
      candidate.weakestCore >= 60 &&
      candidate.risks <= 1,
    compare: (left, right) =>
      right.leaderCore - left.leaderCore || right.gap - left.gap || right.index - left.index,
  },
  pair_guard: {
    eligible: (candidate) =>
      baselineEligible(candidate) &&
      candidate.opponent1Index >= 74 &&
      candidate.opponent2Evidence >= 68 &&
      candidate.opponent2Coverage >= 0.75,
    compare: (left, right) =>
      right.opponent2Evidence - left.opponent2Evidence ||
      right.opponent1Index - left.opponent1Index ||
      right.gap - left.gap,
  },
  balanced_guard: {
    eligible: (candidate) =>
      baselineEligible(candidate) &&
      candidate.coreCoverage >= 5 / 6 &&
      candidate.leaderCore >= 69 &&
      candidate.weakestCore >= 60 &&
      candidate.risks <= 1 &&
      candidate.opponent1Index >= 74 &&
      candidate.opponent2Evidence >= 68 &&
      candidate.opponent2Coverage >= 0.75 &&
      isFiniteNumber(candidate.leaderEv) &&
      candidate.leaderEv >= 0.55 &&
      candidate.leaderEv < 2.5,
    compare: (left, right) =>
      right.gap - left.gap ||
      right.leaderCore - left.leaderCore ||
      right.opponent2Evidence - left.opponent2Evidence ||
      right.leaderEv - left.leaderEv,
  },
};

const resultHorse = (selection, resultRace) => {
  if (!selection || !resultRace) return null;
  const result = (resultRace.horses ?? []).find((horse) => horse.horseNumber === selection.number);
  return result && normalizeName(result.horseName) === normalizeName(selection.name) ? result : null;
};

const resultRow = (candidate, resultRace, date) => {
  const leader = resultHorse(candidate.leader, resultRace);
  const opponent1 = resultHorse(candidate.opponent1, resultRace);
  const opponent2 = resultHorse(candidate.opponent2, resultRace);
  if (![leader, opponent1, opponent2].every((horse) => isFiniteNumber(horse?.finishPosition))) return null;
  const payoutAvailable = isFiniteNumber(leader.winPayout) && isFiniteNumber(leader.placePayout);
  return {
    date,
    raceId: candidate.race.bundleId,
    race: `${candidate.race.track}${candidate.race.number}R`,
    leaderName: candidate.leader.name,
    leaderFinish: leader.finishPosition,
    opponent1Finish: opponent1.finishPosition,
    opponent2Finish: opponent2.finishPosition,
    payoutAvailable,
    winPayout: payoutAvailable ? leader.winPayout : null,
    placePayout: payoutAvailable ? leader.placePayout : null,
  };
};

const summarize = (rows) => {
  const payoutRows = rows.filter((row) => row.payoutAvailable);
  const wins = rows.filter((row) => row.leaderFinish === 1).length;
  const places = rows.filter((row) => row.leaderFinish <= 3).length;
  const opponent1Wide = rows.filter((row) => row.leaderFinish <= 3 && row.opponent1Finish <= 3).length;
  const opponent2Wide = rows.filter((row) => row.leaderFinish <= 3 && row.opponent2Finish <= 3).length;
  const eitherWide = rows.filter((row) =>
    row.leaderFinish <= 3 && (row.opponent1Finish <= 3 || row.opponent2Finish <= 3)
  ).length;
  const rate = (count) => rows.length ? round1(count / rows.length * 100) : null;
  return {
    sampleSize: rows.length,
    wins,
    winRate: rate(wins),
    places,
    placeRate: rate(places),
    opponent1Wide,
    opponent1WideRate: rate(opponent1Wide),
    opponent2Wide,
    opponent2WideRate: rate(opponent2Wide),
    eitherWide,
    eitherWideRate: rate(eitherWide),
    payoutSampleSize: payoutRows.length,
    winReturnRate: payoutRows.length ? round1(payoutRows.reduce((sum, row) => sum + row.winPayout, 0) / payoutRows.length) : null,
    placeReturnRate: payoutRows.length ? round1(payoutRows.reduce((sum, row) => sum + row.placePayout, 0) / payoutRows.length) : null,
  };
};

const modelEligible = (candidate) =>
  candidate &&
  candidate.race.category !== "race" &&
  candidate.index >= MODEL_CONFIG.minIndex &&
  candidate.gap >= MODEL_CONFIG.minGap &&
  candidate.confidence !== "low" &&
  candidate.coreCoverage >= 5 / 6 &&
  candidate.opponent2Coverage >= 0.75 &&
  MODEL_FEATURES.every((key) => isFiniteNumber(candidate[key]));

const modelVector = (candidate) => ({
  index: candidate.index,
  gap: candidate.gap,
  leaderCore: candidate.leaderCore,
  weakestCore: candidate.weakestCore,
  risks: candidate.risks,
  opponent1Index: candidate.opponent1Index,
  opponent2Evidence: candidate.opponent2Evidence,
  leaderEv: Math.min(2.5, Math.max(0.2, candidate.leaderEv)),
});

const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
const standardDeviation = (values) => {
  const center = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - center) ** 2, 0) / values.length) || 1;
};
const sigmoid = (value) => value >= 0
  ? 1 / (1 + Math.exp(-value))
  : Math.exp(value) / (1 + Math.exp(value));

const collectModelRows = (days) => {
  const rows = [];
  for (const { date, snapshot, results } of days) {
    const resultsByRace = new Map((results.races ?? []).map((race) => [race.bundleId, race]));
    for (const race of snapshot.races ?? []) {
      const candidate = buildCandidate(race);
      if (!modelEligible(candidate)) continue;
      const result = resultRow(candidate, resultsByRace.get(race.bundleId), date);
      if (!result) continue;
      rows.push({
        candidate,
        result,
        features: modelVector(candidate),
        success: result.leaderFinish <= 3 && (result.opponent1Finish <= 3 || result.opponent2Finish <= 3) ? 1 : 0,
      });
    }
  }
  return rows;
};

const buildModelStandardizer = (rows) => Object.fromEntries(MODEL_FEATURES.map((key) => {
  const values = rows.map((row) => row.features[key]);
  return [key, { mean: mean(values), sd: standardDeviation(values) }];
}));

const standardizedVector = (features, standardizer) => MODEL_FEATURES.map((key) =>
  (features[key] - standardizer[key].mean) / standardizer[key].sd
);

const trainPairModel = (rows, standardizer) => {
  const weights = Array(MODEL_FEATURES.length).fill(0);
  let intercept = 0;
  for (let iteration = 0; iteration < MODEL_CONFIG.iterations; iteration += 1) {
    const gradient = Array(MODEL_FEATURES.length).fill(0);
    let interceptGradient = 0;
    for (const row of rows) {
      const vector = standardizedVector(row.features, standardizer);
      const probability = sigmoid(intercept + vector.reduce((sum, value, index) => sum + value * weights[index], 0));
      const error = probability - row.success;
      interceptGradient += error;
      vector.forEach((value, index) => { gradient[index] += error * value; });
    }
    intercept -= MODEL_CONFIG.learningRate * interceptGradient / rows.length;
    weights.forEach((weight, index) => {
      weights[index] -= MODEL_CONFIG.learningRate * (
        gradient[index] / rows.length + MODEL_CONFIG.ridgeLambda * weight
      );
    });
  }
  return { intercept, weights };
};

const modelProbability = (candidate, model, standardizer) => {
  if (!modelEligible(candidate)) return null;
  const vector = standardizedVector(modelVector(candidate), standardizer);
  return sigmoid(model.intercept + vector.reduce((sum, value, index) => sum + value * model.weights[index], 0));
};

const evaluatePairModel = (days, model, standardizer) => {
  const rows = [];
  const selections = [];
  for (const { date, snapshot, results } of days) {
    const resultsByRace = new Map((results.races ?? []).map((race) => [race.bundleId, race]));
    const selected = (snapshot.races ?? [])
      .map(buildCandidate)
      .filter(modelEligible)
      .map((candidate) => ({ candidate, probability: modelProbability(candidate, model, standardizer) }))
      .filter((row) => row.probability >= MODEL_CONFIG.minProbability)
      .sort((left, right) => right.probability - left.probability || right.candidate.index - left.candidate.index)[0];
    if (!selected) continue;
    const result = resultRow(selected.candidate, resultsByRace.get(selected.candidate.race.bundleId), date);
    if (!result) continue;
    rows.push(result);
    selections.push({
      ...result,
      probability: round1(selected.probability * 100),
      index: selected.candidate.index,
      gap: selected.candidate.gap,
    });
  }
  return { summary: summarize(rows), selections };
};

const evaluate = (days, strategy, mode) => {
  const rows = [];
  for (const { date, snapshot, results } of days) {
    const resultsByRace = new Map((results.races ?? []).map((race) => [race.bundleId, race]));
    const eligible = (snapshot.races ?? [])
      .map(buildCandidate)
      .filter(strategy.eligible)
      .sort((left, right) => strategy.compare(left, right) || String(left.race.time ?? "").localeCompare(String(right.race.time ?? "")));
    const selected = mode === "daily" ? eligible.slice(0, 1) : eligible;
    for (const candidate of selected) {
      const row = resultRow(candidate, resultsByRace.get(candidate.race.bundleId), date);
      if (row) rows.push(row);
    }
  }
  return { summary: summarize(rows), selections: rows };
};

const days = loadFrozenPublicRoleDays({ root: ROOT }).filter((day) =>
  (day.snapshot.races ?? []).some((race) => (day.results.races ?? []).some((result) => result.bundleId === race.bundleId))
);
const trainDays = days.slice(0, -2);
const holdoutDays = days.slice(-2);
const trainingRows = collectModelRows(trainDays);
if (trainingRows.length < 20) throw new Error(`Battle model requires at least 20 training races; got ${trainingRows.length}`);
const modelStandardizer = buildModelStandardizer(trainingRows);
const pairModel = trainPairModel(trainingRows, modelStandardizer);
const reportFor = (strategy) => ({
  raceLevel: {
    train: evaluate(trainDays, strategy, "all").summary,
    holdout: evaluate(holdoutDays, strategy, "all").summary,
    all: evaluate(days, strategy, "all").summary,
  },
  daily: {
    train: evaluate(trainDays, strategy, "daily").summary,
    holdout: evaluate(holdoutDays, strategy, "daily").summary,
    all: evaluate(days, strategy, "daily").summary,
    selections: evaluate(days, strategy, "daily").selections,
  },
});

console.log(JSON.stringify({
  policy: {
    fixedBeforeFirstRun: true,
    productionConnected: false,
    adoptionEligible: false,
    comparability: "diagnostic-only: historical snapshots contain multiple scoring-engine generations",
    trainDates: trainDays.map((day) => day.date),
    holdoutDates: holdoutDays.map((day) => day.date),
  },
  strategies: Object.fromEntries(Object.entries(STRATEGIES).map(([name, strategy]) => [name, reportFor(strategy)])),
  pairModel: {
    config: MODEL_CONFIG,
    training: {
      sampleSize: trainingRows.length,
      successes: trainingRows.filter((row) => row.success === 1).length,
    },
    coefficients: Object.fromEntries(MODEL_FEATURES.map((key, index) => [key, Number(pairModel.weights[index].toFixed(6))])),
    train: evaluatePairModel(trainDays, pairModel, modelStandardizer),
    holdout: evaluatePairModel(holdoutDays, pairModel, modelStandardizer),
    all: evaluatePairModel(days, pairModel, modelStandardizer),
  },
}, null, 2));
