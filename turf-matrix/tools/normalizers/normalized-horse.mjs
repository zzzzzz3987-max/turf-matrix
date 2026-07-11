#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as allCsvParser from "../parsers/all-csv-parser.mjs";
import * as currentRaceDetailParser from "../parsers/current-race-detail-parser.mjs";
import * as oddsCsvParser from "../parsers/odds-csv-parser.mjs";
import * as pedigreeHtmlParser from "../parsers/pedigree-html-parser.mjs";
import * as trainingSlopeHtmlParser from "../parsers/training-slope-html-parser.mjs";
import * as trainingWoodHtmlParser from "../parsers/training-wood-html-parser.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const TOOLS_DIR = join(SCRIPT_DIR, "..");
const OUT_PATH = join(TOOLS_DIR, "week-data.normalized.json");

const normalizeHorseKey = (value) =>
  String(value ?? "")
    .normalize("NFKC")
    .replace(/\u3000/g, " ")
    .replace(/\s+/g, "")
    .trim();

const groupByHorse = (records) => {
  const map = new Map();
  for (const record of records) {
    const key = normalizeHorseKey(record.horseName);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(record);
  }
  return map;
};

const mapByHorse = (records) => {
  const map = new Map();
  for (const record of records) {
    const key = normalizeHorseKey(record.horseName);
    if (!key) continue;
    map.set(key, record);
  }
  return map;
};

const mapByHorseNumber = (records) => {
  const map = new Map();
  for (const record of records) {
    if (record.horseNumber == null) continue;
    map.set(record.horseNumber, record);
  }
  return map;
};

const all = allCsvParser.parse();
const currentRaceDetail = currentRaceDetailParser.parse();
const odds = oddsCsvParser.parse();
const slope = trainingSlopeHtmlParser.parse();
const wood = trainingWoodHtmlParser.parse();
const pedigree = pedigreeHtmlParser.parse();

const allByHorse = mapByHorse(all.horses);
const currentByHorse = mapByHorse(currentRaceDetail.entries);
const oddsByHorseNumber = mapByHorseNumber(odds.entries);
const slopeByHorse = groupByHorse(slope.records);
const woodByHorse = groupByHorse(wood.records);
const pedigreeByHorse = mapByHorse(pedigree.records);

const normalized = [];
const joinFailures = [];

for (const [horseKey, allRecord] of allByHorse) {
  const horseName = allRecord.horseName;
  const currentEntry = currentByHorse.get(horseKey) ?? null;
  const oddsEntry = currentEntry ? oddsByHorseNumber.get(currentEntry.horseNumber) ?? null : null;
  const training = {
    slope: slopeByHorse.get(horseKey) ?? [],
    wood: woodByHorse.get(horseKey) ?? [],
  };
  const pedigreeRecord = pedigreeByHorse.get(horseKey) ?? null;
  const missing = [];

  if (!currentEntry) missing.push("currentRace");
  if (!oddsEntry) missing.push("odds");
  if (!training.slope.length && !training.wood.length) missing.push("training");
  if (!pedigreeRecord) missing.push("pedigree");

  if (currentEntry && oddsEntry && normalizeHorseKey(currentEntry.horseName) !== normalizeHorseKey(oddsEntry.horseName)) {
    missing.push("oddsNameMismatch");
  }

  if (missing.length) {
    joinFailures.push({ horseName, missing });
  }

  normalized.push({
    horseName,
    horseNumber: currentEntry?.horseNumber ?? null,
    raceEntryId: currentEntry?.raceEntryId ?? null,
    currentRace: currentEntry
      ? {
          raceDate: currentEntry.raceDate,
          course: currentEntry.course,
          raceNo: currentEntry.raceNo,
          raceName: currentEntry.raceName,
          raceNameRaw: currentEntry.raceNameRaw,
          grade: currentEntry.grade,
          surface: currentEntry.surface,
          distance: currentEntry.distance,
          horseNumber: currentEntry.horseNumber,
          horseName: currentEntry.horseName,
          sex: currentEntry.sex,
          age: currentEntry.age,
          sexAge: `${currentEntry.sex ?? ""}${currentEntry.age ?? ""}` || null,
          jockey: currentEntry.jockey,
          carriedWeight: currentEntry.carriedWeight,
          trainer: currentEntry.trainer,
          stableSide: currentEntry.stableSide,
          owner: currentEntry.owner,
          breeder: currentEntry.breeder,
          sire: currentEntry.sire,
          dam: currentEntry.dam,
          broodmareSire: currentEntry.broodmareSire,
          coatColor: currentEntry.coatColor,
          raceEntryId: currentEntry.raceEntryId,
        }
      : allRecord.currentRace,
    pastRuns: allRecord.pastRuns,
    odds: oddsEntry
      ? {
          popularity: oddsEntry.popularity,
          frameNumber: oddsEntry.frameNumber,
          horseNumber: oddsEntry.horseNumber,
          horseName: oddsEntry.horseName,
          jockey: oddsEntry.jockey,
          zi: oddsEntry.zi,
          winOdds: oddsEntry.winOdds,
          updatedAt: odds.updatedAt,
          source: odds.source,
          status: odds.status,
          sourceStatus: odds.status,
        }
      : null,
    training,
    pedigree: pedigreeRecord,
    joinStatus: missing.length ? "partial" : "joined",
    missing,
  });
}

