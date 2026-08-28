import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { buildTrainingProfile } from "../intelligence/training-ai.mjs";
import { trainingPhaseSnapshot } from "./stable-pattern-learning.mjs";

const args = process.argv.slice(2);
const valueAfter = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const inputDir = resolve(valueAfter("--input-dir", "tools/jvlink/output/stable-history"));
const outputPath = resolve(valueAfter("--output", "tools/jvlink/output/stable-history-observations.json"));
const normalize = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, "").trim();
const isoDate = (value) => String(value ?? "").replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3");
const daysBetween = (earlier, later) => {
  const a = Date.parse(`${isoDate(earlier)}T00:00:00Z`);
  const b = Date.parse(`${isoDate(later)}T00:00:00Z`);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 86400000) : null;
};
const centerLabel = (code) => code === "0" ? "美浦" : code === "1" ? "栗東" : null;

if (!existsSync(inputDir)) {
  console.error(`[ERROR] 履歴エクスポートディレクトリがありません: ${inputDir}`);
  process.exit(2);
}

const files = readdirSync(inputDir).filter((name) => name.endsWith(".json")).map((name) => join(inputDir, name));
const resultsByKey = new Map();
const slopeByKey = new Map();
const woodByKey = new Map();
for (const file of files) {
  const payload = JSON.parse(readFileSync(file, "utf8"));
  for (const result of payload.results ?? []) {
    const key = [result.raceKey ?? result.raceDate, result.bloodRegistrationNumber, normalize(result.horseName)].join("|");
    resultsByKey.set(key, result);
  }
  for (const row of payload.slope ?? []) {
    const key = [row.centerCode, row.date, row.time, row.bloodRegistrationNumber].join("|");
    slopeByKey.set(key, row);
  }
  for (const row of payload.wood ?? []) {
    const key = [row.centerCode, row.date, row.time, row.bloodRegistrationNumber].join("|");
    woodByKey.set(key, row);
  }
}

const slopeByHorse = new Map();
const woodByHorse = new Map();
for (const row of slopeByKey.values()) {
  const values = slopeByHorse.get(row.bloodRegistrationNumber) ?? [];
  values.push(row);
  slopeByHorse.set(row.bloodRegistrationNumber, values);
}
for (const row of woodByKey.values()) {
  const values = woodByHorse.get(row.bloodRegistrationNumber) ?? [];
  values.push(row);
  woodByHorse.set(row.bloodRegistrationNumber, values);
}

const observations = [];
let skippedWithoutTraining = 0;
for (const result of resultsByKey.values()) {
  const registration = result.bloodRegistrationNumber;
  const raceDate = isoDate(result.raceDate);
  const slope = (slopeByHorse.get(registration) ?? []).filter((row) => {
    const days = daysBetween(row.date, raceDate);
    return Number.isFinite(days) && days >= 0 && days <= 45;
  }).map((row) => ({
    date: isoDate(row.date),
    "4F": row.fourF,
    "3F": row.threeF,
    "2F": row.twoF,
    "1F": row.oneF,
    lap: { lap4: row.lap4, lap3: row.lap3, lap2: row.lap2, lap1: row.lap1 },
  }));
  const wood = (woodByHorse.get(registration) ?? []).filter((row) => {
    const days = daysBetween(row.date, raceDate);
    return Number.isFinite(days) && days >= 0 && days <= 45;
  }).map((row) => ({
    date: isoDate(row.date),
    course: row.course ?? row.courseCode,
    direction: row.directionCode,
    times: row.times,
    lap: row.laps,
  }));
  const horse = {
    horseName: result.horseName,
    trainer: result.trainerName,
    stableSide: centerLabel(result.affiliationCode),
    currentRace: {
      raceDate,
      trainer: result.trainerName,
      stableSide: centerLabel(result.affiliationCode),
    },
    training: { slope, wood },
  };
  const profile = buildTrainingProfile(horse);
  const phases = Object.fromEntries(
    ["oneWeek", "final"]
      .map((phase) => [phase, trainingPhaseSnapshot(profile.phaseRepresentatives[phase])])
      .filter(([, value]) => value)
  );
  if (!Object.keys(phases).length) {
    skippedWithoutTraining += 1;
    continue;
  }
  observations.push({
    id: ["jv", result.raceKey ?? result.raceDate, registration, normalize(result.horseName)].join("|"),
    dedupeKey: [raceDate, normalize(result.horseName)].join("|"),
    trainer: result.trainerName,
    trainingCenter: centerLabel(result.affiliationCode) ?? profile.sessions.find((item) => item.trainer)?.trainer ?? null,
    raceDate,
    finish: Number(result.finishPosition),
    placed: Number(result.finishPosition) <= 3,
    count: profile.sessions.length,
    phases,
    source: "jvlink-history",
  });
}

const output = {
  schemaVersion: 1,
  status: "observations",
  source: "JV-Link RACE/SLOP/WOOD bounded setup exports",
  inputFiles: files.length,
  resultRows: resultsByKey.size,
  slopeRows: slopeByKey.size,
  woodRows: woodByKey.size,
  skippedWithoutTraining,
  observations,
};
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  output: outputPath,
  inputFiles: files.length,
  resultRows: resultsByKey.size,
  slopeRows: slopeByKey.size,
  woodRows: woodByKey.size,
  skippedWithoutTraining,
  observationCount: observations.length,
}, null, 2));
