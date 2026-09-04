#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateIntelligenceOutput } from "./intelligence/output-contract.mjs";
import { buildPublicUpdateDiff } from "../src/lib/public-update-diff.js";

const TOOLS_DIR = dirname(fileURLToPath(import.meta.url));
const CANDIDATE_PATH = join(TOOLS_DIR, "week-data.batch-candidate.json");
const NEXT_PATH = join(TOOLS_DIR, "week-data.next.json");
const CURRENT_PATH = join(TOOLS_DIR, "week-data.json");
const CONFIG_PATH = join(TOOLS_DIR, "race-batch-config.json");
const candidate = JSON.parse(readFileSync(CANDIDATE_PATH, "utf8"));
const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
const errors = [];

if (candidate.races?.length !== config.expectedRaceCount) {
  errors.push(`Race count must be ${config.expectedRaceCount} but got ${candidate.races?.length ?? 0}.`);
}
if (candidate.meta?.date !== config.raceDate) errors.push(`Race date must be ${config.raceDate}.`);
for (const race of candidate.races ?? []) {
  if (!["active", "partial"].includes(race.oddsStatus)) errors.push(`${race.id}: odds status is ${race.oddsStatus}`);
  if (race.horses.length !== race.fieldSize) errors.push(`${race.id}: runner count mismatch`);
  for (const horse of race.horses) {
    if (!Number.isFinite(horse.popularity)) {
      errors.push(`${race.id}/${horse.name}: popularity is missing`);
    }
    const missingWinOdds = !Number.isFinite(horse.odds);
    if (missingWinOdds && horse.oddsDetail?.status !== "missing") {
      errors.push(`${race.id}/${horse.name}: missing odds are not marked unavailable`);
    }
    if (!missingWinOdds && !Number.isFinite(horse.tmValue)) {
      errors.push(`${race.id}/${horse.name}: TM VALUE is missing`);
    }
    if (!Number.isFinite(horse.tmIndex)) {
      errors.push(`${race.id}/${horse.name}: TM INDEX is missing`);
    }
  }
}

errors.push(...validateIntelligenceOutput(candidate).errors);
if (errors.length) {
  errors.forEach((error) => console.error(`[ERROR] ${error}`));
  console.error("Release preparation stopped. week-data.json was not changed.");
  process.exit(1);
}

const releaseBase = {
  ...candidate,
  mode: "production",
  productionWeekDataUpdated: true,
  meta: { ...candidate.meta, previewMode: false, version: "beta" },
};
const previous = existsSync(CURRENT_PATH)
  ? JSON.parse(readFileSync(CURRENT_PATH, "utf8").replace(/^\uFEFF/, ""))
  : releaseBase;
const release = {
  ...releaseBase,
  publicUpdate: buildPublicUpdateDiff(previous, releaseBase),
};
writeFileSync(NEXT_PATH, JSON.stringify(release, null, 2) + "\n");
console.log(JSON.stringify({
  out: NEXT_PATH,
  races: release.races.length,
  featuredRaceId: release.meta.featuredRaceId,
  changedRaces: release.publicUpdate.races.length,
  publicUpdateEvents: release.publicUpdate.races.reduce((sum, race) => sum + race.events.length, 0),
}, null, 2));
