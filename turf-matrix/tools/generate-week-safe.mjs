#!/usr/bin/env node
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateWeekData } from "./lib-validate.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(SCRIPT_DIR, "csv-config.json");
const RUNTIME_CONFIG_PATH = join(SCRIPT_DIR, "csv-config.runtime.json");
const NEXT_PATH = join(SCRIPT_DIR, "week-data.next.json");
const REQUIRED_KINDS = new Set(["shutuba", "odds"]);

if (existsSync(NEXT_PATH)) unlinkSync(NEXT_PATH);
if (existsSync(RUNTIME_CONFIG_PATH)) unlinkSync(RUNTIME_CONFIG_PATH);

const validation = spawnSync(process.execPath, [join(SCRIPT_DIR, "validate-csv-inputs.mjs")], { stdio: "inherit" });
if (validation.status !== 0) {
  console.error("CSV input validation failed. week-data.next.json and week-data.json were not changed.");
  process.exit(validation.status ?? 1);
}

const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
const runtimeConfig = {
  ...config,
  files: (config.files ?? []).filter((file) => {
    if (REQUIRED_KINDS.has(file.kind)) return true;
    return existsSync(join(SCRIPT_DIR, file.path));
  }),
};
writeFileSync(RUNTIME_CONFIG_PATH, JSON.stringify(runtimeConfig, null, 2) + "\n");

const result = spawnSync(
  process.execPath,
  [
    join(SCRIPT_DIR, "csv-to-week.mjs"),
    "--config",
    RUNTIME_CONFIG_PATH,
    "--out",
    NEXT_PATH,
    "--log",
    join(SCRIPT_DIR, "conversion-log.txt"),
  ],
  { stdio: "inherit" }
);

if (existsSync(RUNTIME_CONFIG_PATH)) unlinkSync(RUNTIME_CONFIG_PATH);

if (result.status !== 0) {
  console.error("week-data.next.json generation failed. week-data.json was not changed.");
  process.exit(result.status ?? 1);
}

if (!existsSync(NEXT_PATH)) {
  console.error("week-data.next.json was not created. week-data.json was not changed.");
  process.exit(1);
}

const nextData = JSON.parse(readFileSync(NEXT_PATH, "utf8"));
const { errors, warnings } = validateWeekData(nextData);
warnings.forEach((warning) => console.warn(`[WARN] ${warning}`));

if (errors.length) {
  errors.forEach((error) => console.error(`[ERROR] ${error}`));
  console.error("Generated week-data.next.json is invalid. week-data.json was not changed.");
  process.exit(1);
}

console.log("week-data.next.json generated and validated. week-data.json was not changed.");
