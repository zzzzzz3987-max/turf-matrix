#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TOOLS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(TOOLS_DIR, "..");
const TARGET_DIR = join(REPO_ROOT, "data", "target");
const CONFIG_PATH = join(TOOLS_DIR, "race-batch-config.json");
const WEEK_DATA_PATH = join(TOOLS_DIR, "week-data.json");

const COURSE_BY_SLUG = {
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
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"' && quoted && line[i + 1] === '"') {
      cell += '"';
      i += 1;
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
  const candidates = readdirSync(TARGET_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^odds\.next-\d{8}-\d{6}\.csv$/.test(entry.name))
    .map((entry) => join(TARGET_DIR, entry.name))
    .sort((a, b) => b.localeCompare(a));
  return candidates[0] ?? join(TARGET_DIR, "odds.csv");
};

const loadOdds = (path) => {
  if (!existsSync(path)) throw new Error(`Odds CSV was not found: ${path}`);
  const lines = readFileSync(path, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  const header = parseCsvLine(lines[0] ?? "");
  const required = ["場所", "R", "馬番", "馬名", "単勝オッズ", "人気", "取得時刻", "更新元", "状態"];
  const missing = required.filter((name) => !header.includes(name));
  if (missing.length) throw new Error(`Odds header missing: ${missing.join(", ")}`);
  const index = new Map(header.map((name, i) => [name, i]));
  const rows = lines.slice(1).map((line, rowIndex) => {
    const cells = parseCsvLine(line);
    const value = (name) => cells[index.get(name)] ?? "";
    return {
      row: rowIndex + 2,
      track: value("場所"),
      raceNo: Number(value("R")),
      horseNumber: Number(value("馬番")),
      horseName: value("馬名"),
      winOdds: Number(value("単勝オッズ")),
      popularity: Number(value("人気")),
      updatedAt: value("取得時刻"),
      source: value("更新元"),
      status: value("状態"),
    };
  });
  return { path, rows };
};

const expectedRaces = () => {
  const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  return config.bundles.map((bundleId) => {
    const match = bundleId.match(/^(\d{4}-\d{2}-\d{2})-([a-z]+)-(\d{1,2})R$/);
    if (!match) throw new Error(`Invalid bundle id: ${bundleId}`);
    return {
      bundleId,
      date: match[1],
      track: COURSE_BY_SLUG[match[2]],
      raceNo: Number(match[3]),
    };
  });
};

const fieldSizes = () => {
  if (!existsSync(WEEK_DATA_PATH)) return new Map();
  const week = JSON.parse(readFileSync(WEEK_DATA_PATH, "utf8"));
  return new Map(
    (week.races ?? []).map((race) => [`${race.track}|${race.number}`, race.horses?.length ?? race.fieldSize ?? 0]),
  );
};

const main = () => {
  const { path, rows } = loadOdds(process.argv[2] ? resolve(process.argv[2]) : latestOddsPath());
  const expected = expectedRaces();
  const sizes = fieldSizes();
  const failures = [];
  const warnings = [];

  const grouped = new Map();
  for (const row of rows) {
    const key = `${row.track}|${row.raceNo}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
    if (!row.horseNumber || !row.horseName || !row.winOdds || !row.popularity) {
      failures.push(`row ${row.row}: required odds field is missing`);
    }
    if (row.winOdds <= 0) failures.push(`row ${row.row}: winOdds must be positive`);
    if (!["active", "closed", "missing"].includes(row.status)) warnings.push(`row ${row.row}: unknown status ${row.status}`);
  }

  const raceReports = expected.map((race) => {
    const key = `${race.track}|${race.raceNo}`;
    const raceRows = grouped.get(key) ?? [];
    const duplicateHorseNumbers = duplicates(raceRows.map((row) => row.horseNumber));
    const duplicatePopularities = duplicates(raceRows.map((row) => row.popularity));
    const expectedSize = sizes.get(key);
    if (!raceRows.length) failures.push(`${race.track}${race.raceNo}R: odds rows are missing`);
    if (expectedSize && raceRows.length !== expectedSize) {
      failures.push(`${race.track}${race.raceNo}R: expected ${expectedSize} rows but got ${raceRows.length}`);
    }
    if (duplicateHorseNumbers.length) failures.push(`${race.track}${race.raceNo}R: duplicate horse numbers ${duplicateHorseNumbers.join(", ")}`);
    if (duplicatePopularities.length) failures.push(`${race.track}${race.raceNo}R: duplicate popularities ${duplicatePopularities.join(", ")}`);
    return {
      race: `${race.track}${race.raceNo}R`,
      rows: raceRows.length,
      expectedRows: expectedSize ?? null,
      impliedWinOddsSum: Number(raceRows.reduce((sum, row) => sum + 1 / row.winOdds, 0).toFixed(3)),
      status: raceRows.every((row) => row.status === "closed") ? "closed" : "active",
    };
  });

  const unexpected = [...grouped.keys()].filter((key) => !expected.some((race) => key === `${race.track}|${race.raceNo}`));
  if (unexpected.length) warnings.push(`unexpected race rows: ${unexpected.join(", ")}`);

  console.log(JSON.stringify(
    {
      status: failures.length ? "fail" : warnings.length ? "warn" : "pass",
      path,
      totalRows: rows.length,
      races: raceReports,
      warnings,
      failures,
    },
    null,
    2,
  ));

  if (failures.length) process.exit(2);
  if (warnings.length) process.exit(1);
};

const duplicates = (values) => {
  const seen = new Set();
  const dupes = new Set();
  for (const value of values) {
    if (value == null || Number.isNaN(value)) continue;
    if (seen.has(value)) dupes.add(value);
    seen.add(value);
  }
  return [...dupes];
};

main();
