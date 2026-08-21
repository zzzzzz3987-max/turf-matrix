#!/usr/bin/env node
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const TOOLS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(TOOLS_DIR, "..");
const RUNTIME_CONFIG = join(TOOLS_DIR, "jvlink", "output", "race-batch-runtime.json");
const TEMP_CONFIG = join(TOOLS_DIR, "jvlink", "output", "all-races-summary-config.json");
const TEMP_NORMALIZED = join(TOOLS_DIR, "week-data.all-races-normalized.json");
const TEMP_CANDIDATE = join(TOOLS_DIR, "week-data.all-races-candidate.json");
const OUTPUT = process.env.TURF_MATRIX_ALL_RACE_SIGNALS_OUT
  ? (isAbsolute(process.env.TURF_MATRIX_ALL_RACE_SIGNALS_OUT)
      ? process.env.TURF_MATRIX_ALL_RACE_SIGNALS_OUT
      : join(REPO_ROOT, process.env.TURF_MATRIX_ALL_RACE_SIGNALS_OUT))
  : join(TOOLS_DIR, "all-race-signals.json");

const BATTLE_MIN_INDEX = 80;
const BATTLE_MIN_GAP = 2;
const VALUE_MIN_EV = 1.0;
const VALUE_MAX_EV = 3.0;

const readJson = (path) => JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
const scoreOf = (horse) => horse?.tmIndex ?? horse?.aiScore ?? horse?.analysis?.tmIndex ?? null;
const valueOf = (horse) => horse?.analysis?.factorsDetail?.value ?? null;
const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);
const horseKey = (horse) => horse?.id ?? `${horse?.number}:${horse?.name}`;

const indexRanking = (race) => [...(race.horses ?? [])]
  .filter((horse) => isFiniteNumber(scoreOf(horse)))
  .sort((left, right) => scoreOf(right) - scoreOf(left) || left.number - right.number);

const valueRanking = (race, excluded) => [...(race.horses ?? [])]
  .filter((horse) => {
    const value = valueOf(horse);
    return !excluded.has(horseKey(horse))
      && isFiniteNumber(value?.ev)
      && value.ev >= VALUE_MIN_EV
      && value.ev < VALUE_MAX_EV
      && isFiniteNumber(value?.marketGap)
      && value.marketGap >= 0;
  })
  .sort((left, right) => {
    const leftValue = valueOf(left);
    const rightValue = valueOf(right);
    return rightValue.marketGap - leftValue.marketGap
      || rightValue.ev - leftValue.ev
      || scoreOf(right) - scoreOf(left)
      || left.number - right.number;
  });

const compactHorse = (horse, source) => horse ? {
  id: horse.id,
  number: horse.number,
  name: horse.name,
  tmIndex: scoreOf(horse),
  popularity: horse.popularity ?? null,
  odds: horse.odds ?? null,
  ev: valueOf(horse)?.ev ?? null,
  marketGap: valueOf(horse)?.marketGap ?? null,
  source,
} : null;

const buildSignal = (race) => {
  const ranked = indexRanking(race);
  const hasComparableScores = new Set(ranked.map(scoreOf)).size > 1;
  const indexTop = hasComparableScores ? ranked[0] ?? null : null;
  const indexSecond = hasComparableScores ? ranked[1] ?? null : null;
  const excluded = new Set([horseKey(indexTop), horseKey(indexSecond)]);
  const valueTop = valueRanking(race, excluded)[0] ?? null;
  const fallback = hasComparableScores
    ? ranked.find((horse) => !excluded.has(horseKey(horse))) ?? null
    : null;
  const secondOpponent = valueTop ?? fallback;

  return {
    id: race.id,
    bundleId: race.bundleId,
    track: race.track,
    number: race.number,
    name: race.name || `${race.track}${race.number}R`,
    grade: race.grade || null,
    category: race.category ?? "race",
    time: race.time ?? null,
    surface: race.surface,
    distance: race.distance,
    fieldSize: race.fieldSize,
    oddsStatus: race.oddsStatus ?? "missing",
    indexTop: compactHorse(indexTop, "index1"),
    opponents: [
      compactHorse(indexSecond, "index2"),
      compactHorse(secondOpponent, valueTop ? "value1" : "index3"),
    ].filter(Boolean),
    valuePending: !valueTop,
    topConfidence: indexTop?.analysis?.confidence ?? null,
    indexGap: indexTop && indexSecond ? scoreOf(indexTop) - scoreOf(indexSecond) : null,
  };
};

const selectBattleRace = (signals) => signals
  .filter((race) => race.category !== "race")
  .filter((race) => race.indexTop?.tmIndex >= BATTLE_MIN_INDEX)
  .filter((race) => race.indexGap >= BATTLE_MIN_GAP)
  .filter((race) => race.topConfidence !== "low")
  .sort((left, right) => right.indexGap - left.indexGap
    || right.indexTop.tmIndex - left.indexTop.tmIndex
    || String(left.time ?? "").localeCompare(String(right.time ?? "")))[0] ?? null;

const runNode = (script, env) => {
  const result = spawnSync(process.execPath, [script], {
    cwd: REPO_ROOT,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) throw new Error(`${script} failed with exit code ${result.status}`);
};

if (!existsSync(RUNTIME_CONFIG)) {
  throw new Error(`All-race runtime config is missing: ${RUNTIME_CONFIG}`);
}

const runtime = readJson(RUNTIME_CONFIG);
if ((runtime.bundles?.length ?? 0) < 30) {
  throw new Error(`All-race runtime config must contain a full card; got ${runtime.bundles?.length ?? 0} races`);
}
writeFileSync(TEMP_CONFIG, JSON.stringify({
  ...runtime,
  allowMissingRaceName: true,
  allowMissingPastRuns: true,
}, null, 2) + "\n");

try {
  const sharedEnv = {
    TURF_MATRIX_RACE_CONFIG: TEMP_CONFIG,
    TURF_MATRIX_BATCH_NORMALIZED_OUT: TEMP_NORMALIZED,
    TURF_MATRIX_BATCH_NORMALIZED_IN: TEMP_NORMALIZED,
    TURF_MATRIX_BATCH_CANDIDATE_OUT: TEMP_CANDIDATE,
  };
  runNode("tools/normalizers/race-batch.mjs", sharedEnv);
  runNode("tools/generate-race-batch-candidate.mjs", sharedEnv);

  const candidate = readJson(TEMP_CANDIDATE);
  const signals = (candidate.races ?? []).map(buildSignal);
  const battleRace = selectBattleRace(signals);
  const output = {
    schemaVersion: 1,
    date: candidate.meta?.date ?? runtime.raceDate,
    source: "jv-link-all-races",
    thresholds: {
      battleMinIndex: BATTLE_MIN_INDEX,
      battleMinGap: BATTLE_MIN_GAP,
      valueMinEv: VALUE_MIN_EV,
      valueMaxEv: VALUE_MAX_EV,
    },
    raceCount: signals.length,
    battleRaceId: battleRace?.id ?? null,
    races: signals,
  };
  writeFileSync(OUTPUT, JSON.stringify(output, null, 2) + "\n");
  console.log(JSON.stringify({
    out: OUTPUT,
    raceCount: signals.length,
    battleRace: battleRace ? `${battleRace.track}${battleRace.number}R ${battleRace.name}` : null,
  }, null, 2));
} finally {
  rmSync(TEMP_CONFIG, { force: true });
  rmSync(TEMP_NORMALIZED, { force: true });
  rmSync(TEMP_CANDIDATE, { force: true });
}
