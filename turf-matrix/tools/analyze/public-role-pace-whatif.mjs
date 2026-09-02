#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { selectPublicRolePaceShadow } from "../intelligence/public-role-pace-shadow.mjs";
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
    date,
    raceId,
    horseName: selection.name,
    finishPosition: result.finishPosition,
    payoutAvailable,
    winPayout: payoutAvailable ? result.winPayout : null,
    placePayout: payoutAvailable ? result.placePayout : null,
  };
};

if (!existsSync(HISTORY_PATH)) throw new Error(`Race-shape history is missing: ${HISTORY_PATH}`);
const history = readJson(HISTORY_PATH);
const days = loadFrozenPublicRoleDays({ root: ROOT });
const buckets = { productionValue: [], paceValue: [], productionDanger: [], paceDanger: [] };
const paired = { productionValue: [], paceValue: [], productionDanger: [], paceDanger: [] };
let valueChanged = 0;
let dangerChanged = 0;
let comparedRaces = 0;
for (const { date, snapshot, results } of days) {
  const resultByRace = new Map((results.races ?? []).map((race) => [race.bundleId, race]));
  for (const race of snapshot.races ?? []) {
    const resultRace = resultByRace.get(race.bundleId);
    if (!resultRace) continue;
    const selected = selectPublicRolePaceShadow(race, history);
    comparedRaces += 1;
    for (const key of Object.keys(buckets)) {
      const result = resultFor(selected[key], resultRace);
      const row = record(selected[key], result, date, race.bundleId);
      if (row) buckets[key].push(row);
    }
    for (const [productionKey, paceKey] of [["productionValue", "paceValue"], ["productionDanger", "paceDanger"]]) {
      const productionResult = resultFor(selected[productionKey], resultRace);
      const paceResult = resultFor(selected[paceKey], resultRace);
      const productionRow = record(selected[productionKey], productionResult, date, race.bundleId);
      const paceRow = record(selected[paceKey], paceResult, date, race.bundleId);
      if (productionRow && paceRow) {
        paired[productionKey].push(productionRow);
        paired[paceKey].push(paceRow);
      }
    }
    if (selected.productionValue && selected.paceValue && selected.productionValue.number !== selected.paceValue.number) valueChanged += 1;
    if (selected.productionDanger && selected.paceDanger && selected.productionDanger.number !== selected.paceDanger.number) dangerChanged += 1;
  }
}

console.log(JSON.stringify({
  policy: {
    retrospectiveDiagnosticOnly: true,
    frozenHistoricalSnapshotsUsed: true,
    currentRaceResultUsedForSelection: false,
    futureRaceShapeJoinAllowed: false,
    productionConnected: false,
  },
  dates: days.map((day) => day.date),
  comparedRaces,
  valueChanged,
  dangerChanged,
  productionValue: summarizePublicRoleRecords(buckets.productionValue),
  paceValue: summarizePublicRoleRecords(buckets.paceValue),
  pairedProductionValue: summarizePublicRoleRecords(paired.productionValue),
  pairedPaceValue: summarizePublicRoleRecords(paired.paceValue),
  productionDanger: summarizePublicRoleRecords(buckets.productionDanger),
  paceDanger: summarizePublicRoleRecords(buckets.paceDanger),
  pairedProductionDanger: summarizePublicRoleRecords(paired.productionDanger),
  pairedPaceDanger: summarizePublicRoleRecords(paired.paceDanger),
}, null, 2));
