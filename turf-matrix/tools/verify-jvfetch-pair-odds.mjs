#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPairOddsIndex } from "./pair-odds.mjs";

const TOOLS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(TOOLS_DIR, "..");
const CONFIG_PATH = process.env.TURF_MATRIX_RACE_CONFIG
  ? resolve(process.env.TURF_MATRIX_RACE_CONFIG)
  : join(TOOLS_DIR, "race-batch-config.json");
const SOURCE = process.argv[2]
  ? resolve(process.argv[2])
  : join(REPO_ROOT, "data", "target", "pair-odds.latest.json");
const TRACK_BY_SLUG = {
  sapporo: "札幌", hakodate: "函館", fukushima: "福島", niigata: "新潟", tokyo: "東京",
  nakayama: "中山", chukyo: "中京", kyoto: "京都", hanshin: "阪神", kokura: "小倉",
};
const readJson = (path) => JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));

if (!existsSync(SOURCE)) throw new Error(`Pair odds JSON was not found: ${SOURCE}`);
const payload = readJson(SOURCE);
const config = readJson(CONFIG_PATH);
const failures = [];
const warnings = [];
if (payload.RaceDate !== config.raceDate) failures.push(`race date mismatch: ${payload.RaceDate} / ${config.raceDate}`);

const expected = config.bundles.map((bundleId) => {
  const match = bundleId.match(/^\d{4}-\d{2}-\d{2}-([a-z]+)-(\d{1,2})R$/);
  return match ? { track: TRACK_BY_SLUG[match[1]], raceNo: Number(match[2]) } : null;
}).filter(Boolean);
const raceTypes = new Set((payload.Races ?? []).map((entry) => {
  const race = entry.Race ?? {};
  return `${race.CourseName}|${Number(race.RaceNo)}|${entry.Type}`;
}));
for (const race of expected) {
  for (const type of ["quinella", "wide"]) {
    if (!raceTypes.has(`${race.track}|${race.raceNo}|${type}`)) warnings.push(`${race.track}${race.raceNo}R: ${type} odds unavailable`);
  }
}

for (const raceOdds of payload.Races ?? []) {
  const race = raceOdds.Race ?? {};
  const label = `${race.CourseName ?? "?"}${race.RaceNo ?? "?"}R ${raceOdds.Type ?? "?"}`;
  if (!["quinella", "wide"].includes(raceOdds.Type)) failures.push(`${label}: unsupported type`);
  const seen = new Set();
  for (const entry of raceOdds.Entries ?? []) {
    const numbers = entry.HorseNumbers ?? [];
    const pair = numbers.map(Number).sort((left, right) => left - right);
    const key = pair.join("-");
    if (pair.length !== 2 || pair.some((number) => !Number.isInteger(number) || number < 1 || number > 18) || pair[0] === pair[1]) {
      failures.push(`${label}: invalid pair ${key}`);
    }
    if (seen.has(key)) failures.push(`${label}: duplicate pair ${key}`);
    seen.add(key);
    const minimum = Number(entry.MinOdds);
    const maximum = Number(entry.MaxOdds);
    if (!(minimum > 0) || !(maximum >= minimum)) failures.push(`${label} ${key}: invalid odds range`);
  }
}

const combinations = buildPairOddsIndex(payload).size;
if (!combinations) warnings.push("no active pair odds combinations were found");
console.log(JSON.stringify({
  status: failures.length ? "fail" : warnings.length ? "warn" : "pass",
  source: SOURCE,
  raceDate: payload.RaceDate ?? null,
  raceTypes: payload.Races?.length ?? 0,
  combinations,
  warnings,
  failures,
}, null, 2));
if (failures.length) process.exit(2);
if (warnings.length) process.exit(1);