for (const [horseKey, pedigreeRecord] of pedigreeByHorse) {
  if (!allByHorse.has(horseKey)) joinFailures.push({ horseName: pedigreeRecord.horseName, missing: ["all"] });
}

for (const [horseKey, currentEntry] of currentByHorse) {
  if (!allByHorse.has(horseKey)) joinFailures.push({ horseName: currentEntry.horseName, missing: ["all"] });
}

for (const oddsEntry of odds.entries) {
  const currentEntry = currentRaceDetail.entries.find((entry) => entry.horseNumber === oddsEntry.horseNumber);
  if (!currentEntry) joinFailures.push({ horseName: oddsEntry.horseName, missing: ["currentRace"] });
}

const output = {
  schemaVersion: 2,
  mode: "rc1b-normalized",
  generatedAt: null,
  deterministicOutput: true,
  productionWeekDataUpdated: false,
  intelligenceLayerConnected: false,
  uiConnected: false,
  notes: [
    "all.csv rows are treated as pastRuns, not currentRace rows.",
    "currentRace fields are sourced from current-race-detail.csv.",
  ],
  source: {
    currentRaceDetail: {
      rows: currentRaceDetail.rowCount,
      entries: currentRaceDetail.entryCount,
      encoding: currentRaceDetail.encoding,
      race: currentRaceDetail.race,
    },
    allCsv: {
      rows: all.rowCount,
      horses: all.horseCount,
      encoding: all.encoding,
    },
    odds: {
      rows: odds.rowCount,
      entries: odds.entryCount,
      encoding: odds.encoding,
      updatedAt: odds.updatedAt,
      source: odds.source,
      status: odds.status,
    },
    trainingSlope: {
      rows: slope.rowCount,
      encoding: slope.encoding,
    },
    trainingWood: {
      rows: wood.rowCount,
      encoding: wood.encoding,
    },
    pedigree: {
      records: pedigree.recordCount,
    },
  },
  join: {
    totalAllHorses: allByHorse.size,
    success: normalized.filter((record) => record.joinStatus === "joined").length,
    partial: normalized.filter((record) => record.joinStatus === "partial").length,
    oddsSuccess: normalized.filter((record) => record.odds?.sourceStatus === "active").length,
    oddsMissing: normalized.filter((record) => !record.odds).map((record) => record.horseName),
    failureCount: joinFailures.length,
    failures: joinFailures,
  },
  horses: normalized,
};

writeFileSync(OUT_PATH, JSON.stringify(output, null, 2) + "\n");

console.log(JSON.stringify({
  out: OUT_PATH,
  totalAllHorses: output.join.totalAllHorses,
  joinSuccess: output.join.success,
  joinPartial: output.join.partial,
  joinFailureCount: output.join.failureCount,
  firstHorse: output.horses[0] ?? null,
}, null, 2));
