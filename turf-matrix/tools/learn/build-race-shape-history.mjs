#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyRaceShape, raceShapeKey } from "../intelligence/race-shape-history.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ARCHIVE_DIR = join(ROOT, "data", "archive");
const OUTPUT = join(ROOT, "data", "master", "race-shape-history.json");
const INTELLIGENCE_SUMMARY = join(ROOT, "tools", "jvlink", "output", "intelligence-summary.json");
const RAW_SHAPE_DIR = join(ROOT, "tools", "jvlink", "output", "race-shape-history");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
const number = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) ? Number(value) : null;

const normalizeHorse = (horse) => ({
  horseNumber: number(horse.HorseNumber ?? horse.horseNumber ?? horse.number),
  horseName: horse.HorseName ?? horse.horseName ?? horse.name ?? null,
  finishPosition: number(horse.FinishPosition ?? horse.finishPosition ?? horse.finish),
  corner1: number(horse.Corner1 ?? horse.corner1),
  corner2: number(horse.Corner2 ?? horse.corner2),
  corner3: number(horse.Corner3 ?? horse.corner3),
  corner4: number(horse.Corner4 ?? horse.corner4),
  abnormalityCode: horse.AbnormalityCode ?? horse.abnormalityCode ?? null,
});

const normalizeRaces = (data, sourceFile) => {
  if (Array.isArray(data.Races)) {
    return data.Races.map((entry) => ({
      date: entry.Race?.RaceDate ?? data.RaceDate,
      course: entry.Race?.CourseSlug ?? entry.Race?.CourseName,
      courseName: entry.Race?.CourseName ?? null,
      raceNumber: number(entry.Race?.RaceNo),
      sourceFile,
      horses: (entry.Horses ?? []).map(normalizeHorse),
    }));
  }
  return (data.races ?? []).map((race) => ({
    date: data.date ?? String(race.bundleId ?? "").slice(0, 10),
    course: race.track ?? race.course ?? String(race.bundleId ?? "").split("-")[3],
    courseName: race.track ?? race.course ?? null,
    raceNumber: number(race.raceNo ?? race.number ?? String(race.bundleId ?? "").match(/-(\d{1,2})R$/)?.[1]),
    sourceFile,
    horses: (race.horses ?? []).map(normalizeHorse),
  }));
};

const completeness = (race) => (race.horses ?? []).filter((horse) => [horse.corner1, horse.corner2, horse.corner3, horse.corner4].some((value) => number(value) != null)).length;
const candidates = new Map();
const sourceFiles = readdirSync(ARCHIVE_DIR).filter((name) => /-results\.json$/.test(name)).sort();
for (const sourceFile of sourceFiles) {
  const data = readJson(join(ARCHIVE_DIR, sourceFile));
  for (const race of normalizeRaces(data, sourceFile)) {
    const key = raceShapeKey(race.date, race.course, race.raceNumber);
    if (!key) continue;
    const previous = candidates.get(key);
    if (!previous || completeness(race) > completeness(previous)) candidates.set(key, race);
  }
}

const COURSE_SLUG_BY_CODE = {
  "01": "sapporo", "02": "hakodate", "03": "fukushima", "04": "niigata", "05": "tokyo",
  "06": "nakayama", "07": "chukyo", "08": "kyoto", "09": "hanshin", "10": "kokura",
};
if (existsSync(INTELLIGENCE_SUMMARY)) {
  const intelligence = readJson(INTELLIGENCE_SUMMARY);
  const raceMeta = new Map((intelligence.pastRaces ?? []).map((race) => [race.raceKey, race]));
  const grouped = new Map();
  for (const run of intelligence.recentUniverseRuns ?? []) {
    const meta = raceMeta.get(run.raceKey);
    if (!meta) continue;
    if (!grouped.has(run.raceKey)) {
      grouped.set(run.raceKey, {
        date: String(meta.raceDate ?? run.raceDate).replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3"),
        course: COURSE_SLUG_BY_CODE[String(meta.courseCode).padStart(2, "0")],
        courseName: null,
        raceNumber: number(meta.raceNo),
        fieldSize: number(meta.fieldSize),
        sourceFile: "tools/jvlink/output/intelligence-summary.json",
        horses: [],
      });
    }
    const passing = Array.isArray(run.passingOrder) ? run.passingOrder : [];
    grouped.get(run.raceKey).horses.push(normalizeHorse({
      ...run,
      corner1: passing[0],
      corner2: passing[1],
      corner3: passing[2],
      corner4: passing[3],
    }));
  }
  for (const race of grouped.values()) {
    const key = raceShapeKey(race.date, race.course, race.raceNumber);
    if (!key) continue;
    const previous = candidates.get(key);
    if (!previous || completeness(race) > completeness(previous)) candidates.set(key, race);
  }
}

