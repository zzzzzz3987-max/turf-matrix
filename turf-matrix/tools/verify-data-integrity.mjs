#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateOddsJoinIntegrity, validateValueDisplayIntegrity } from "./intelligence/output-contract.mjs";

const toolsDir = dirname(fileURLToPath(import.meta.url));
const weekDataPath = join(toolsDir, "week-data.json");
const weekData = JSON.parse(readFileSync(weekDataPath, "utf8"));
const errors = [
  ...validateOddsJoinIntegrity(weekData),
  ...validateValueDisplayIntegrity(weekData),
];
const horseCount = (weekData.races ?? []).reduce((sum, race) => sum + (race.horses?.length ?? 0), 0);

if (errors.length) {
  errors.forEach((error) => console.error(`[ERROR] ${error}`));
  console.error(`Data integrity verification failed: ${errors.length} error(s).`);
  process.exit(1);
}

console.log(`Data integrity verified: ${weekData.races?.length ?? 0} races / ${horseCount} horses / odds JOIN mismatches 0 / Value display mismatches 0.`);
