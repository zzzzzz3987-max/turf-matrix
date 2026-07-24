#!/usr/bin/env node
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const JVLINK_DIR = dirname(fileURLToPath(import.meta.url));
const TOOLS_DIR = join(JVLINK_DIR, "..");
const SUMMARY_PATH = join(JVLINK_DIR, "output", "week-race-summary.json");
const CONFIG_PATH = join(TOOLS_DIR, "race-batch-config.json");
const OUT_PATH = join(TOOLS_DIR, "race-conditions.current.json");

const COURSE_SLUGS = {
  "01": "sapporo",
  "02": "hakodate",
  "03": "fukushima",
  "04": "niigata",
  "05": "tokyo",
  "06": "nakayama",
  "07": "chukyo",
  "08": "kyoto",
  "09": "hanshin",
  "10": "kokura",
};

const WEATHER = {
  "1": "晴",
  "2": "曇",
  "3": "雨",
  "4": "小雨",
  "5": "雪",
  "6": "小雪",
};

const GOING = {
  "1": "良",
  "2": "稍重",
  "3": "重",
  "4": "不良",
};

const surfaceFromTrackCode = (code) => {
  const value = String(code ?? "").trim();
  if (/^(1[0-9]|2[0-2])$/.test(value)) return "芝";
  if (/^2[3-9]$/.test(value)) return "ダ";
  if (/^5[1-9]$/.test(value)) return "障";
  return null;
};

const bundleIdFor = (race) => {
  const slug = COURSE_SLUGS[String(race.courseCode ?? "").padStart(2, "0")];
  if (!slug || !race.raceDate || !race.raceNo) return null;
  return `${race.raceDate}-${slug}-${String(race.raceNo).padStart(2, "0")}R`;
};

if (!existsSync(SUMMARY_PATH)) {
  console.error(`[conditions] JV-Link summary was not found: ${SUMMARY_PATH}`);
  process.exit(1);
}

const summary = JSON.parse(readFileSync(SUMMARY_PATH, "utf8").replace(/^\uFEFF/, ""));
const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
const selected = new Set(config.bundles ?? []);
const updatedAt = statSync(SUMMARY_PATH).mtime.toISOString();
const conditions = {};

for (const race of summary.races ?? []) {
  const bundleId = bundleIdFor(race);
  if (!bundleId || !selected.has(bundleId)) continue;
  const surface = surfaceFromTrackCode(race.trackCode);
  const goingCode = surface === "芝"
    ? String(race.turfConditionCode ?? "").trim()
    : surface === "ダ"
      ? String(race.dirtConditionCode ?? "").trim()
      : "";
  const weather = WEATHER[String(race.weatherCode ?? "").trim()] ?? null;
  const going = GOING[goingCode] ?? null;

  conditions[bundleId] = {
    raceKey: race.raceKey,
    weather,
    going,
    surface,
    weatherCode: String(race.weatherCode ?? "").trim() || null,
    goingCode: goingCode || null,
    updatedAt,
    source: "JV-Link RA",
    status: weather && going ? "active" : "missing",
  };
}

const payload = {
  schemaVersion: 1,
  generatedAt: updatedAt,
  source: "JV-Link RA",
  configuredRaceDate: config.raceDate,
  conditions,
};

writeFileSync(OUT_PATH, `${JSON.stringify(payload, null, 2)}\n`);

const active = Object.values(conditions).filter((item) => item.status === "active").length;
console.log(JSON.stringify({
  out: OUT_PATH,
  selectedRaces: selected.size,
  detectedRaces: Object.keys(conditions).length,
  active,
  missing: selected.size - active,
}, null, 2));