const rawShapeFiles = existsSync(RAW_SHAPE_DIR)
  ? readdirSync(RAW_SHAPE_DIR).filter((name) => name.endsWith(".json")).sort()
  : [];
for (const rawShapeFile of rawShapeFiles) {
  const raw = readJson(join(RAW_SHAPE_DIR, rawShapeFile));
  const metaByKey = new Map((raw.races ?? []).map((race) => [race.raceKey, race]));
  const grouped = new Map();
  for (const horse of raw.horses ?? []) {
    const meta = metaByKey.get(horse.raceKey);
    if (!meta) continue;
    if (!grouped.has(horse.raceKey)) {
      grouped.set(horse.raceKey, {
        date: String(meta.raceDate).replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3"),
        course: COURSE_SLUG_BY_CODE[String(meta.courseCode).padStart(2, "0")],
        courseName: null,
        raceNumber: number(meta.raceNo),
        fieldSize: number(meta.fieldSize),
        sourceFile: `tools/jvlink/output/race-shape-history/${rawShapeFile}`,
        horses: [],
      });
    }
    const passing = Array.isArray(horse.passingOrder) ? horse.passingOrder : [];
    grouped.get(horse.raceKey).horses.push(normalizeHorse({
      ...horse,
      corner1: passing[0], corner2: passing[1], corner3: passing[2], corner4: passing[3],
    }));
  }
  for (const race of grouped.values()) {
    const key = raceShapeKey(race.date, race.course, race.raceNumber);
    if (!key) continue;
    const previous = candidates.get(key);
    if (!previous || completeness(race) > completeness(previous)) candidates.set(key, race);
  }
}

const races = [];
let skippedWithoutCorners = 0;
for (const [key, race] of [...candidates.entries()].sort(([left], [right]) => left.localeCompare(right))) {
  const shape = classifyRaceShape(race);
  if (!shape) {
    skippedWithoutCorners += 1;
    continue;
  }
  races.push({
    key,
    date: race.date,
    course: String(key).split("-")[3],
    courseName: race.courseName,
    raceNumber: race.raceNumber,
    sourceFile: race.sourceFile,
    ...shape,
  });
}

const counts = Object.fromEntries(["front_collapse", "front_survival", "neutral"].map((shape) => [shape, races.filter((race) => race.shape === shape).length]));
const artifact = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  source: "JV-Link finalized SE corner positions and finish order",
  interpretation: "race outcome shape proxy; not an observed pace or lap classification",
  policy: {
    popularityOddsValueUsed: false,
    actualRaceLapsAvailable: false,
    minimumCornerCoverage: 0.6,
    futureRaceJoinAllowed: false,
  },
  summary: {
    sourceFileCount: sourceFiles.length,
    intelligenceSummaryUsed: existsSync(INTELLIGENCE_SUMMARY),
    rawShapeFileCount: rawShapeFiles.length,
    candidateRaceCount: candidates.size,
    raceCount: races.length,
    skippedWithoutCorners,
    counts,
  },
  races,
};
mkdirSync(dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ output: OUTPUT, ...artifact.summary }, null, 2));
