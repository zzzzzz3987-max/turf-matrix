#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as allCsvParser from "../parsers/all-csv-parser.mjs";
import * as pedigreeHtmlParser from "../parsers/pedigree-html-parser.mjs";
import * as trainingSlopeHtmlParser from "../parsers/training-slope-html-parser.mjs";
import * as trainingWoodHtmlParser from "../parsers/training-wood-html-parser.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const TOOLS_DIR = join(SCRIPT_DIR, "..");
const OUT_PATH = join(TOOLS_DIR, "week-data.normalized.json");

const groupByHorse = (records) => {
  const map = new Map();
  for (const record of records) {
    if (!record.horseName) continue;
    if (!map.has(record.horseName)) map.set(record.horseName, []);
    map.get(record.horseName).push(record);
  }
  return map;
};

const all = allCsvParser.parse();
const slope = trainingSlopeHtmlParser.parse();
const wood = trainingWoodHtmlParser.parse();
const pedigree = pedigreeHtmlParser.parse();

const allByHorse = new Map(all.horses.map((horse) => [horse.horseName, horse]));
const slopeByHorse = groupByHorse(slope.records);
const woodByHorse = groupByHorse(wood.records);
const pedigreeByHorse = new Map(pedigree.records.map((record) => [record.horseName, record]));

const normalized = [];
const joinFailures = [];

for (const [horseName, allRecord] of allByHorse) {
  const training = {
    slope: slopeByHorse.get(horseName) ?? [],
    wood: woodByHorse.get(horseName) ?? [],
  };
  const pedigreeRecord = pedigreeByHorse.get(horseName) ?? null;
  const missing = [];

  if (!training.slope.length && !training.wood.length) missing.push("training");
  if (!pedigreeRecord) missing.push("pedigree");

  if (missing.length) {
    joinFailures.push({ horseName, missing });
  }

  normalized.push({
    horseName,
    all: allRecord.all,
    training,
    pedigree: pedigreeRecord,
    joinStatus: missing.length ? "partial" : "joined",
    missing,
  });
}

for (const horseName of pedigreeByHorse.keys()) {
  if (!allByHorse.has(horseName)) joinFailures.push({ horseName, missing: ["all"] });
}

const output = {
  schemaVersion: 1,
  mode: "rc1b-normalized",
  generatedAt: new Date().toISOString(),
  productionWeekDataUpdated: false,
  intelligenceLayerConnected: false,
  uiConnected: false,
  source: {
    allCsv: {
      rows: all.rowCount,
      horses: all.horseCount,
      encoding: all.encoding,
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
  sample: output.horses[0] ?? null,
}, null, 2));
