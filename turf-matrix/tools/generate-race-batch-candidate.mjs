#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { resolveGoingForecast } from "./intelligence/going-forecast.mjs";
import { selectFeaturedRace } from "./intelligence/race-selector.mjs";
import { buildAnalysis, buildRaceContext, buildRacePaceScenario } from "./intelligence/index.mjs";
import { calibrateRaceIntelligence } from "./intelligence/field-calibration.mjs";
import { buildRaceLoadContext } from "./intelligence/load-ai.mjs";
import { resolveTrackBias } from "./intelligence/track-bias-ai.mjs";
import { buildEngineFingerprint } from "./intelligence/engine-fingerprint.mjs";
import { buildRaceShapeIndex } from "./intelligence/race-shape-history.mjs";
import { enrichPeerRuns } from "./intelligence/peer-run-enrichment.mjs";
import { buildClosingReferenceFromExports, attachClosingEvidence, indexClosingReference } from "./intelligence/closing-benchmark.mjs";

const TOOLS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(TOOLS_DIR, "..");
const resolveOutputPath = (value, fallback) => value
  ? (isAbsolute(value) ? value : join(REPO_ROOT, value))
  : fallback;
const INPUT_PATH = resolveOutputPath(
  process.env.TURF_MATRIX_BATCH_NORMALIZED_IN,
  join(TOOLS_DIR, "week-data.batch-normalized.json"),
);
const OUT_PATH = resolveOutputPath(
  process.env.TURF_MATRIX_BATCH_CANDIDATE_OUT,
  join(TOOLS_DIR, "week-data.batch-candidate.json"),
);
const CONFIG_PATH = process.env.TURF_MATRIX_RACE_CONFIG
  ? (isAbsolute(process.env.TURF_MATRIX_RACE_CONFIG)
      ? process.env.TURF_MATRIX_RACE_CONFIG
      : join(TOOLS_DIR, "..", process.env.TURF_MATRIX_RACE_CONFIG))
  : join(TOOLS_DIR, "race-batch-config.json");
const goingScenario = process.env.TURF_MATRIX_GOING_SCENARIO
  ? JSON.parse(process.env.TURF_MATRIX_GOING_SCENARIO) : null;
if (goingScenario && (!process.env.TURF_MATRIX_BATCH_CANDIDATE_OUT
  || ["week-data.json", "week-data.next.json", "week-data.batch-candidate.json"].some((name) => OUT_PATH === join(TOOLS_DIR, name)))) {
  throw new Error("Going scenarios require a separate analysis output.");
}
if (goingScenario && (!goingScenario.track || !["良", "稍重", "重", "不良"].includes(goingScenario.going))) {
  throw new Error("Invalid going scenario.");
}
const OPPONENT_PATH = join(TOOLS_DIR, "jvlink", "output", "opponent-evidence.json");
const CONDITIONS_PATH = join(TOOLS_DIR, "race-conditions.current.json");
const TRACK_BIAS_PATH = join(TOOLS_DIR, "track-bias.current.json");
const FORECAST_PATH = join(TOOLS_DIR, "going-forecast.json");
const goingForecast = existsSync(FORECAST_PATH) ? JSON.parse(readFileSync(FORECAST_PATH, "utf8")) : null;
const RACE_SHAPE_HISTORY_PATH = join(REPO_ROOT, "data", "master", "race-shape-history.json");
const normalized = JSON.parse(readFileSync(INPUT_PATH, "utf8"));
const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
const currentConditions = existsSync(CONDITIONS_PATH)
  ? JSON.parse(readFileSync(CONDITIONS_PATH, "utf8"))
  : { conditions: {} };
const trackBiasSnapshot = existsSync(TRACK_BIAS_PATH)
  ? JSON.parse(readFileSync(TRACK_BIAS_PATH, "utf8"))
  : null;
const opponentEvidence = existsSync(OPPONENT_PATH)
  ? JSON.parse(readFileSync(OPPONENT_PATH, "utf8"))
  : { records: [] };
