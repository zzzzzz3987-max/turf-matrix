#!/usr/bin/env node
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const JVLINK_DIR = dirname(fileURLToPath(import.meta.url));
const TOOLS_DIR = join(JVLINK_DIR, "..");
const REPO_DIR = join(TOOLS_DIR, "..");
const SUMMARY_PATH = join(JVLINK_DIR, "output", "week-race-summary.json");
const REALTIME_PATH = join(REPO_DIR, "data", "target", "race-conditions.latest.json");
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

const readJson = (path) => JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));

const surfaceFromTrackCode = (code) => {
  const value = String(code ?? "").trim();
  if (/^(1[0-9]|2[0-2])$/.test(value)) return "芝";
  if (/^2[3-9]$/.test(value)) return "ダート";
  if (/^5[1-9]$/.test(value)) return "障害";
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

const summary = readJson(SUMMARY_PATH);
const config = readJson(CONFIG_PATH);
const selected = new Set(config.bundles ?? []);
const realtime = existsSync(REALTIME_PATH) ? readJson(REALTIME_PATH) : null;
const realtimeRaceDate = realtime?.RaceDate ?? realtime?.raceDate ?? null;
const realtimeCourses = realtime?.Courses ?? realtime?.courses ?? {};
const useRealtime = realtimeRaceDate === config.raceDate;
const fallbackUpdatedAt = statSync(SUMMARY_PATH).mtime.toISOString();
const conditions = {};

for (const race of summary.races ?? []) {
  const bundleId = bundleIdFor(race);
  if (!bundleId || !selected.has(bundleId)) continue;

  const courseCode = String(race.courseCode ?? "").padStart(2, "0");
  const surface = surfaceFromTrackCode(race.trackCode);
  const live = useRealtime ? realtimeCourses[courseCode] ?? null : null;
  const weatherCode = String(live?.WeatherCode ?? live?.weatherCode ?? race.weatherCode ?? "").trim();
  const turfGoingCode = String(live?.TurfGoingCode ?? live?.turfGoingCode ?? race.turfConditionCode ?? "").trim();
  const dirtGoingCode = String(live?.DirtGoingCode ?? live?.dirtGoingCode ?? race.dirtConditionCode ?? "").trim();
  const goingCode = surface === "芝" ? turfGoingCode : surface === "ダート" ? dirtGoingCode : "";
  const weather = WEATHER[weatherCode] ?? null;
  const going = GOING[goingCode] ?? null;
  const updatedAt = live?.UpdatedAt ?? live?.updatedAt ?? fallbackUpdatedAt;

  conditions[bundleId] = {
    raceKey: race.raceKey,
    weather,
    going,
    surface,
    weatherCode: weatherCode || null,
    goingCode: goingCode || null,
    updatedAt,
    source: live ? "JV-Link 0B14 WE" : "JV-Link RA",
    status: weather && going ? "active" : "missing",
  };
}

const active = Object.values(conditions).filter((item) => item.status === "active").length;
const payload = {
  schemaVersion: 2,
  generatedAt: realtime?.GeneratedAt ?? realtime?.generatedAt ?? fallbackUpdatedAt,
  source: useRealtime ? "JV-Link 0B14 WE" : "JV-Link RA",
  configuredRaceDate: config.raceDate,
  conditions,
};

writeFileSync(OUT_PATH, `${JSON.stringify(payload, null, 2)}\n`);

console.log(JSON.stringify({
  out: OUT_PATH,
  selectedRaces: selected.size,
  detectedRaces: Object.keys(conditions).length,
  active,
  missing: selected.size - active,
  source: payload.source,
}, null, 2));

if (active === 0) process.exitCode = 1;
