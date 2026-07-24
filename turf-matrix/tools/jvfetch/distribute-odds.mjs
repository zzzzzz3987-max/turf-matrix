#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CONFIG_PATH = join(REPO_ROOT, "tools", "race-batch-config.json");
const SOURCE_PATH = join(REPO_ROOT, "data", "target", "odds.csv");
const RACES_DIR = join(REPO_ROOT, "tools", "csv", "input", "races");

const TRACK_BY_SLUG = {
  sapporo: "札幌",
  hakodate: "函館",
  fukushima: "福島",
  niigata: "新潟",
  tokyo: "東京",
  nakayama: "中山",
  chukyo: "中京",
  kyoto: "京都",
  hanshin: "阪神",
  kokura: "小倉",
};

const parseCsvLine = (line) => {
  const cells = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && quoted && line[index + 1] === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(value);
      value = "";
    } else {
      value += char;
    }
  }
  cells.push(value);
  return cells;
};

const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
const lines = readFileSync(SOURCE_PATH, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
const header = parseCsvLine(lines.shift() ?? "");
const index = new Map(header.map((name, position) => [name, position]));
const required = ["場所", "R", "馬番", "馬名", "単勝オッズ", "人気"];
const missing = required.filter((name) => !index.has(name));
if (missing.length) throw new Error(`JV-Link odds headers missing: ${missing.join(", ")}`);

const rows = lines.map((line) => {
  const cells = parseCsvLine(line);
  const get = (name) => cells[index.get(name)] ?? "";
  return {
    track: get("場所"),
    raceNo: Number(get("R")),
    horseNumber: Number(get("馬番")),
    horseName: get("馬名"),
    winOdds: Number(get("単勝オッズ")),
    popularity: Number(get("人気")),
  };
});

const reports = [];
for (const bundleId of config.bundles) {
  const match = bundleId.match(/^(\d{4}-\d{2}-\d{2})-([a-z]+)-(\d{1,2})R$/);
  if (!match) throw new Error(`Invalid bundle id: ${bundleId}`);
  const track = TRACK_BY_SLUG[match[2]];
  const raceNo = Number(match[3]);
  const raceRows = rows
    .filter((row) => row.track === track && row.raceNo === raceNo)
    .sort((a, b) => a.horseNumber - b.horseNumber);
  if (!raceRows.length) throw new Error(`${track}${raceNo}R: JV-Link odds are missing`);
  if (new Set(raceRows.map((row) => row.horseNumber)).size !== raceRows.length) {
    throw new Error(`${track}${raceNo}R: duplicate horse number in JV-Link odds`);
  }
  if (raceRows.some((row) => !row.horseName || !Number.isFinite(row.winOdds) || !Number.isFinite(row.popularity))) {
    throw new Error(`${track}${raceNo}R: incomplete JV-Link odds row`);
  }

  const outputDir = join(RACES_DIR, bundleId);
  const outputPath = join(outputDir, "odds.csv");
  mkdirSync(outputDir, { recursive: true });
  const output = [
    "人気,枠,馬番,馬名,騎手,ZI,単勝",
    ...raceRows.map((row) => [
      row.popularity,
      "",
      row.horseNumber,
      row.horseName,
      "",
      "",
      row.winOdds,
    ].join(",")),
  ].join("\n");
  writeFileSync(outputPath, `${output}\n`, "utf8");
  reports.push({ bundleId, track, raceNo, rows: raceRows.length, output: outputPath });
}

const selectedRows = reports.reduce((sum, report) => sum + report.rows, 0);
if (selectedRows !== rows.length) {
  throw new Error(`JV-Link odds coverage mismatch: selected=${selectedRows}, source=${rows.length}`);
}

console.log(JSON.stringify({ status: "ready", source: SOURCE_PATH, totalRows: rows.length, races: reports }, null, 2));
