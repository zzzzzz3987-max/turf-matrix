#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TOOLS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(TOOLS_DIR, "..");
const TARGET_DIR = join(REPO_ROOT, "data", "target");
const ARCHIVE_ROOT = join(REPO_ROOT, "data", "archive", "odds");
const CONFIG_PATH = join(TOOLS_DIR, "race-batch-config.json");

const parseCsvLine = (line) => {
  const cells = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && quoted && line[index + 1] === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(cell);
      cell = "";
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells;
};

const latestOddsPath = () => {
  if (!existsSync(TARGET_DIR)) throw new Error(`data/target was not found: ${TARGET_DIR}`);
  const paths = readdirSync(TARGET_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && (entry.name === "odds.csv" || /^odds\.next-\d{8}-\d{6}\.csv$/.test(entry.name)))
    .map((entry) => join(TARGET_DIR, entry.name));
  if (!paths.length) throw new Error(`No odds CSV was found in ${TARGET_DIR}`);
  return paths.sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)[0];
};

const compactTimestamp = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
};

const readRaceDate = () => {
  const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  const dates = [...new Set((config.bundles ?? []).map((bundle) => String(bundle).slice(0, 10)))];
  if (dates.length !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(dates[0])) {
    throw new Error(`A single race date could not be resolved from ${CONFIG_PATH}`);
  }
  return dates[0];
};

const main = () => {
  const sourcePath = process.argv[2] ? resolve(process.argv[2]) : latestOddsPath();
  if (!existsSync(sourcePath)) throw new Error(`Odds CSV was not found: ${sourcePath}`);

  const sourceBuffer = readFileSync(sourcePath);
  const text = sourceBuffer.toString("utf8").replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/).filter(Boolean);
  const header = parseCsvLine(lines[0] ?? "");
  const required = ["場所", "R", "馬番", "馬名", "単勝オッズ", "人気", "取得時刻", "更新元", "状態"];
  const missing = required.filter((name) => !header.includes(name));
  if (missing.length) throw new Error(`Odds header missing: ${missing.join(", ")}`);
  if (lines.length < 2) throw new Error("Odds CSV has no data rows");

  const column = new Map(header.map((name, index) => [name, index]));
  const optionalNumber = (value) => String(value ?? "").trim() === "" ? null : Number(value);
  const rows = lines.slice(1).map((line, rowIndex) => {
    const cells = parseCsvLine(line);
    const value = (name) => cells[column.get(name)] ?? "";
    const row = {
      track: value("場所"),
      raceNo: Number(value("R")),
      horseNumber: Number(value("馬番")),
      horseName: value("馬名"),
      winOdds: optionalNumber(value("単勝オッズ")),
      popularity: optionalNumber(value("人気")),
      updatedAt: value("取得時刻"),
      source: value("更新元"),
      status: value("状態"),
    };
    if (!row.track || !row.raceNo || !row.horseNumber || !row.horseName || row.popularity <= 0) {
      throw new Error(`Odds row ${rowIndex + 2} is incomplete`);
    }
    if (row.status === "active" && !(row.winOdds > 0)) {
      throw new Error(`Active odds row ${rowIndex + 2} has no win odds`);
    }
    if (row.winOdds == null && row.status !== "missing") {
      throw new Error(`Unavailable odds row ${rowIndex + 2} is not marked missing`);
    }
    return row;
  });

  const keys = rows.map((row) => `${row.track}|${row.raceNo}|${row.horseNumber}|${row.horseName}`);
  if (new Set(keys).size !== keys.length) throw new Error("Odds CSV contains duplicate race/horse rows");

  const updatedTimes = rows.map((row) => new Date(row.updatedAt)).filter((date) => !Number.isNaN(date.getTime()));
  const sourceUpdatedAt = updatedTimes.length
    ? new Date(Math.max(...updatedTimes.map((date) => date.getTime()))).toISOString()
    : statSync(sourcePath).mtime.toISOString();
  const raceDate = readRaceDate();
  const sourceDate = new Date(sourceUpdatedAt);
  const raceDateUtc = new Date(`${raceDate}T00:00:00.000Z`);
  const ageDays = Math.abs(sourceDate.getTime() - raceDateUtc.getTime()) / 86_400_000;
  if (ageDays > 3) {
    throw new Error(`Odds source is stale for ${raceDate}: updatedAt=${sourceUpdatedAt}`);
  }
  const sha256 = createHash("sha256").update(sourceBuffer).digest("hex");
  const timestamp = compactTimestamp(sourceUpdatedAt) ?? compactTimestamp(statSync(sourcePath).mtime);
  const snapshotId = `${timestamp}-${sha256.slice(0, 12)}`;
  const archiveDir = join(ARCHIVE_ROOT, raceDate);
  const csvPath = join(archiveDir, `odds-${snapshotId}.csv`);
  const metadataPath = join(archiveDir, `odds-${snapshotId}.json`);
  mkdirSync(archiveDir, { recursive: true });
  if (existsSync(csvPath)) {
    const existingHash = createHash("sha256").update(readFileSync(csvPath)).digest("hex");
    if (existingHash !== sha256) throw new Error(`Snapshot id collision: ${csvPath}`);
  } else {
    copyFileSync(sourcePath, csvPath);
  }

  const races = [...new Map(rows.map((row) => [
    `${row.track}|${row.raceNo}`,
    { track: row.track, raceNo: row.raceNo },
  ])).values()];
  const metadata = {
    schemaVersion: 1,
    raceDate,
    sourceUpdatedAt,
    sourceFile: basename(sourcePath),
    source: [...new Set(rows.map((row) => row.source).filter(Boolean))],
    statuses: [...new Set(rows.map((row) => row.status).filter(Boolean))],
    sha256,
    bytes: sourceBuffer.length,
    rows: rows.length,
    unavailableRows: rows.filter((row) => row.winOdds == null).length,
    races,
    snapshot: `data/archive/odds/${raceDate}/${basename(csvPath)}`,
  };
  writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");

  console.log(JSON.stringify({ status: "archived", ...metadata }, null, 2));
};

try {
  main();
} catch (error) {
  console.error(`[archive:odds] ${error.message}`);
  process.exit(2);
}