const raceShapeHistory = existsSync(RACE_SHAPE_HISTORY_PATH)
  ? JSON.parse(readFileSync(RACE_SHAPE_HISTORY_PATH, "utf8"))
  : { races: [] };
const raceShapeIndex = buildRaceShapeIndex(raceShapeHistory);
const closingDirectory = join(TOOLS_DIR, "jvlink", "output", "race-shape-history");
const closingReference = buildClosingReferenceFromExports(existsSync(closingDirectory)
  ? readdirSync(closingDirectory).filter((name) => name.endsWith(".json")).sort()
    .map((name) => JSON.parse(readFileSync(join(closingDirectory, name), "utf8"))) : []);
const closingIndex = indexClosingReference(closingReference);
const opponentByRegistration = new Map(
  (opponentEvidence.records ?? []).map((record) => [record.bloodRegistrationNumber, record]),
);

const categoryForRace = (race) => {
  const grade = String(race.grade ?? "").trim();
  const name = String(race.raceName ?? "").trim();
  if (/^G[1-3]$|^G[ⅠⅡⅢ]$|^J[.・]G[1-3ⅠⅡⅢ]$/i.test(grade)) return "grade";
  if (grade || /特別|ステークス|S$|賞|記念/.test(name)) return "special";
  return "race";
};


const races = normalized.races.map((bundle) => {
  const condition = currentConditions.conditions?.[bundle.bundleId] ?? null;
  const snapshotBias = resolveTrackBias(trackBiasSnapshot, bundle.race);
  const forecast = resolveGoingForecast(bundle.race, condition, goingForecast);
  const race = {
    ...bundle.race,
    weather: condition?.status === "active" ? condition.weather : null,
    going: condition?.status === "active" ? condition.going : null,
    goingUpdatedAt: condition?.status === "active" ? condition.updatedAt : null,
    trackBias: condition?.trackBias ?? snapshotBias ?? bundle.race?.trackBias ?? null,
  };
  if (forecast) {
    race.going = forecast.going;
    race.goingUpdatedAt = null;
    race.trackBias = null;
  }
  if (goingScenario?.track === race.course) {
    race.going = goingScenario.going;
    race.goingUpdatedAt = null;
    race.trackBias = null;
  }
  const oddsStatus = bundle.source.odds.status === "partial"
    ? "partial"
    : bundle.productionReady
      ? "active"
      : "preodds";
  const enrichedHorses = enrichPeerRuns(bundle.horses, opponentByRegistration);
  const context = {
    ...buildRaceContext(race),
    paceScenario: buildRacePaceScenario(enrichedHorses),
    load: buildRaceLoadContext(enrichedHorses, race),
  };
  const analysisContext = { ...context, raceShapeHistory: raceShapeIndex };
  const horses = enrichedHorses.map((horse) => {
    const dataStatus = {
      currentRace: "active",
      pastRuns: horse.pastRuns.length ? "active" : "missing",
      training: horse.missing.includes("training") ? "missing" : "active",
      pedigree: horse.missing.includes("pedigree") ? "partial" : "active",
      odds: Number.isFinite(horse.odds?.winOdds) ? "active" : "missing",
      intelligence: "tm-index-v1.7",
    };
    const analysisHorse = attachClosingEvidence({ ...horse, dataStatus }, closingIndex);
    const intelligence = buildAnalysis(analysisHorse, analysisContext);
    return {
      id: horse.raceEntryId,
      number: horse.horseNumber,
      name: horse.horseName,
      sex: horse.currentRace.sex,
      age: horse.currentRace.age,
      sexAge: horse.currentRace.sexAge,
      jockey: horse.currentRace.jockey,
      carriedWeight: horse.currentRace.carriedWeight,
      trainer: horse.currentRace.trainer,
      stableSide: horse.currentRace.stableSide,
      owner: horse.currentRace.owner,
      breeder: horse.currentRace.breeder,
      coatColor: horse.currentRace.coatColor,
      odds: horse.odds?.winOdds ?? null,
      popularity: horse.odds?.popularity ?? null,
      oddsDetail: horse.odds,
      tmIndex: intelligence.tmIndex,
      tmValue: intelligence.tmValue,
      comment: intelligence.comment,
      analysis: intelligence.analysis,
      currentRace: horse.currentRace,
      pastRuns: analysisHorse.pastRuns,
      peerRuns: horse.peerRuns,
      opponentEvidence: horse.opponentEvidence,
      training: horse.training,
      pedigree: horse.pedigree,
      dataStatus,
    };
  });

  return calibrateRaceIntelligence({
    id: `${race.raceDate}-${race.course}-${race.raceNo}R`,
    bundleId: bundle.bundleId,
    track: race.course,
    number: race.raceNo,
    name: race.raceName || `${race.course}${race.raceNo}R`,
    nameRaw: race.raceNameRaw,
    grade: race.grade,
    category: categoryForRace(race),
    time: race.time ?? null,
    surface: race.surface,
    distance: race.distance,
    weather: race.weather,
    going: race.going,
    goingBasis: forecast ? "forecast" : "official",
    goingLabel: forecast?.label ?? null,
    goingUpdatedAt: race.goingUpdatedAt,
    trackBias: race.trackBias,
    courseType: null,
    conditionSummary: null,
    fieldSize: race.fieldSize,
    oddsUpdatedAt: bundle.source.odds.updatedAt,
    oddsStatus,
    oddsSource: bundle.source.odds.source,
    dataStatus: {
      currentRace: "active",
      pastRuns: bundle.horses.every((horse) => horse.pastRuns.length) ? "active" : "partial",
      odds: oddsStatus,
      intelligence: "tm-index-v1.7",
    },
    raceContext: context,
    horses,
  });
});

