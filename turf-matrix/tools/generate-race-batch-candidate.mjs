#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { selectFeaturedRace } from "./intelligence/race-selector.mjs";

const TOOLS_DIR = dirname(fileURLToPath(import.meta.url));
const INPUT_PATH = join(TOOLS_DIR, "week-data.batch-normalized.json");
const OUT_PATH = join(TOOLS_DIR, "week-data.batch-candidate.json");
const normalized = JSON.parse(readFileSync(INPUT_PATH, "utf8"));

const races = normalized.races.map((bundle) => {
  const race = bundle.race;
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
    oddsStatus: bundle.productionReady ? "active" : "missing",
    oddsSource: bundle.source.odds.source,
    dataStatus: {
      currentRace: "active",
      pastRuns: bundle.horses.every((horse) => horse.pastRuns.length) ? "active" : "partial",
      odds: bundle.productionReady ? "active" : "missing",
      intelligence: "pending",
    },
    horses: bundle.horses.map((horse) => ({
      id: horse.raceEntryId,
      number: horse.horseNumber,
      name: horse.horseName,
      jockey: horse.currentRace.jockey,
      odds: horse.odds?.winOdds ?? null,
      popularity: horse.odds?.popularity ?? null,
      tmIndex: null,
      tmValue: null,
      comment: null,
      analysis: null,
      currentRace: horse.currentRace,
      pastRuns: horse.pastRuns,
      training: horse.training,
      pedigree: horse.pedigree,
      dataStatus: {
        currentRace: "active",
        pastRuns: horse.pastRuns.length ? "active" : "missing",
        training: horse.missing.includes("training") ? "missing" : "active",
        pedigree: horse.missing.includes("pedigree") ? "missing" : "active",
        odds: horse.odds ? "active" : "missing",
        intelligence: "pending",
      },
    })),
  };
});

const draft = {
  schemaVersion: 2,
  mode: "candidate",
  deterministicOutput: true,
  generatedAt: null,
  productionWeekDataUpdated: false,
  intelligenceLayerConnected: false,
  intelligenceStage: "pending",
  uiConnected: true,
  meta: {
    date: races[0]?.id.slice(0, 10) ?? "2026-07-19",
    dateLabel: races[0]?.id.slice(0, 10) ?? "2026-07-19",
    venue: [...new Set(races.map((race) => race.track))].join(" / ") || "更新準備中",
    dataStatus: races.length ? "input-ready" : "missing",
    source: "target-frontier-jv-race-batch",
    featuredRaceId: null,
    oddsUpdatedAt: null,
    oddsStatus: races.length && races.every((race) => race.oddsStatus === "active") ? "active" : "missing",
  },
  races,
};
draft.meta.featuredRaceId = selectFeaturedRace(draft)?.id ?? null;

writeFileSync(OUT_PATH, JSON.stringify(draft, null, 2) + "\n");
console.log(JSON.stringify({ out: OUT_PATH, raceCount: races.length, featuredRaceId: draft.meta.featuredRaceId }, null, 2));
