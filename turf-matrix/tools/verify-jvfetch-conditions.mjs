#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TOOLS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_DIR = join(TOOLS_DIR, "..");
const CONFIG_PATH = join(TOOLS_DIR, "race-batch-config.json");
const RAW_PATH = join(REPO_DIR, "data", "target", "race-conditions.latest.json");
const CURRENT_PATH = join(TOOLS_DIR, "race-conditions.current.json");
const COURSE_CODES = {
  sapporo: "01", hakodate: "02", fukushima: "03", niigata: "04", tokyo: "05",
  nakayama: "06", chukyo: "07", kyoto: "08", hanshin: "09", kokura: "10",
};

const readJson = (path) => JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
const fail = (message) => {
  console.error(`[conditions] FAIL: ${message}`);
  process.exitCode = 1;
};

if (!existsSync(RAW_PATH)) fail(`raw JV-Link conditions missing: ${RAW_PATH}`);
if (!existsSync(CURRENT_PATH)) fail(`normalized conditions missing: ${CURRENT_PATH}`);

if (!process.exitCode) {
  const config = readJson(CONFIG_PATH);
  const raw = readJson(RAW_PATH);
  const current = readJson(CURRENT_PATH);
  const rawDate = raw.RaceDate ?? raw.raceDate;
  const courses = raw.Courses ?? raw.courses ?? {};
  const expectedCourses = new Set(
    (config.bundles ?? []).map((id) => COURSE_CODES[id.split("-")[3]]),
  );

  if (rawDate !== config.raceDate) fail(`race date mismatch: ${rawDate} != ${config.raceDate}`);
  for (const code of expectedCourses) {
    const state = courses[code];
    if (!state) {
      fail(`WE record missing for course ${code}`);
      continue;
    }
    const weather = String(state.WeatherCode ?? state.weatherCode ?? "");
    const turf = String(state.TurfGoingCode ?? state.turfGoingCode ?? "");
    const dirt = String(state.DirtGoingCode ?? state.dirtGoingCode ?? "");
    if (!/^[1-6]$/.test(weather)) fail(`invalid weather code for course ${code}: ${weather}`);
    if (!/^[1-4]$/.test(turf)) fail(`invalid turf going code for course ${code}: ${turf}`);
    if (!/^[1-4]$/.test(dirt)) fail(`invalid dirt going code for course ${code}: ${dirt}`);
  }

  const selected = config.bundles ?? [];
  for (const bundleId of selected) {
    const condition = current.conditions?.[bundleId];
    if (!condition) fail(`normalized condition missing: ${bundleId}`);
    else if (condition.status !== "active") fail(`condition is not active: ${bundleId}`);
    else if (condition.source !== "JV-Link 0B14 WE") fail(`unexpected source for ${bundleId}: ${condition.source}`);
  }

  if (!process.exitCode) {
    console.log(`JV-Link conditions verified: ${expectedCourses.size} courses / ${selected.length} races / missing 0.`);
  }
}
