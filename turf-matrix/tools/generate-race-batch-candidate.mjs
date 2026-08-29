#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { selectFeaturedRace } from "./intelligence/race-selector.mjs";
import { buildAnalysis, buildRaceContext, buildRacePaceScenario } from "./intelligence/index.mjs";
import { calibrateRaceIntelligence } from "./intelligence/field-calibration.mjs";
import { buildRaceLoadContext } from "./intelligence/load-ai.mjs";
import { resolveTrackBias } from "./intelligence/track-bias-ai.mjs";

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
const OPPONENT_PATH = join(TOOLS_DIR, "jvlink", "output", "opponent-evidence.json");
const CONDITIONS_PATH = join(TOOLS_DIR, "race-conditions.current.json");
const TRACK_BIAS_PATH = join(TOOLS_DIR, "track-bias.current.json");
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

const raceRunKey = (run) =>
  [run.date, run.course, run.raceName, run.distance].map((value) => String(value ?? "").trim()).join("|");

const enrichPeerRuns = (horses) => {
  const grouped = new Map();
  for (const horse of horses) {
    for (const run of horse.pastRuns ?? []) {
      const key = raceRunKey(run);
      if (!key.replace(/\|/g, "")) continue;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push({ horseName: horse.horseName, horseNumber: horse.horseNumber, run });
    }
  }

  return horses.map((horse) => {
    const peerRuns = [];
    for (const run of horse.pastRuns ?? []) {
      const peers = (grouped.get(raceRunKey(run)) ?? [])
        .filter((item) => item.horseName !== horse.horseName)
        .map((item) => ({
          horseName: item.horseName,
          horseNumber: item.horseNumber,
          finishPosition: item.run.finishPosition,
          margin: item.run.margin,
        }));
      if (peers.length) {
        peerRuns.push({
          date: run.date,
          course: run.course,
          raceName: run.raceName,
          grade: run.grade,
          distance: run.distance,
          finishPosition: run.finishPosition,
          margin: run.margin,
          peers,
        });
      }
    }
    const registrationNumber = horse.currentRace?.horseId ?? horse.pedigree?.bloodRegistrationNumber;
    return {
      ...horse,
      peerRuns,
      opponentEvidence: registrationNumber ? opponentByRegistration.get(registrationNumber) ?? null : null,
    };
  });
};

const races = normalized.races.map((bundle) => {
  const condition = currentConditions.conditions?.[bundle.bundleId] ?? null;
  const snapshotBias = resolveTrackBias(trackBiasSnapshot, bundle.race);
  const race = {
    ...bundle.race,
    weather: condition?.status === "active" ? condition.weather : null,
    going: condition?.status === "active" ? condition.going : null,
    goingUpdatedAt: condition?.status === "active" ? condition.updatedAt : null,
    trackBias: condition?.trackBias ?? snapshotBias ?? bundle.race?.trackBias ?? null,
  };
  const oddsStatus = bundle.productionReady ? "active" : "preodds";
  const enrichedHorses = enrichPeerRuns(bundle.horses);
  const context = {
    ...buildRaceContext(race),
    paceScenario: buildRacePaceScenario(enrichedHorses),
    load: buildRaceLoadContext(enrichedHorses, race),
  };
  const horses = enrichedHorses.map((horse) => {
    const dataStatus = {
      currentRace: "active",
      pastRuns: horse.pastRuns.length ? "active" : "missing",
      training: horse.missing.includes("training") ? "missing" : "active",
      pedigree: horse.missing.includes("pedigree") ? "partial" : "active",
      odds: horse.odds ? "active" : "missing",
      intelligence: "tm-index-v1.7",
    };
    const analysisHorse = { ...horse, dataStatus };
    const intelligence = buildAnalysis(analysisHorse, context);
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
      pastRuns: horse.pastRuns,
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
    dataStatus: races.length ? (races.every((race) => race.oddsStatus === "active") ? "odds-ready" : "preodds") : "missing",
    source: "target-frontier-jv-race-batch",
    featuredRaceId: null,
    oddsUpdatedAt,
    oddsStatus: races.length && races.every((race) => race.oddsStatus === "active") ? "active" : races.length ? "preodds" : "missing",
  },
  races,
};

draft.meta.featuredRaceId = selectFeaturedRace(draft)?.id ?? null;

writeFileSync(OUT_PATH, JSON.stringify(draft, null, 2) + "\n");
console.log(JSON.stringify({ out: OUT_PATH, raceCount: races.length, featuredRaceId: draft.meta.featuredRaceId }, null, 2));
