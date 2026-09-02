#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { rankPublicRoleHorses } from "../../src/lib/public-role-selection.js";
import { selectPublicRolePaceShadow } from "../intelligence/public-role-pace-shadow.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ARCHIVE_DIR = join(ROOT, "data", "archive");
const SHADOW_DIR = join(ROOT, "data", "shadow", "public-role-pace-v3");
const HISTORY_PATH = join(ROOT, "data", "master", "race-shape-history.json");
const DEFAULT_INPUT = join(ROOT, "tools", "week-data.batch-candidate.json");
const MODEL_VERSION = "public-role-pace-shadow-v3";
const args = process.argv.slice(2);
const valueAfter = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const flag = (name) => args.includes(name);
const inputPath = valueAfter("--input", DEFAULT_INPUT);
const dryRun = flag("--dry-run");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
const stableJson = (value) => `${JSON.stringify(value, null, 2)}\n`;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const compactHorse = (horse, race, evidence = null) => {
  if (!horse) return null;
  const rank = rankPublicRoleHorses(race).find((candidate) => candidate.horse.id === horse.id)?.rank ?? null;
  return {
    id: horse.id ?? null,
    number: horse.number,
    name: horse.name,
    popularity: horse.popularity ?? null,
    tmIndex: horse.aiScore ?? horse.tmIndex ?? null,
    indexRank: rank,
    ...(evidence ? {
      evidenceScore: evidence.evidenceScore,
      weakest: evidence.weakest,
      roleQuality: evidence.roleQuality,
      dangerStrength: evidence.dangerStrength,
      paceEvidenceAdjustment: evidence.paceEvidenceAdjustment,
      matchedRunCount: evidence.paceProfile.matchedRunCount,
      paceConfidence: evidence.paceProfile.confidence,
      paceRuns: evidence.paceProfile.runs,
    } : {}),
  };
};

if (!existsSync(inputPath)) throw new Error(`Public role input is missing: ${inputPath}`);
if (!existsSync(HISTORY_PATH)) throw new Error(`Race-shape history is missing: ${HISTORY_PATH}`);
const inputText = readFileSync(inputPath, "utf8").replace(/^\uFEFF/, "");
const source = JSON.parse(inputText);
const historyText = readFileSync(HISTORY_PATH);
const history = JSON.parse(historyText.toString("utf8").replace(/^\uFEFF/, ""));
if (history.policy?.actualRaceLapsAvailable !== true) throw new Error("Official historical race laps are not available");
const raceDate = source.meta?.date ?? source.races?.[0]?.horses?.[0]?.currentRace?.raceDate;
if (!/^\d{4}-\d{2}-\d{2}$/.test(raceDate ?? "")) throw new Error("Public role race date is missing");
if (existsSync(join(ARCHIVE_DIR, `${raceDate}-results.json`)) && !flag("--reconstruct")) {
  throw new Error(`Results already exist for ${raceDate}; pre-race role freeze refused`);
}

const predictions = (source.races ?? []).map((race) => {
  const selected = selectPublicRolePaceShadow(race, history);
  return {
    raceId: race.id,
    bundleId: race.bundleId,
    track: race.track,
    raceNumber: race.number,
    raceName: race.name,
    productionValue: compactHorse(selected.productionValue, race),
    evidenceValue: compactHorse(selected.evidenceValue, race),
    paceValue: compactHorse(selected.paceValue, race, selected.evidence.value),
    productionDanger: compactHorse(selected.productionDanger, race),
    paceDanger: compactHorse(selected.paceDanger, race, selected.evidence.danger),
  };
});
const payload = { modelVersion: MODEL_VERSION, raceDate, historySha256: sha256(historyText), predictions };
const predictionSha256 = sha256(stableJson(payload));
const artifact = {
  schemaVersion: 1,
  status: flag("--reconstruct") ? "reconstructed-pre-race-shadow" : "frozen-pre-race-shadow",
  modelVersion: MODEL_VERSION,
  frozenAt: new Date().toISOString(),
  raceDate,
  productionConnected: false,
  policy: {
    currentRaceResultRead: false,
    futureRaceShapeJoinAllowed: false,
    historicalOfficialLapsUsed: true,
    currentRacePopularityUsedForPublicRoleOnly: true,
    tmIndexChanged: false,
  },
  source: {
    input: relative(ROOT, inputPath).replaceAll("\\", "/"),
    inputSha256: sha256(inputText),
    history: relative(ROOT, HISTORY_PATH).replaceAll("\\", "/"),
    historySha256: sha256(historyText),
    historyRaceCount: history.summary?.raceCount ?? 0,
    historyPaceRaceCount: history.summary?.paceRaceCount ?? 0,
  },
  summary: {
    raceCount: predictions.length,
    paceValueCount: predictions.filter((race) => race.paceValue).length,
    paceDangerCount: predictions.filter((race) => race.paceDanger).length,
    valueChangedCount: predictions.filter((race) => race.productionValue?.number !== race.paceValue?.number).length,
    dangerChangedCount: predictions.filter((race) => race.productionDanger?.number !== race.paceDanger?.number).length,
    lapMatchedValueCount: predictions.filter((race) => race.paceValue?.paceRuns?.some((run) => run.paceClass)).length,
    lapMatchedDangerCount: predictions.filter((race) => race.paceDanger?.paceRuns?.some((run) => run.paceClass)).length,
  },
  predictionSha256,
  predictions,
};

mkdirSync(SHADOW_DIR, { recursive: true });
const output = join(SHADOW_DIR, `${raceDate}-pre-race.json`);
if (!dryRun && existsSync(output)) {
  const previous = readJson(output);
  if (previous.predictionSha256 !== predictionSha256) throw new Error(`Frozen public-role Pace shadow differs: ${output}`);
} else if (!dryRun) writeFileSync(output, stableJson(artifact));
console.log(JSON.stringify({ output, dryRun, raceDate, predictionSha256, ...artifact.summary }, null, 2));
