import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { scoreBlood } from "../intelligence/blood-ai.mjs";
import { buildRaceContext } from "../intelligence/race-context.mjs";
import {
  normalizeHorseKey,
  pedigreeIdentityMatches,
} from "../normalizers/race-bundle.mjs";
import { buildHnMap, expandAncestorsWithHn } from "./jvlink-hn-pedigree.mjs";

const ROOT = resolve(import.meta.dirname, "..", "..");
const args = process.argv.slice(2);
const valueAfter = (flag, fallback) => {
  const exact = args.find((arg) => arg.startsWith(`${flag}=`));
  if (exact) return exact.slice(flag.length + 1);
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const inputPath = resolve(ROOT, valueAfter("--input", "tools/week-data.json"));
const masterPath = resolve(ROOT, valueAfter("--master", "tools/jvlink/output/breeding-master.json"));
const cacheDir = resolve(ROOT, valueAfter("--cache", "data/pedigree-cache"));
const reportPath = resolve(ROOT, valueAfter("--report", "tools/pad-runtime/jvlink-hn-pedigree-report.json"));
const confirm = args.includes("--confirm");
const verbose = args.includes("--verbose");

if (!existsSync(inputPath)) throw new Error(`Input data does not exist: ${inputPath}`);
if (!existsSync(masterPath)) throw new Error(`HN master does not exist: ${masterPath}`);
const source = JSON.parse(readFileSync(inputPath, "utf8"));
const master = JSON.parse(readFileSync(masterPath, "utf8"));
const hnById = buildHnMap(master.records);
const cacheByName = new Map(
  (existsSync(cacheDir) ? readdirSync(cacheDir) : [])
    .filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(readFileSync(join(cacheDir, name), "utf8").replace(/^\uFEFF/, "")))
    .filter((record) => record.horseName)
    .map((record) => [normalizeHorseKey(record.horseName), record]),
);

mkdirSync(cacheDir, { recursive: true });
const results = [];
for (const race of source.races ?? []) {
  for (const horse of race.horses ?? []) {
    const horseName = horse.name ?? horse.horseName ?? horse.currentRace?.horseName;
    const currentPedigree = horse.pedigree ?? {};
    const ancestors = expandAncestorsWithHn(currentPedigree.ancestors, hnById, 5);
    const existing = cacheByName.get(normalizeHorseKey(horseName));
    const identity = { raceId: race.id, horseName };
    if (existing && !pedigreeIdentityMatches(existing, currentPedigree)) {
      results.push({ ...identity, status: "cache_identity_conflict", ancestorCount: ancestors.length });
      continue;
    }
    if (existing && (existing.ancestors?.length ?? 0) >= ancestors.length) {
      results.push({
        ...identity,
        status: "cached_deeper_or_equal",
        ancestorCount: existing.ancestors?.length ?? 0,
      });
      continue;
    }
    if (ancestors.length <= (currentPedigree.ancestors?.length ?? 0)) {
      results.push({ ...identity, status: "insufficient_hn", ancestorCount: ancestors.length });
      continue;
    }

    const jraHorseId = String(
      currentPedigree.bloodRegistrationNumber
      ?? horse.currentRace?.horseId
      ?? horse.horseId
      ?? "",
    ).trim() || null;
    const record = {
      ...currentPedigree,
      horseName,
      ancestors,
      source: {
        format: ancestors.length >= 62 ? "jvlink-hn-five-generation" : "jvlink-hn-deep-pedigree",
        sourceSystem: "JV-Link",
        sourceRecord: "UM+HN",
        cellCount: ancestors.length,
        jraHorseId,
        resolvedBy: "jvlink-registration-number-tree",
        completeness: ancestors.length >= 62
          ? "five-generation-62"
          : ancestors.length >= 30
            ? "four-generation-30"
            : `partial-${ancestors.length}`,
      },
      cacheVersion: 1,
    };
    if (!pedigreeIdentityMatches(record, currentPedigree)) {
      results.push({ ...identity, status: "generated_identity_mismatch", ancestorCount: ancestors.length });
      continue;
    }

    const context = buildRaceContext({ ...race, ...(horse.currentRace ?? {}) });
    const beforeScore = scoreBlood(horse, context);
    const afterScore = scoreBlood({ ...horse, pedigree: record }, context);
    const scoreDelta = Number((afterScore - beforeScore).toFixed(6));
    if (scoreDelta !== 0) {
      results.push({ ...identity, status: "score_guard_rejected", ancestorCount: ancestors.length, scoreDelta });
      continue;
    }

    if (confirm) {
      writeFileSync(join(cacheDir, `${horseName}.json`), `${JSON.stringify(record, null, 2)}\n`, "utf8");
      cacheByName.set(normalizeHorseKey(horseName), record);
    }
    results.push({
      ...identity,
      status: confirm ? "cached_new" : "verified_dry_run",
      ancestorCount: ancestors.length,
      scoreDelta,
    });
  }
}

const report = {
  input: inputPath,
  master: masterPath,
  masterRecords: master.records?.length ?? 0,
  confirm,
  selected: results.length,
  complete: results.filter((result) => result.ancestorCount >= 30).length,
  cachedNew: results.filter((result) => result.status === "cached_new").length,
  verifiedDryRun: results.filter((result) => result.status === "verified_dry_run").length,
  insufficientHn: results.filter((result) => result.status === "insufficient_hn").length,
  rejected: results.filter((result) => [
    "cache_identity_conflict",
    "generated_identity_mismatch",
    "score_guard_rejected",
  ].includes(result.status)).length,
  results,
};
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(verbose ? report : {
  input: report.input,
  masterRecords: report.masterRecords,
  confirm: report.confirm,
  selected: report.selected,
  complete: report.complete,
  cachedNew: report.cachedNew,
  insufficientHn: report.insufficientHn,
  rejected: report.rejected,
  report: reportPath,
}, null, 2));
