#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isValueSignalEv } from "../src/lib/value-rules.js";

const TOOLS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(TOOLS_DIR, "..");
const CANDIDATE_PATH = join(TOOLS_DIR, "week-data.batch-candidate.json");
const BASELINE_PATH = join(TOOLS_DIR, "week-data.preodds-baseline.json");
const GIT_BASELINE_PATHS = [
  "HEAD:turf-matrix/tools/week-data.batch-candidate.json",
  "HEAD:tools/week-data.batch-candidate.json",
];
const ODDS_SUM_MIN = 1.2;
const ODDS_SUM_MAX = 1.3;
const PROB_SUM_TARGET = 1;
const PROB_SUM_TOLERANCE = 0.01;
const INDEX_DELTA_WARN = 3;
const SOFTMAX_K = 7;

const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);
const fmt = (value, digits = 3) => (isFiniteNumber(value) ? value.toFixed(digits) : "n/a");
const signed = (value) => (value > 0 ? `+${value}` : `${value}`);
const repoPath = (path) => relative(REPO_ROOT, path).replaceAll("\\", "/");

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

const loadBaseline = () => {
  if (existsSync(BASELINE_PATH)) {
    return { source: repoPath(BASELINE_PATH), data: readJson(BASELINE_PATH) };
  }
  for (const gitPath of GIT_BASELINE_PATHS) {
    try {
      return {
        source: gitPath,
        data: JSON.parse(execFileSync("git", ["show", gitPath], { encoding: "utf8", maxBuffer: 40 * 1024 * 1024 })),
      };
    } catch {
      // Try the next repository layout.
    }
  }
  return { source: null, data: null };
};

const raceKey = (race) => race.id ?? `${race.track ?? race.course}-${race.number ?? race.raceNo}R-${race.name ?? race.raceName}`;
const horseKey = (race, horse) => `${raceKey(race)}|${horse.number ?? horse.horseNumber}`;

const winProbabilities = (horses) => {
  const evaluated = horses.filter((horse) => isFiniteNumber(horse.tmIndex));
  const denom = evaluated.reduce((sum, horse) => sum + Math.exp(horse.tmIndex / SOFTMAX_K), 0);
  return new Map(evaluated.map((horse) => [horse, Math.exp(horse.tmIndex / SOFTMAX_K) / denom]));
};

const statusFor = ({ fails, warns }) => (fails.length ? "FAIL" : warns.length ? "WARN" : "PASS");

const candidate = readJson(CANDIDATE_PATH);
const baseline = loadBaseline();
const baselineIndex = new Map();
if (baseline.data) {
  for (const race of baseline.data.races ?? []) {
    for (const horse of race.horses ?? []) {
      baselineIndex.set(horseKey(race, horse), horse.tmIndex);
    }
  }
}

const failRaces = [];
const warnRaces = [];
const raceResults = [];

