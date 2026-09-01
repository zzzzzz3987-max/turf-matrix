import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import {
  mergePedigreeWithReference,
  normalizeHorseKey,
  pedigreeIdentityMatches,
} from "../normalizers/race-bundle.mjs";
import { scoreBlood } from "../intelligence/blood-ai.mjs";
import {
  assessPedigreeCompleteness,
  detectPedigreeCrosses,
  pedigreeFeatureEntries,
} from "../intelligence/blood-features.mjs";
import { buildRaceContext } from "../intelligence/race-context.mjs";

const ROOT = resolve(import.meta.dirname, "..", "..");
const args = process.argv.slice(2);
const valueAfter = (flag, fallback) => {
  const exact = args.find((arg) => arg.startsWith(`${flag}=`));
  if (exact) return exact.slice(flag.length + 1);
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const inputPath = resolve(ROOT, valueAfter("--input", "tools/week-data.json"));
const cacheDir = resolve(ROOT, valueAfter("--cache", "data/pedigree-cache"));
const outputPath = resolve(ROOT, valueAfter("--output", "tools/pad-runtime/blood-pedigree-cache-audit.json"));

if (!existsSync(inputPath)) throw new Error(`Input data does not exist: ${inputPath}`);
const source = JSON.parse(readFileSync(inputPath, "utf8"));
const cacheByName = new Map(
  (existsSync(cacheDir) ? readdirSync(cacheDir) : [])
    .filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(readFileSync(join(cacheDir, name), "utf8").replace(/^\uFEFF/, "")))
    .filter((record) => record.horseName)
    .map((record) => [normalizeHorseKey(record.horseName), record]),
);

const rows = [];
for (const race of source.races ?? []) {
  for (const horse of race.horses ?? []) {
    const horseName = horse.name ?? horse.horseName ?? horse.currentRace?.horseName;
    const cached = cacheByName.get(normalizeHorseKey(horseName));
    const verified = Boolean(cached && pedigreeIdentityMatches(cached, horse.pedigree));
    const enrichedPedigree = verified
      ? mergePedigreeWithReference(cached, horse.pedigree)
      : horse.pedigree;
    const enrichedHorse = { ...horse, pedigree: enrichedPedigree };
    const context = buildRaceContext({ ...race, ...(horse.currentRace ?? {}) });
    const beforeScore = scoreBlood(horse, context);
    const afterScore = scoreBlood(enrichedHorse, context);
    const beforeCompleteness = assessPedigreeCompleteness(horse);
    const afterCompleteness = assessPedigreeCompleteness(enrichedHorse);
    const beforeCrosses = detectPedigreeCrosses(pedigreeFeatureEntries(horse));
    const afterCrosses = detectPedigreeCrosses(pedigreeFeatureEntries(enrichedHorse));
    rows.push({
      raceId: race.id,
      raceName: race.name,
      horseName,
      verifiedCache: verified,
      beforeEntries: beforeCompleteness.entryCount,
      afterEntries: afterCompleteness.entryCount,
      beforeStatus: beforeCompleteness.status,
      afterStatus: afterCompleteness.status,
      beforeCrosses: beforeCrosses.map((cross) => `${cross.ancestor} ${cross.pattern}`),
      afterCrosses: afterCrosses.map((cross) => `${cross.ancestor} ${cross.pattern}`),
      beforeScore,
      afterScore,
      scoreDelta: Number((afterScore - beforeScore).toFixed(6)),
    });
  }
}

const byRace = [...new Set(rows.map((row) => row.raceId))].map((raceId) => {
  const raceRows = rows.filter((row) => row.raceId === raceId);
  return {
    raceId,
    raceName: raceRows[0]?.raceName ?? null,
    horses: raceRows.length,
    verifiedCache: raceRows.filter((row) => row.verifiedCache).length,
    completeAfter: raceRows.filter((row) => row.afterStatus === "complete").length,
    crossDetectedAfter: raceRows.filter((row) => row.afterCrosses.length).length,
  };
});

const changedRows = rows.filter((row) => row.scoreDelta !== 0);
const report = {
  input: inputPath,
  cacheDir,
  totalHorses: rows.length,
  cacheRecords: cacheByName.size,
  verifiedCache: rows.filter((row) => row.verifiedCache).length,
  completeBefore: rows.filter((row) => row.beforeStatus === "complete").length,
  completeAfter: rows.filter((row) => row.afterStatus === "complete").length,
  crossDetectedBefore: rows.filter((row) => row.beforeCrosses.length).length,
  crossDetectedAfter: rows.filter((row) => row.afterCrosses.length).length,
  scoreChanged: changedRows.length,
  maxAbsoluteScoreDelta: changedRows.length
    ? Math.max(...changedRows.map((row) => Math.abs(row.scoreDelta)))
    : 0,
  unresolved: rows.filter((row) => !row.verifiedCache).map((row) => row.horseName),
  byRace,
  rows,
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ ...report, rows: undefined }, null, 2));
