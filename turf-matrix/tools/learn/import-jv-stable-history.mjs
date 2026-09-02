import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { buildTrainingProfile } from "../intelligence/training-ai.mjs";
import {
  affiliationLabel,
  daysBetween,
  isoDate,
  normalizeKey,
  rotationBucket,
  travelClass,
} from "../intelligence/stable-operation-features.mjs";
import { trainingPhaseSnapshot } from "./stable-pattern-learning.mjs";

const args = process.argv.slice(2);
const valueAfter = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const inputDir = resolve(valueAfter("--input-dir", "tools/jvlink/output/stable-history"));
const outputPath = resolve(valueAfter("--output", "tools/jvlink/output/stable-history-observations.json"));
const normalize = normalizeKey;
const resultIdentity = (result) => [result.raceKey ?? result.raceDate, result.bloodRegistrationNumber, normalize(result.horseName)].join("|");

if (!existsSync(inputDir)) {
  console.error(`[ERROR] 履歴エクスポートディレクトリがありません: ${inputDir}`);
  process.exit(2);
}

const files = readdirSync(inputDir).filter((name) => name.endsWith(".json")).sort().map((name) => join(inputDir, name));
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

const previousResultById = new Map();
const resultsByHorse = new Map();
for (const result of resultsByKey.values()) {
  const registration = String(result.bloodRegistrationNumber ?? "").trim();
  if (!registration) continue;
  const rows = resultsByHorse.get(registration) ?? [];
  rows.push(result);
  resultsByHorse.set(registration, rows);
}
for (const rows of resultsByHorse.values()) {
  rows.sort((left, right) => String(left.raceDate).localeCompare(String(right.raceDate)) || String(left.raceKey).localeCompare(String(right.raceKey)));
  for (let index = 0; index < rows.length; index += 1) {
    const current = rows[index];
    const previous = rows.slice(0, index).reverse().find((row) => String(row.raceDate) < String(current.raceDate));
    if (previous) previousResultById.set(resultIdentity(current), previous);
  }
}

const observations = [];
const operationObservations = [];
let skippedWithoutTraining = 0;
for (const result of resultsByKey.values()) {
  const registration = result.bloodRegistrationNumber;
  const raceDate = isoDate(result.raceDate);
  const previousResult = previousResultById.get(resultIdentity(result)) ?? null;
  const previousRaceDate = previousResult ? isoDate(previousResult.raceDate) : null;
  const intervalDays = previousRaceDate ? daysBetween(previousRaceDate, raceDate) : null;
  const currentJockey = String(result.jockeyName ?? "").trim() || null;
  const previousJockey = String(previousResult?.jockeyName ?? "").trim() || null;
  const sameTrainer = previousResult
    ? normalize(previousResult.trainerName) === normalize(result.trainerName)
    : null;
  const courseCode = result.courseCode ?? String(result.raceKey ?? "").split("-")[1] ?? null;
  const operation = {
    id: ["jv-operation", result.raceKey ?? result.raceDate, registration, normalize(result.horseName)].join("|"),
    trainer: result.trainerName,
    bloodRegistrationNumber: registration,
    trainingCenter: affiliationLabel(result.affiliationCode),
    raceDate,
    raceKey: result.raceKey ?? null,
    courseCode,
    horseNumber: Number(result.horseNumber) || null,
    jockey: currentJockey,
    previousRaceDate,
    previousTrainer: previousResult?.trainerName ?? null,
    previousJockey,
    sameTrainer,
    intervalDays: Number.isFinite(intervalDays) ? intervalDays : null,
    rotationBucket: sameTrainer === false ? null : rotationBucket(intervalDays),
    jockeyContinuity: currentJockey && previousJockey ? normalize(currentJockey) === normalize(previousJockey) : null,
    travelClass: travelClass({ affiliationCode: result.affiliationCode, courseCode }),
    finish: Number(result.finishPosition),
    placed: Number(result.finishPosition) <= 3,
    source: "jvlink-history",
  };
  operationObservations.push(operation);
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
    stableSide: affiliationLabel(result.affiliationCode),
    currentRace: {
      raceDate,
      trainer: result.trainerName,
      stableSide: affiliationLabel(result.affiliationCode),
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
    bloodRegistrationNumber: registration,
    trainingCenter: affiliationLabel(result.affiliationCode),
    raceDate,
    raceKey: result.raceKey ?? null,
    courseCode,
    horseNumber: Number(result.horseNumber) || null,
    jockey: currentJockey,
    previousRaceDate,
    previousTrainer: previousResult?.trainerName ?? null,
    previousJockey,
    sameTrainer,
    intervalDays: Number.isFinite(intervalDays) ? intervalDays : null,
    rotationBucket: sameTrainer === false ? null : rotationBucket(intervalDays),
    jockeyContinuity: currentJockey && previousJockey ? normalize(currentJockey) === normalize(previousJockey) : null,
    travelClass: operation.travelClass,
    finish: Number(result.finishPosition),
    placed: Number(result.finishPosition) <= 3,
    count: profile.sessions.length,
    phases,
    source: "jvlink-history",
  });
}

const output = {
  schemaVersion: 2,
  status: "observations",
  source: "JV-Link RACE/SLOP/WOOD bounded setup exports",
  inputFiles: files.length,
  resultRows: resultsByKey.size,
  slopeRows: slopeByKey.size,
  woodRows: woodByKey.size,
  skippedWithoutTraining,
  operationFields: ["rotationBucket", "jockeyContinuity", "travelClass"],
  operationObservationCount: operationObservations.length,
  operationObservations,
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
  operationObservationCount: operationObservations.length,
  observationCount: observations.length,
}, null, 2));
