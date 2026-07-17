#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import * as currentRaceParser from "./parsers/current-race-detail-parser.mjs";
import * as oddsParser from "./parsers/odds-csv-parser.mjs";
import { REPO_ROOT } from "./parsers/parser-contract.mjs";

const CSV_INPUT = join(REPO_ROOT, "tools", "csv", "input");
const HTML_INPUT = join(REPO_ROOT, "tools", "target-html", "input");
const RACES_INPUT = join(CSV_INPUT, "races");
const HTML_RACES_INPUT = join(HTML_INPUT, "races");
const CONFIG = JSON.parse(readFileSync(join(REPO_ROOT, "tools", "race-batch-config.json"), "utf8"));

const repoPath = (path) => relative(REPO_ROOT, path).replaceAll("\\", "/");
const htmlStatus = (bundleId) => {
  const dir = join(HTML_RACES_INPUT, bundleId);
  const pedigreeDir = join(dir, "pedigree");
  return {
    trainingSlope: existsSync(join(dir, "training-slope.csv")) || existsSync(join(dir, "training-slope.html")),
    trainingWood: existsSync(join(dir, "training-wood.csv")) || existsSync(join(dir, "training-wood.html")),
    pedigreeFiles: existsSync(pedigreeDir)
      ? readdirSync(pedigreeDir).filter((name) => /\.html?$/i.test(name)).length
      : 0,
  };
};

const inspectBundle = (bundleId, dir, { legacy = false } = {}) => {
  const currentPath = join(dir, "current-race-detail.csv");
  const allPath = join(dir, "all.csv");
  const oddsPath = join(dir, "odds.csv");
  const result = {
    bundleId,
    legacy,
    paths: {
      currentRace: repoPath(currentPath),
      all: repoPath(allPath),
      odds: repoPath(oddsPath),
    },
    files: {
      currentRace: existsSync(currentPath),
      all: existsSync(allPath),
      odds: existsSync(oddsPath),
      html: legacy
        ? {
            trainingSlope: existsSync(join(HTML_INPUT, "training-slope.html")),
            trainingWood: existsSync(join(HTML_INPUT, "training-wood.html")),
            pedigreeFiles: existsSync(join(HTML_INPUT, "pedigree"))
              ? readdirSync(join(HTML_INPUT, "pedigree")).filter((name) => /\.html?$/i.test(name)).length
              : 0,
          }
        : htmlStatus(bundleId),
    },
    race: null,
    entryCount: 0,
    oddsCount: 0,
    errors: [],
  };

  if (!result.files.currentRace) {
    result.errors.push(`current-race-detail.csv is missing: ${result.paths.currentRace}`);
    return result;
  }
  if (!result.files.all) result.errors.push(`all.csv is missing: ${result.paths.all}`);

  try {
    const parsed = currentRaceParser.parse({ path: result.paths.currentRace });
    result.race = parsed.race;
    result.entryCount = parsed.entryCount;
  } catch (error) {
    result.errors.push(error.message);
    return result;
  }

  if (result.files.odds) {
    try {
      const parsedOdds = oddsParser.parse({
        path: result.paths.odds,
        expectedFieldSize: result.entryCount,
      });
      result.oddsCount = parsedOdds.entryCount;
    } catch (error) {
      result.errors.push(error.message);
    }
  }

  result.previewReady = result.files.currentRace && result.files.all && result.errors.length === 0;
  result.productionReady = result.previewReady && result.files.odds && result.oddsCount === result.entryCount;
  return result;
};

const bundleDirs = existsSync(RACES_INPUT)
  ? readdirSync(RACES_INPUT, { withFileTypes: true }).filter((entry) => entry.isDirectory())
  : [];
const existingBundleIds = bundleDirs.map((entry) => entry.name);
const unexpectedBundles = existingBundleIds.filter((bundleId) => !CONFIG.bundles.includes(bundleId));
const bundles = CONFIG.bundles.map((bundleId) => inspectBundle(bundleId, join(RACES_INPUT, bundleId)));
const missingBundles = CONFIG.bundles.filter((bundleId) => !bundleDirs.some((entry) => entry.name === bundleId));

const summary = {
  bundleCount: bundles.length,
  expectedRaceCount: CONFIG.expectedRaceCount,
  missingBundles,
  unexpectedBundles,
  previewReady: bundles.filter((bundle) => bundle.previewReady).length,
  productionReady: bundles.filter((bundle) => bundle.productionReady).length,
  errorCount: bundles.reduce((sum, bundle) => sum + bundle.errors.length, 0) + missingBundles.length,
};

console.log(JSON.stringify({ summary, bundles }, null, 2));
if (!bundles.length || summary.errorCount) process.exitCode = 1;