for (const race of candidate.races ?? []) {
  const fails = [];
  const warns = [];
  const horses = race.horses ?? [];
  const probs = winProbabilities(horses);
  const oddsEntries = horses.filter((horse) => isFiniteNumber(horse.odds) && horse.odds > 0);

  if (oddsEntries.length !== horses.length) {
    fails.push(`odds missing: ${horses.length - oddsEntries.length}/${horses.length}`);
  }

  const oddsSum = oddsEntries.reduce((sum, horse) => sum + 1 / horse.odds, 0);
  if (!isFiniteNumber(oddsSum) || oddsSum < ODDS_SUM_MIN || oddsSum > ODDS_SUM_MAX) {
    fails.push(`odds sum ${fmt(oddsSum)} outside ${ODDS_SUM_MIN.toFixed(2)}-${ODDS_SUM_MAX.toFixed(2)}`);
  }

  const probSum = [...probs.values()].reduce((sum, prob) => sum + prob, 0);
  if (!isFiniteNumber(probSum) || Math.abs(probSum - PROB_SUM_TARGET) > PROB_SUM_TOLERANCE) {
    fails.push(`AI probability sum ${fmt(probSum)} outside ${PROB_SUM_TARGET.toFixed(2)}±${PROB_SUM_TOLERANCE.toFixed(2)}`);
  }

  const indexWarnings = [];
  if (!baseline.data) {
    warns.push("preodds baseline not found; TM INDEX delta check skipped");
  } else {
    for (const horse of horses) {
      const before = baselineIndex.get(horseKey(race, horse));
      if (!isFiniteNumber(before)) {
        indexWarnings.push(`${horse.name}: baseline missing`);
        continue;
      }
      const delta = horse.tmIndex - before;
      if (Math.abs(delta) > INDEX_DELTA_WARN) {
        indexWarnings.push(`${horse.name}: ${before}->${horse.tmIndex} (${signed(delta)})`);
      }
    }
  }
  if (indexWarnings.length) warns.push(`TM INDEX delta > ±${INDEX_DELTA_WARN}: ${indexWarnings.join("; ")}`);

  const evRows = horses
    .map((horse) => {
      const prob = probs.get(horse);
      const ev = isFiniteNumber(prob) && isFiniteNumber(horse.odds) ? prob * horse.odds : null;
      return { horse, prob, ev };
    })
    .filter((row) => isFiniteNumber(row.ev));
  const evValues = evRows.map((row) => row.ev);
  const evMin = evValues.length ? Math.min(...evValues) : null;
  const evMax = evValues.length ? Math.max(...evValues) : null;
  const evExtreme = evRows.filter((row) => row.ev > 3 || row.ev < 0.1);
  if (evExtreme.length) {
    warns.push(`EV extreme: ${evExtreme.map((row) => `${row.horse.name} ${fmt(row.ev, 2)}`).join("; ")}`);
  }

  const favorite = evRows.find((row) => row.horse.popularity === 1) ?? null;
  const signalCounts = {};
  for (const row of evRows) {
    const explicitType = row.horse.analysis?.topSignal?.type ?? row.horse.topSignal?.type;
    const type = explicitType === "value" && !isValueSignalEv(row.ev) ? "index" : (explicitType ?? (isValueSignalEv(row.ev) ? "value" : "index"));
    signalCounts[type] = (signalCounts[type] ?? 0) + 1;
  }

  const status = statusFor({ fails, warns });
  if (fails.length) failRaces.push(race.name);
  else if (warns.length) warnRaces.push(race.name);

  raceResults.push({
    status,
    race,
    oddsSum,
    probSum,
    evMin,
    evMax,
    favorite,
    signalCounts,
    fails,
    warns,
  });
}

console.log(`Odds verification: ${repoPath(CANDIDATE_PATH)}`);
console.log(`Preodds baseline: ${baseline.source ?? "not found"}`);
console.log("");

for (const result of raceResults) {
  const { status, race, oddsSum, probSum, evMin, evMax, favorite, signalCounts, fails, warns } = result;
  console.log(`[${status}] ${race.track}${race.number}R ${race.name}`);
  console.log(`  odds sum Σ(1/odds): ${fmt(oddsSum)} (${ODDS_SUM_MIN.toFixed(2)}-${ODDS_SUM_MAX.toFixed(2)})`);
  console.log(`  AI probability sum: ${fmt(probSum)} (${PROB_SUM_TARGET.toFixed(2)}±${PROB_SUM_TOLERANCE.toFixed(2)})`);
  console.log(`  EV min/max: ${fmt(evMin, 2)} / ${fmt(evMax, 2)}`);
  console.log(`  favorite EV: ${favorite ? `${favorite.horse.name} ${fmt(favorite.ev, 2)} (odds ${fmt(favorite.horse.odds, 1)})` : "n/a"}`);
  console.log(`  TOP SIGNAL types: ${Object.keys(signalCounts).length ? JSON.stringify(signalCounts) : "n/a"}`);
  for (const fail of fails) console.log(`  FAIL: ${fail}`);
  for (const warn of warns) console.log(`  WARN: ${warn}`);
  console.log("");
}

if (failRaces.length) {
  console.log(`FAILあり: ${failRaces.join(", ")}`);
  process.exitCode = 1;
} else if (warnRaces.length) {
  console.log(`FAILなし / WARNあり: ${warnRaces.join(", ")}`);
} else {
  console.log("全レースPASS");
}
