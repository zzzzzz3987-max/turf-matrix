#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inspectParserInputs } from "./parsers/index.mjs";
import { readTextSmart } from "./parsers/parser-contract.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const ALL_CSV_PATH = resolve(REPO_ROOT, "tools/csv/input/all.csv");
const ODDS_CSV_PATH = resolve(REPO_ROOT, "tools/csv/input/odds.csv");

const parseCsv = (text) => {
  const rows = [];
  let row = [];
  let current = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === "\"") {
        if (text[i + 1] === "\"") {
          current += "\"";
          i++;
        } else {
          quoted = false;
        }
      } else {
        current += char;
      }
    } else if (char === "\"") {
      quoted = true;
    } else if (char === ",") {
      row.push(current);
      current = "";
    } else if (char === "\n") {
      row.push(current);
      rows.push(row);
      row = [];
      current = "";
    } else if (char !== "\r") {
      current += char;
    }
  }

  if (current !== "" || row.length) {
    row.push(current);
    rows.push(row);
  }

  return rows.filter((record) => record.some((cell) => String(cell).trim().length > 0));
};

const summarizeAllCsv = () => {
  if (!existsSync(ALL_CSV_PATH)) {
    return {
      exists: false,
      path: ALL_CSV_PATH,
      note: "all.csv is required for RC1-B inspection.",
    };
  }

  const stats = statSync(ALL_CSV_PATH);
  const { text, encoding } = readTextSmart(ALL_CSV_PATH);
  const rows = parseCsv(text);
  const columnCounts = rows.map((row) => row.length);
  const uniqueHorseNames = new Set(rows.map((row) => String(row[13] ?? "").trim()).filter(Boolean));

  return {
    exists: true,
    path: ALL_CSV_PATH,
    bytes: stats.size,
    updatedAt: stats.mtime.toISOString(),
    encoding,
    rows: rows.length,
    minColumns: Math.min(...columnCounts),
    maxColumns: Math.max(...columnCounts),
    fixedColumnProfile: rows.length > 0 && Math.min(...columnCounts) === Math.max(...columnCounts),
    uniqueHorseCountByColumn14: uniqueHorseNames.size,
    extractionCandidates: {
      race: {
        columns: [1, 2, 3, 5, 7, 8, 10, 12, 13],
        labels: ["year", "month", "day", "track", "raceNo", "raceName", "surface", "distance", "going"],
      },
      horse: {
        columns: [14, 15, 16, 17, 18, 35, 36, 38, 47, 48],
        labels: ["name", "sex", "age", "jockey", "carriedWeight", "trainer", "stableSide", "horseId", "color", "birthDate"],
      },
      pedigree: {
        columns: [44, 45, 46, 55, 56],
        labels: ["sire", "dam", "damSire", "sireLine", "damLine"],
      },
      recentForm: {
        columns: [19, 20, 21, 22, 23, 24, 25, 26, 27, 29, 30, 31, 32, 33],
        labels: ["fieldSize", "popularity", "finish", "confirmedFinish", "surfaceCode", "margin", "horseNoCandidate", "timeSeconds", "timeText", "corner1", "corner2", "corner3", "corner4", "last3F"],
      },
      zi: {
        columns: [52, 58, 59],
        labels: ["ziCandidate", "indexCandidate1", "indexCandidate2"],
      },
      bodyWeight: {
        columns: [34, 66],
        labels: ["bodyWeight", "bodyWeightDiff"],
      },
      runningStyle: {
        columns: [54],
        labels: ["runningStyle"],
      },
    },
  };
};

const result = {
  mode: "RC1-B input inspection",
  generatedAt: new Date().toISOString(),
  productionWeekDataUpdated: false,
  intelligenceLayerConnected: false,
  uiConnected: false,
  odds: {
    exists: existsSync(ODDS_CSV_PATH),
    path: ODDS_CSV_PATH,
    note: "odds.csv is expected later. Production update must wait for odds.",
  },
  allCsv: summarizeAllCsv(),
  parserInputs: inspectParserInputs(),
};

console.log(JSON.stringify(result, null, 2));
