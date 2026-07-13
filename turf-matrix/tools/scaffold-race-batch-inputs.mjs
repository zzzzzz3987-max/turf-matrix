#!/usr/bin/env node
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TOOLS_DIR = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(TOOLS_DIR, "race-batch-config.json"), "utf8"));

for (const bundleId of config.bundles) {
  mkdirSync(join(TOOLS_DIR, "csv", "input", "races", bundleId), { recursive: true });
  mkdirSync(join(TOOLS_DIR, "target-html", "input", "races", bundleId, "pedigree"), { recursive: true });
}

console.log(JSON.stringify({ raceDate: config.raceDate, created: config.bundles.length, bundles: config.bundles }, null, 2));
