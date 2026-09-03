#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { selectPublicRoleEvidenceShadow } from "../intelligence/public-role-evidence-shadow.mjs";
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
const buckets = { productionValue: [], paceValue: [], evidenceValue: [], productionDanger: [], paceDanger: [], evidenceDanger: [] };
const paired = { paceValue: [], evidenceValue: [], paceDanger: [], evidenceDanger: [] };
let valueChanged = 0;
let dangerChanged = 0;
let comparedRaces = 0;
let paceValueCandidates = 0;
let paceDangerCandidates = 0;

for (const { date, snapshot, results } of days) {
  const resultByRace = new Map((results.races ?? []).map((race) => [race.bundleId, race]));
  for (const race of snapshot.races ?? []) {
    const resultRace = resultByRace.get(race.bundleId);
    if (!resultRace) continue;
    const selected = selectPublicRoleEvidenceShadow(race, history);
    comparedRaces += 1;
    if (selected.paceValue) paceValueCandidates += 1;
    if (selected.paceDanger) paceDangerCandidates += 1;
    for (const key of Object.keys(buckets)) {
      const row = record(selected[key], resultFor(selected[key], resultRace), date, race.bundleId);
      if (row) buckets[key].push(row);
    }
    for (const [paceKey, evidenceKey] of [["paceValue", "evidenceValue"], ["paceDanger", "evidenceDanger"]]) {
      const paceRow = record(selected[paceKey], resultFor(selected[paceKey], resultRace), date, race.bundleId);
      const evidenceRow = record(selected[evidenceKey], resultFor(selected[evidenceKey], resultRace), date, race.bundleId);
      if (paceRow && evidenceRow) {
        paired[paceKey].push(paceRow);
        paired[evidenceKey].push(evidenceRow);
        if (selected[paceKey].number !== selected[evidenceKey].number) {
          if (paceKey === "paceValue") valueChanged += 1;
          else dangerChanged += 1;
        }
      }
    }
  }
}

console.log(JSON.stringify({
  policy: {
    retrospectiveDiagnosticOnly: true,
    frozenHistoricalSnapshotsUsed: true,
    newDistanceLoadDetailAvailability: "legacy snapshots are partial",
    currentRaceResultUsedForSelection: false,
    futureRaceShapeJoinAllowed: false,
    productionConnected: false,
  },
  dates: days.map((day) => day.date),
  comparedRaces,
  valueChanged,
  dangerChanged,
  valueCoverage: paceValueCandidates ? buckets.evidenceValue.length / paceValueCandidates : 0,
  dangerCoverage: paceDangerCandidates ? buckets.evidenceDanger.length / paceDangerCandidates : 0,
  ...Object.fromEntries(Object.entries(buckets).map(([key, rows]) => [key, summarizePublicRoleRecords(rows)])),
  paired: Object.fromEntries(Object.entries(paired).map(([key, rows]) => [key, summarizePublicRoleRecords(rows)])),
}, null, 2));
