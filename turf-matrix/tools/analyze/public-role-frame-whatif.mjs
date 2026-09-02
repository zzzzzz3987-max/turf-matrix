#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildFrameAptitudeModel } from "../learn/frame-aptitude-learning.mjs";
import { selectPublicRoleFrameShadow } from "../intelligence/public-role-frame-shadow.mjs";
import { loadFrozenPublicRoleDays } from "./lib/public-role-archive.mjs";
import { summarizePublicRoleRecords } from "./lib/public-role-performance.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const HISTORY_PATH = join(ROOT, "data", "master", "race-shape-history.json");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const normalizeName = (value) => String(value ?? "").normalize("NFKC").replace(/[\s\u3000]/g, "");
const resultFor = (selection, race) => {
  if (!selection || !race) return null;
  const result = (race.horses ?? []).find((horse) => Number(horse.horseNumber) === Number(selection.number));
  return result && normalizeName(result.horseName) === normalizeName(selection.name) ? result : null;
};
const record = (selection, result, date, raceId) => {
  if (!selection || !finite(result?.finishPosition)) return null;
  const payoutAvailable = finite(result.winPayout) && finite(result.placePayout);
  return {
    date, raceId, horseName: selection.name, finishPosition: result.finishPosition, payoutAvailable,
    winPayout: payoutAvailable ? result.winPayout : null,
    placePayout: payoutAvailable ? result.placePayout : null,
  };
};

if (!existsSync(HISTORY_PATH)) throw new Error(`Race-shape history is missing: ${HISTORY_PATH}`);
const history = readJson(HISTORY_PATH);
const days = loadFrozenPublicRoleDays({ root: ROOT });
const buckets = { productionValue: [], paceValue: [], frameValue: [] };
const paired = { paceValue: [], frameValue: [] };
let frameChanged = 0;
let comparedRaces = 0;
const dailyModels = new Map();

for (const { date, snapshot, results } of days) {
  const priorRaces = (history.races ?? []).filter((race) => String(race.date) < date);
  const frameModel = buildFrameAptitudeModel({ ...history, races: priorRaces });
  dailyModels.set(date, frameModel);
  const resultByRace = new Map((results.races ?? []).map((race) => [race.bundleId, race]));
  for (const race of snapshot.races ?? []) {
    const resultRace = resultByRace.get(race.bundleId);
    if (!resultRace) continue;
    const selected = selectPublicRoleFrameShadow(race, history, frameModel);
    comparedRaces += 1;
    for (const key of Object.keys(buckets)) {
      const row = record(selected[key], resultFor(selected[key], resultRace), date, race.bundleId);
      if (row) buckets[key].push(row);
    }
    const paceRow = record(selected.paceValue, resultFor(selected.paceValue, resultRace), date, race.bundleId);
    const frameRow = record(selected.frameValue, resultFor(selected.frameValue, resultRace), date, race.bundleId);
    if (paceRow && frameRow) {
      paired.paceValue.push(paceRow);
      paired.frameValue.push(frameRow);
      if (selected.paceValue.number !== selected.frameValue.number) frameChanged += 1;
    }
  }
}

console.log(JSON.stringify({
  policy: {
    retrospectiveDiagnosticOnly: true,
    frozenHistoricalSnapshotsUsed: true,
    frameModelRebuiltStrictlyBeforeEachRaceDate: true,
    currentRaceResultUsedForSelection: false,
    frameAdjustmentBound: 1,
    productionConnected: false,
  },
  dates: days.map((day) => day.date),
  frameModelPeriods: Object.fromEntries([...dailyModels].map(([date, model]) => [date, model.period])),
  comparedRaces,
  frameChanged,
  productionValue: summarizePublicRoleRecords(buckets.productionValue),
  paceValue: summarizePublicRoleRecords(buckets.paceValue),
  frameValue: summarizePublicRoleRecords(buckets.frameValue),
  pairedPaceValue: summarizePublicRoleRecords(paired.paceValue),
  pairedFrameValue: summarizePublicRoleRecords(paired.frameValue),
}, null, 2));
