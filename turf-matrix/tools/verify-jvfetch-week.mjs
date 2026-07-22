#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { parse as parsePedigree } from "./parsers/jvlink-pedigree-csv-parser.mjs";
import { parse as parseCurrentRace } from "./parsers/current-race-detail-parser.mjs";
import { parse as parseAllCsv } from "./parsers/all-csv-parser.mjs";
import { parse as parseSlope } from "./parsers/training-slope-html-parser.mjs";
import { parse as parseWood } from "./parsers/training-wood-html-parser.mjs";

const repoRoot = process.cwd();
const readJson = (file) => JSON.parse(fs.readFileSync(path.isAbsolute(file) ? file : path.join(repoRoot, file), "utf8").replace(/^\uFEFF/, ""));
const manifest = readJson("tools/jvlink/output/target-horses.json");
const summary = readJson("tools/jvlink/output/intelligence-summary.json");
const raceConfig = readJson(process.env.TURF_MATRIX_RACE_CONFIG || "tools/race-batch-config.json");
const errors = [];
const normalize = (value) => String(value ?? "").normalize("NFKC").replace(/[＊*$]/g, "").replace(/\s+/g, "").trim();

const expectedByRegistration = new Map(manifest.horses.map((horse) => [horse.bloodRegistrationNumber, horse]));
const expectedNames = new Set(manifest.horses.map((horse) => normalize(horse.horseName)));
const pedigree = parsePedigree({ path: "data/target/pedigree.csv" });
const slope = parseSlope({ path: "data/target/training-slope.csv" });
const wood = parseWood({ path: "data/target/training-wood.csv" });
const directRaces = [];
const directPastRuns = [];

for (const bundleId of raceConfig.bundles) {
  const file = `data/target/races/${bundleId}/current-race-detail.csv`;
  try {
    const parsed = parseCurrentRace({ path: file });
    directRaces.push({ bundleId, ...parsed });
    const all = parseAllCsv({ path: `data/target/races/${bundleId}/all.csv` });
    directPastRuns.push({ bundleId, ...all });
  } catch (error) {
    errors.push(`${bundleId}: ${error.message}`);
  }
}

if (directRaces.length !== raceConfig.expectedRaceCount) {
  errors.push(`Current-race coverage ${directRaces.length}/${raceConfig.expectedRaceCount}.`);
}
if (directPastRuns.length !== raceConfig.expectedRaceCount) {
  errors.push(`Past-run bundle coverage ${directPastRuns.length}/${raceConfig.expectedRaceCount}.`);
}

const directEntries = directRaces.flatMap((race) => race.entries);
if (directEntries.length !== manifest.horses.length) {
  errors.push(`Current-race runner coverage ${directEntries.length}/${manifest.horses.length}.`);
}
for (const entry of directEntries) {
  if (!expectedNames.has(normalize(entry.horseName))) {
    errors.push(`current-race: unexpected horse ${entry.horseName}.`);
  }
}
for (const bundle of directPastRuns) {
  const current = directRaces.find((race) => race.bundleId === bundle.bundleId);
  const pastNames = new Set(bundle.horses.map((horse) => normalize(horse.horseName)));
  for (const entry of current?.entries ?? []) {
    if (!pastNames.has(normalize(entry.horseName))) {
      errors.push(`${bundle.bundleId}: no past-run record for ${entry.horseName}.`);
    }
  }
}

if (summary.targetHorseCount !== manifest.horses.length) errors.push("Summary target horse count does not match manifest.");
if (pedigree.records.length !== manifest.horses.length) errors.push(`Pedigree coverage ${pedigree.records.length}/${manifest.horses.length}.`);

for (const record of pedigree.records) {
  const expected = expectedByRegistration.get(record.bloodRegistrationNumber);
  if (!expected) errors.push(`${record.horseName}: pedigree registration number is not in the target manifest.`);
  if (expected && normalize(expected.horseName) !== normalize(record.horseName)) {
    errors.push(`${record.horseName}: pedigree horse name does not match ${expected.horseName}.`);
  }
  for (const field of ["sire", "dam", "broodmareSire", "damDam"]) {
    if (!record[field]) errors.push(`${record.horseName}: pedigree ${field} is missing.`);
  }
}

const startDate = new Date(`${manifest.raceDate}T00:00:00`);
startDate.setDate(startDate.getDate() - 45);
const minDate = startDate.toISOString().slice(0, 10).replaceAll("-", "");
const maxDate = manifest.raceDate.replaceAll("-", "");
for (const [label, records] of [["slope", slope.records], ["wood", wood.records]]) {
  for (const record of records) {
    if (!expectedNames.has(normalize(record.horseName))) errors.push(`${label}: unexpected horse ${record.horseName}.`);
    const date = String(record.date ?? "").replaceAll(/[^0-9]/g, "").slice(0, 8);
    if (!date || date < minDate || date > maxDate) errors.push(`${label}/${record.horseName}: training date ${record.date} is outside ${minDate}-${maxDate}.`);
  }
}

const trainingNames = new Set([...slope.records, ...wood.records].map((record) => normalize(record.horseName)));
const result = {
  status: errors.length ? "failed" : "ready",
  raceDate: manifest.raceDate,
  targetHorses: manifest.horses.length,
  currentRaces: directRaces.length,
  currentRaceRunners: directEntries.length,
  pastRunRows: directPastRuns.reduce((total, bundle) => total + bundle.rowCount, 0),
  pastRunHorses: directPastRuns.reduce((total, bundle) => total + bundle.horseCount, 0),
  pedigree: pedigree.records.length,
  slopeRows: slope.records.length,
  woodRows: wood.records.length,
  trainingHorseCoverage: trainingNames.size,
  trainingMissing: manifest.horses.map((horse) => horse.horseName).filter((name) => !trainingNames.has(normalize(name))),
  errors,
};

console.log(JSON.stringify(result, null, 2));
if (errors.length) process.exitCode = 2;
