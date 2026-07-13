#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateIntelligenceOutput } from "./intelligence/output-contract.mjs";

const TOOLS_DIR = dirname(fileURLToPath(import.meta.url));
const CANDIDATE_PATH = join(TOOLS_DIR, "week-data.batch-candidate.json");
const NEXT_PATH = join(TOOLS_DIR, "week-data.next.json");
const CONFIG_PATH = join(TOOLS_DIR, "race-batch-config.json");
const candidate = JSON.parse(readFileSync(CANDIDATE_PATH, "utf8"));
const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
const errors = [];

if (candidate.races?.length !== config.expectedRaceCount) {
  errors.push(`Race count must be ${config.expectedRaceCount} but got ${candidate.races?.length ?? 0}.`);
}
if (candidate.meta?.date !== config.raceDate) errors.push(`Race date must be ${config.raceDate}.`);
for (const race of candidate.races ?? []) {
  if (race.oddsStatus !== "active") errors.push(`${race.id}: odds status is ${race.oddsStatus}`);
  if (race.horses.length !== race.fieldSize) errors.push(`${race.id}: runner count mismatch`);
  for (const horse of race.horses) {
    if (!Number.isFinite(horse.odds) || !Number.isFinite(horse.popularity)) {
      errors.push(`${race.id}/${horse.name}: odds or popularity is missing`);
    }
    if (!Number.isFinite(horse.tmIndex) || !Number.isFinite(horse.tmValue)) {
      errors.push(`${race.id}/${horse.name}: TM INDEX or TM VALUE is missing`);
    }
  }
}

errors.push(...validateIntelligenceOutput(candidate).errors);
if (errors.length) {
  errors.forEach((error) => console.error(`[ERROR] ${error}`));
  console.error("Release preparation stopped. week-data.json was not changed.");
  process.exit(1);
}

const release = {
  ...candidate,
  mode: "production",
  productionWeekDataUpdated: true,
  meta: { ...candidate.meta, previewMode: false, version: "beta" },
};
writeFileSync(NEXT_PATH, JSON.stringify(release, null, 2) + "\n");
console.log(JSON.stringify({ out: NEXT_PATH, races: release.races.length, featuredRaceId: release.meta.featuredRaceId }, null, 2));
