#!/usr/bin/env node
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  evidenceOpponent,
  horseKey,
  indexRanking,
  isFiniteNumber,
  leaderState,
  scoreOf,
  valueOf,
  valueWatch,
} from "./race-signal-selection.mjs";
import {
  BATTLE_MIN_GAP,
  BATTLE_MIN_INDEX,
  buildBattleReadiness,
  selectBattleRace,
} from "./battle-race-selection.mjs";
import { buildEngineFingerprint } from "./intelligence/engine-fingerprint.mjs";
import { buildPairOddsIndex, pairOddsFor } from "./pair-odds.mjs";

const TOOLS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(TOOLS_DIR, "..");
const RUNTIME_CONFIG = process.env.TURF_MATRIX_ALL_RACE_RUNTIME
  ? (isAbsolute(process.env.TURF_MATRIX_ALL_RACE_RUNTIME)
      ? process.env.TURF_MATRIX_ALL_RACE_RUNTIME
      : join(REPO_ROOT, process.env.TURF_MATRIX_ALL_RACE_RUNTIME))
  : join(TOOLS_DIR, "jvlink", "output", "race-batch-runtime.json");
const TEMP_CONFIG = join(TOOLS_DIR, "jvlink", "output", "all-races-summary-config.json");
const TEMP_NORMALIZED = join(TOOLS_DIR, "week-data.all-races-normalized.json");
const TEMP_CANDIDATE = join(TOOLS_DIR, "week-data.all-races-candidate.json");
const OUTPUT = process.env.TURF_MATRIX_ALL_RACE_SIGNALS_OUT
  ? (isAbsolute(process.env.TURF_MATRIX_ALL_RACE_SIGNALS_OUT)
      ? process.env.TURF_MATRIX_ALL_RACE_SIGNALS_OUT
      : join(REPO_ROOT, process.env.TURF_MATRIX_ALL_RACE_SIGNALS_OUT))
  : join(TOOLS_DIR, "all-race-signals.json");
const CANDIDATE_COPY = process.env.TURF_MATRIX_ALL_RACE_CANDIDATE_OUT
  ? (isAbsolute(process.env.TURF_MATRIX_ALL_RACE_CANDIDATE_OUT)
      ? process.env.TURF_MATRIX_ALL_RACE_CANDIDATE_OUT
      : join(REPO_ROOT, process.env.TURF_MATRIX_ALL_RACE_CANDIDATE_OUT))
  : null;
const PAIR_ODDS_SOURCE = process.env.TURF_MATRIX_PAIR_ODDS_SOURCE
  ? (isAbsolute(process.env.TURF_MATRIX_PAIR_ODDS_SOURCE)
      ? process.env.TURF_MATRIX_PAIR_ODDS_SOURCE
      : join(REPO_ROOT, process.env.TURF_MATRIX_PAIR_ODDS_SOURCE))
  : join(REPO_ROOT, "data", "target", "pair-odds.latest.json");

const readJson = (path) => JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
let pairOddsPayload = null;
let pairOddsIndex = new Map();

const compactHorse = (horse, source, selection = null) => horse ? {
  id: horse.id,
  number: horse.number,
  name: horse.name,
  tmIndex: scoreOf(horse),
  popularity: horse.popularity ?? null,
  odds: horse.odds ?? null,
  ev: valueOf(horse)?.ev ?? null,
  marketGap: valueOf(horse)?.marketGap ?? null,
  source,
  ...(selection ? {
    selectionScore: selection.score,
    selectionCoverage: selection.coverage,
    selectionEvidence: selection.components,
  } : {}),
} : null;

const buildSignal = (race) => {
  const ranked = indexRanking(race);
  const leadership = leaderState(race);
  const hasComparableScores = new Set(ranked.map(scoreOf)).size > 1;
  const indexTop = hasComparableScores ? ranked[0] ?? null : null;
  const indexSecond = hasComparableScores ? ranked[1] ?? null : null;
  const selectedEvidence = hasComparableScores ? evidenceOpponent(race) : null;
  const secondOpponent = selectedEvidence?.horse ?? null;
  const excluded = new Set([indexTop, indexSecond, secondOpponent].filter(Boolean).map(horseKey));
  const watchHorse = valueWatch(race, excluded);

  const signal = {
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
    leaderStatus: leadership.status,
    leaderContenders: leadership.contenders.slice(0, 3).map((horse) => compactHorse(horse, "leader-contender")),
    opponents: [
      compactHorse(indexSecond, "index2"),
      compactHorse(secondOpponent, "evidence", selectedEvidence?.profile),
    ].filter(Boolean),
    valueWatch: compactHorse(watchHorse, "valueWatch"),
    valuePending: !isFiniteNumber(indexTop?.odds),
    topConfidence: indexTop?.analysis?.confidence ?? null,
    indexGap: indexTop && indexSecond ? scoreOf(indexTop) - scoreOf(indexSecond) : null,
    ticketOdds: {
      quinella: indexTop && indexSecond ? pairOddsFor(pairOddsIndex, {
        track: race.track,
        raceNo: race.number,
        type: "quinella",
        first: indexTop.number,
        second: indexSecond.number,
      }) : null,
      wide: indexTop && secondOpponent ? pairOddsFor(pairOddsIndex, {
        track: race.track,
        raceNo: race.number,
        type: "wide",
        first: indexTop.number,
        second: secondOpponent.number,
      }) : null,
    },
  };
  return {
    ...signal,
    battleProfile: buildBattleReadiness({
      indexTop,
      indexSecond,
      evidenceProfile: selectedEvidence?.profile,
      indexGap: signal.indexGap,
    }),
  };
};

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
if ((runtime.bundles?.length ?? 0) === 0) {
  throw new Error("Race runtime config does not contain any races");
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
  if (existsSync(PAIR_ODDS_SOURCE)) {
    const loaded = readJson(PAIR_ODDS_SOURCE);
    if (loaded.RaceDate === (candidate.meta?.date ?? runtime.raceDate)) {
      pairOddsPayload = loaded;
      pairOddsIndex = buildPairOddsIndex(loaded);
    } else {
      console.warn(`Ignoring stale pair odds for ${loaded.RaceDate ?? "unknown date"}`);
    }
  }
  if (CANDIDATE_COPY) writeFileSync(CANDIDATE_COPY, JSON.stringify(candidate, null, 2) + "\n");
  const signals = (candidate.races ?? []).map(buildSignal);
  const battleRace = selectBattleRace(signals);
  const selectionFingerprint = buildEngineFingerprint({
    root: REPO_ROOT,
    entryPoints: ["tools/generate-all-race-signals.mjs"],
  });
  const output = {
    schemaVersion: 1,
    date: candidate.meta?.date ?? runtime.raceDate,
    source: "jv-link-all-races",
    pairOdds: pairOddsPayload ? {
      status: "available",
      generatedAt: pairOddsPayload.GeneratedAt ?? null,
      source: pairOddsPayload.Source ?? null,
      combinations: pairOddsIndex.size,
    } : { status: "unavailable" },
    engineFingerprint: candidate.meta?.engineFingerprint ?? null,
    selectionFingerprint,
    thresholds: {
      battleMinIndex: BATTLE_MIN_INDEX,
      battleMinGap: BATTLE_MIN_GAP,
      clearLeaderMinGap: BATTLE_MIN_GAP,
      opponent2Method: "index3to5-evidence",
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
