#!/usr/bin/env node
import { existsSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { detectHtmlInputs } from "./target-html/detect-html-inputs.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CSV_INPUT_DIR = join(SCRIPT_DIR, "csv", "input");
const OUT_PATH = join(SCRIPT_DIR, "week-data.preodds.json");
const MISSING = "\u672a\u53d6\u5f97";

const fileInfo = (name) => {
  const path = join(CSV_INPUT_DIR, name);
  if (!existsSync(path)) return { file: name, exists: false };
  const stats = statSync(path);
  return {
    file: name,
    exists: true,
    bytes: stats.size,
    updatedAt: stats.mtime.toISOString(),
  };
};

const csv = {
  all: fileInfo("all.csv"),
  odds: fileInfo("odds.csv"),
};

const preodds = {
  schemaVersion: 1,
  mode: "preodds",
  generatedAt: new Date().toISOString(),
  status: csv.all.exists ? "ready_for_odds" : "missing_all_csv",
  publishable: false,
  sourcePolicy: {
    updatesWeekData: false,
    requiresOddsForProduction: true,
    dummyOddsAllowed: false,
    approximateOddsAllowed: false,
  },
  csv,
  html: detectHtmlInputs(),
  oddsDependentFields: {
    odds: { status: MISSING },
    popularity: { status: MISSING },
    ev: { status: MISSING },
    valueAi: { status: MISSING },
    tmValue: { status: MISSING },
  },
  nextStep: "Add tools/csv/input/odds.csv on Friday, then run npm run weekly:update for production.",
};

writeFileSync(OUT_PATH, JSON.stringify(preodds, null, 2) + "\n");
console.log(`Generated ${OUT_PATH}`);

if (!csv.all.exists) {
  console.warn("all.csv is missing. preodds file is a readiness manifest only.");
}

if (!csv.odds.exists) {
  console.warn("odds.csv is missing by design for preodds. Production week-data.json was not changed.");
}
