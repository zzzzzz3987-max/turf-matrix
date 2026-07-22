#!/usr/bin/env node
import fs from "node:fs";
import { normalizeRaceBundle } from "./normalizers/race-bundle.mjs";

const config = JSON.parse(fs.readFileSync(process.env.TURF_MATRIX_RACE_CONFIG || "tools/race-batch-config.json", "utf8"));
const results = [];
const errors = [];

for (const bundleId of config.bundles) {
  try {
    const bundle = normalizeRaceBundle({
      bundleId,
      csv: {
        currentRace: `data/target/races/${bundleId}/current-race-detail.csv`,
        all: `data/target/races/${bundleId}/all.csv`,
        basic: `tools/csv/input/races/${bundleId}/basic.txt`,
        odds: `tools/csv/input/races/${bundleId}/odds.csv`,
        pedigree: "data/target/pedigree.csv",
      },
      html: {
        trainingSlope: "data/target/training-slope.csv",
        trainingWood: "data/target/training-wood.csv",
        pedigree: `data/target/no-manual-pedigree/${bundleId}`,
      },
    });
    const preoddsBundle = normalizeRaceBundle({
      bundleId,
      csv: {
        currentRace: `data/target/races/${bundleId}/current-race-detail.csv`,
        all: `data/target/races/${bundleId}/all.csv`,
        basic: `data/target/races/${bundleId}/basic.not-provided.txt`,
        odds: `data/target/races/${bundleId}/odds.not-provided.csv`,
        pedigree: "data/target/pedigree.csv",
      },
      html: {
        trainingSlope: "data/target/training-slope.csv",
        trainingWood: "data/target/training-wood.csv",
        pedigree: `data/target/no-manual-pedigree/${bundleId}`,
      },
    });

    const missingPastRuns = bundle.horses.filter((horse) => !horse.pastRuns.length).map((horse) => horse.horseName);
    const missingPedigree = bundle.horses.filter((horse) => !horse.pedigree).map((horse) => horse.horseName);
    if (missingPastRuns.length) errors.push(`${bundleId}: past runs missing for ${missingPastRuns.join(", ")}`);
    if (missingPedigree.length) errors.push(`${bundleId}: pedigree missing for ${missingPedigree.join(", ")}`);
    if (preoddsBundle.join.oddsSuccess !== 0) errors.push(`${bundleId}: preodds path unexpectedly joined odds.`);
    if (preoddsBundle.horses.some((horse) => Number.isFinite(horse.availableIndex))) {
      errors.push(`${bundleId}: preodds path unexpectedly reused a TARGET ZI value.`);
    }

    results.push({
      bundleId,
      runners: bundle.horses.length,
      pastRunRows: bundle.horses.reduce((total, horse) => total + horse.pastRuns.length, 0),
      pedigreeJoined: bundle.horses.length - missingPedigree.length,
      trainingJoined: bundle.horses.filter((horse) => !horse.missing.includes("training")).length,
      ziAvailable: bundle.horses.filter((horse) => Number.isFinite(horse.availableIndex)).length,
      oddsJoined: bundle.join.oddsSuccess,
      preoddsSafe: preoddsBundle.join.oddsSuccess === 0 && preoddsBundle.horses.every((horse) => !Number.isFinite(horse.availableIndex)),
    });
  } catch (error) {
    errors.push(`${bundleId}: ${error.message}`);
  }
}

if (results.length !== config.expectedRaceCount) {
  errors.push(`Normalized race coverage ${results.length}/${config.expectedRaceCount}.`);
}

console.log(JSON.stringify({
  status: errors.length ? "failed" : "ready",
  raceCount: results.length,
  runnerCount: results.reduce((total, race) => total + race.runners, 0),
  pastRunRows: results.reduce((total, race) => total + race.pastRunRows, 0),
  races: results,
  errors,
}, null, 2));

if (errors.length) process.exitCode = 2;
