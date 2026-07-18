#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TOOLS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(TOOLS_DIR, "..");
const WEEK_DATA_PATH = join(TOOLS_DIR, "week-data.json");
const ARCHIVE_DIR = join(REPO_ROOT, "data", "archive");

const csvCell = (value) => {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

const readWeekData = () => JSON.parse(readFileSync(WEEK_DATA_PATH, "utf8"));
const archiveName = (date, suffix) => join(ARCHIVE_DIR, `${date}-${suffix}`);

const buildResultTemplate = (weekData) => {
  const rows = [["場所", "R", "馬番", "馬名", "TM_INDEX", "人気", "単勝オッズ", "馬場", "天候", "着順", "払戻"]];
  for (const race of weekData.races ?? []) {
    for (const horse of race.horses ?? []) {
      rows.push([
        race.track ?? race.course ?? "",
        race.number ?? race.raceNo ?? "",
        horse.number ?? horse.horseNumber ?? "",
        horse.name ?? horse.horseName ?? "",
        horse.tmIndex ?? horse.aiScore ?? "",
        horse.popularity ?? "",
        horse.odds ?? horse.oddsDetail?.winOdds ?? "",
        race.going ?? "",
        race.weather ?? "",
        "",
        "",
      ]);
    }
  }
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
};

const main = () => {
  if (!existsSync(WEEK_DATA_PATH)) {
    throw new Error(`week-data.json was not found: ${WEEK_DATA_PATH}`);
  }
  mkdirSync(ARCHIVE_DIR, { recursive: true });

  const weekDataRaw = readFileSync(WEEK_DATA_PATH, "utf8");
  const weekData = JSON.parse(weekDataRaw);
  const date = weekData.meta?.date ?? weekData.races?.[0]?.id?.slice(0, 10);
  if (!date) throw new Error("Archive date could not be resolved from week-data.json");

  const snapshotPath = archiveName(date, "preodds.json");
  const templatePath = archiveName(date, "result-template.csv");
  writeFileSync(snapshotPath, weekDataRaw.endsWith("\n") ? weekDataRaw : `${weekDataRaw}\n`);
  writeFileSync(templatePath, buildResultTemplate(weekData));

  console.log(JSON.stringify({
    archiveDir: "data/archive",
    snapshot: `data/archive/${date}-preodds.json`,
    resultTemplate: `data/archive/${date}-result-template.csv`,
    races: weekData.races?.length ?? 0,
    horses: (weekData.races ?? []).reduce((sum, race) => sum + (race.horses?.length ?? 0), 0),
  }, null, 2));
};

try {
  main();
} catch (error) {
  console.error(`[archive] ${error.message}`);
  process.exit(1);
}
