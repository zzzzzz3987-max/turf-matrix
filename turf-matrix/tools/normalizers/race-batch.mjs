#!/usr/bin/env node
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeRaceBundle } from "./race-bundle.mjs";

const TOOLS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = join(TOOLS_DIR, "..");
const CSV_RACES = join(TOOLS_DIR, "csv", "input", "races");
const HTML_RACES = join(TOOLS_DIR, "target-html", "input", "races");
const OUT_PATH = join(TOOLS_DIR, "week-data.batch-normalized.json");
const CONFIG_PATH = join(TOOLS_DIR, "race-batch-config.json");
const repoPath = (path) => relative(REPO_ROOT, path).replaceAll("\\", "/");
const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));

const bundleIds = readdirSync(CSV_RACES, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

if (bundleIds.length) {
  const missing = config.bundles.filter((bundleId) => !bundleIds.includes(bundleId));
  const unexpected = bundleIds.filter((bundleId) => !config.bundles.includes(bundleId));
  if (missing.length || unexpected.length || bundleIds.length !== config.expectedRaceCount) {
    throw new Error(`Race bundle set mismatch. missing=${missing.join(",") || "none"} unexpected=${unexpected.join(",") || "none"}`);
  }
}

const races = bundleIds.map((bundleId) => {
  const csvDir = join(CSV_RACES, bundleId);
  const htmlDir = join(HTML_RACES, bundleId);
  return normalizeRaceBundle({
    bundleId,
    csv: {
      currentRace: repoPath(join(csvDir, "current-race-detail.csv")),
      all: repoPath(join(csvDir, "all.csv")),
      odds: repoPath(join(csvDir, "odds.csv")),
    },
    html: {
      trainingSlope: repoPath(join(htmlDir, "training-slope.html")),
      trainingWood: repoPath(join(htmlDir, "training-wood.html")),
      pedigree: repoPath(join(htmlDir, "pedigree")),
    },
  });
});

for (const bundle of races) {
  if (bundle.race.raceDate !== config.raceDate) {
    throw new Error(`${bundle.bundleId}: race date ${bundle.race.raceDate} does not match ${config.raceDate}`);
  }
}

const output = {
  schemaVersion: 1,
  mode: "race-batch-normalized",
  deterministicOutput: true,
  generatedAt: null,
  productionWeekDataUpdated: false,
  raceCount: races.length,
  expectedRaceCount: config.expectedRaceCount,
  raceDate: config.raceDate,
  races,
};

writeFileSync(OUT_PATH, JSON.stringify(output, null, 2) + "\n");
console.log(JSON.stringify({ out: OUT_PATH, raceCount: races.length, bundles: bundleIds }, null, 2));
