#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { selectFeaturedRace } from "./intelligence/race-selector.mjs";
import { buildAnalysis, buildRaceContext } from "./intelligence/index.mjs";

const TOOLS_DIR = dirname(fileURLToPath(import.meta.url));
const INPUT_PATH = join(TOOLS_DIR, "week-data.batch-normalized.json");
const OUT_PATH = join(TOOLS_DIR, "week-data.batch-candidate.json");
const CONFIG_PATH = join(TOOLS_DIR, "race-batch-config.json");
const normalized = JSON.parse(readFileSync(INPUT_PATH, "utf8"));
const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));

const races = normalized.races.map((bundle) => {
  const race = bundle.race;
  const context = buildRaceContext(race);
  const oddsStatus = bundle.productionReady ? "active" : "preodds";
  const horses = bundle.horses.map((horse) => {
    const dataStatus = {
      currentRace: "active",
      pastRuns: horse.pastRuns.length ? "active" : "missing",
      training: horse.missing.includes("training") ? "missing" : "active",
      pedigree: horse.missing.includes("pedigree") ? "partial" : "active",
      odds: horse.odds ? "active" : "missing",
      intelligence: "tm-index-v1",
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
  return {
    id: `${race.raceDate}-${race.course}-${race.raceNo}R`,
    bundleId: bundle.bundleId,
    track: race.course,
    number: race.raceNo,
    name: race.raceName,
    nameRaw: race.raceNameRaw,
    grade: race.grade,
    category: race.grade ? "grade" : "special",
    time: null,
    surface: race.surface,
    distance: race.distance,
    weather: null,
    going: null,
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
      intelligence: "tm-index-v1",
    },
    raceContext: context,
    horses,
  };
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
  intelligenceStage: races.length ? "tm-index-v1" : "pending",
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