const oddsUpdatedAt = races
  .map((race) => race.oddsUpdatedAt)
  .filter(Boolean)
  .sort()
  .slice(-1)[0] ?? null;
const engineFingerprint = buildEngineFingerprint({ root: REPO_ROOT });

const draft = {
  schemaVersion: 2,
  mode: "candidate",
  deterministicOutput: true,
  generatedAt: null,
  productionWeekDataUpdated: false,
  intelligenceLayerConnected: races.length > 0,
  intelligenceStage: races.length ? "tm-index-v1.7" : "pending",
  uiConnected: true,
  meta: {
    date: races[0]?.id.slice(0, 10) ?? config.raceDate,
    dateLabel: races[0]?.id.slice(0, 10) ?? config.raceDate,
    venue: [...new Set(races.map((race) => race.track))].join(" / ") || "更新準備中",
    dataStatus: races.length
      ? races.every((race) => race.oddsStatus === "active")
        ? "odds-ready"
        : races.every((race) => ["active", "partial"].includes(race.oddsStatus))
          ? "odds-partial"
          : "preodds"
      : "missing",
    source: "target-frontier-jv-race-batch",
    featuredRaceId: null,
    oddsUpdatedAt,
    oddsStatus: races.length && races.every((race) => race.oddsStatus === "active")
      ? "active"
      : races.length && races.every((race) => ["active", "partial"].includes(race.oddsStatus))
        ? "partial"
        : races.length
          ? "preodds"
          : "missing",
    engineFingerprint,
    contextPreview: process.env.TURF_MATRIX_CONTEXT_PREVIEW === "1",
    ...(goingScenario ? { goingScenario: { ...goingScenario, status: "hypothetical", official: false }, previewMode: true } : {}),
    closingReference: { rows: closingReference.length, policy: "closing-context-v1",
      sha256: createHash("sha256").update(JSON.stringify(closingReference)).digest("hex") },
    raceShapeHistory: {
      status: raceShapeIndex.size ? "active" : "missing",
      raceCount: raceShapeHistory.races?.length ?? 0,
      generatedAt: raceShapeHistory.generatedAt ?? null,
    },
  },
  races,
};

draft.meta.featuredRaceId = selectFeaturedRace(draft)?.id ?? null;

writeFileSync(OUT_PATH, JSON.stringify(draft, null, 2) + "\n");
console.log(JSON.stringify({ out: OUT_PATH, raceCount: races.length, featuredRaceId: draft.meta.featuredRaceId }, null, 2));
