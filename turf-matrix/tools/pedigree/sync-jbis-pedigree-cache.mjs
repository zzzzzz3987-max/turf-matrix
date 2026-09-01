import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { buildPedigreeRecord, parsePedigreeHtml } from "../parsers/pedigree-html-parser.mjs";
import { pedigreeIdentityMatches } from "../normalizers/race-bundle.mjs";
import { extractJbisHorseCandidates, normalizeHorseName } from "./jbis-pedigree-resolver.mjs";

const ROOT = resolve(import.meta.dirname, "..", "..");
const args = process.argv.slice(2);
const valueAfter = (flag, fallback) => {
  const exact = args.find((arg) => arg.startsWith(`${flag}=`));
  if (exact) return exact.slice(flag.length + 1);
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const inputPath = resolve(ROOT, valueAfter("--input", "tools/week-data.json"));
const manifestPath = resolve(ROOT, valueAfter("--manifest", "tools/pedigree/jbis-pedigree-manifest.json"));
const cacheDir = resolve(ROOT, valueAfter("--cache", "data/pedigree-cache"));
const reportPath = resolve(ROOT, valueAfter("--report", "tools/pad-runtime/jbis-pedigree-sync-report.json"));
const selectedHorse = valueAfter("--horse", null);
const maxHorses = Number(valueAfter("--max", "0"));
const delayMs = Math.max(1000, Number(valueAfter("--delay-ms", "1500")) || 1500);
const confirm = args.includes("--confirm");
const verbose = args.includes("--verbose");
const BASE_URL = "https://www.jbis.or.jp";
const headers = {
  "User-Agent": "TURF-MATRIX pedigree cache builder (+https://turf-matrix.vercel.app/)",
  Accept: "text/html,application/xhtml+xml",
};

if (!existsSync(inputPath)) throw new Error(`Input data does not exist: ${inputPath}`);
const source = JSON.parse(readFileSync(inputPath, "utf8"));
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : [];
const manifestByJraId = new Map(manifest.map((entry) => [String(entry.jraHorseId), entry]));
const manifestByName = new Map(manifest.map((entry) => [normalizeHorseName(entry.horseName), entry]));
const cacheRecordsByName = new Map(
  (existsSync(cacheDir) ? readdirSync(cacheDir) : [])
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      const record = JSON.parse(readFileSync(join(cacheDir, name), "utf8").replace(/^\uFEFF/, ""));
      return [normalizeHorseName(record.horseName), record];
    }),
);

const horsesById = new Map();
for (const race of source.races ?? []) {
  for (const horse of race.horses ?? []) {
    const horseName = horse.name ?? horse.horseName ?? horse.currentRace?.horseName;
    const jraHorseId = String(
      horse.pedigree?.bloodRegistrationNumber
      ?? horse.currentRace?.horseId
      ?? horse.horseId
      ?? "",
    ).trim();
    if (!horseName || !/^\d{10}$/.test(jraHorseId)) continue;
    if (!horsesById.has(jraHorseId)) {
      horsesById.set(jraHorseId, { horseName, jraHorseId, pedigree: horse.pedigree ?? {} });
    }
  }
}

let selected = [...horsesById.values()].filter((horse) =>
  !selectedHorse || normalizeHorseName(horse.horseName) === normalizeHorseName(selectedHorse)
);
if (maxHorses > 0) selected = selected.slice(0, maxHorses);
if (!selected.length) throw new Error(`No horses matched input=${inputPath} horse=${selectedHorse ?? "all"}`);

let lastRequestAt = 0;
const fetchHtml = async (url) => {
  const wait = Math.max(0, delayMs - (Date.now() - lastRequestAt));
  if (wait) await new Promise((resolveDelay) => setTimeout(resolveDelay, wait));
  const response = await fetch(url, { headers });
  lastRequestAt = Date.now();
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status} for ${url}`);
    error.status = response.status;
    throw error;
  }
  return response.text();
};

const results = [];
const resolvedEntries = [];
let accessBlocked = null;
mkdirSync(cacheDir, { recursive: true });

for (const horse of selected) {
  const resultIdentity = { horseName: horse.horseName, jraHorseId: horse.jraHorseId };
  if (accessBlocked) {
    results.push({
      ...resultIdentity,
      status: "deferred",
      reason: `access_blocked_after_${accessBlocked.horseName}`,
    });
    continue;
  }
  const normalizedName = normalizeHorseName(horse.horseName);
  const existingByName = manifestByName.get(normalizedName);
  const existing = manifestByJraId.get(horse.jraHorseId)
    ?? (String(existingByName?.jraHorseId) === horse.jraHorseId ? existingByName : null);
  const cachedRecord = cacheRecordsByName.get(normalizedName);
  if (cachedRecord && pedigreeIdentityMatches(cachedRecord, horse.pedigree)) {
    const cachedJbisHorseId = existing?.jbisHorseId ?? cachedRecord.source?.jbisHorseId ?? null;
    if (!existing && cachedJbisHorseId) {
      resolvedEntries.push({
        horseName: horse.horseName,
        jraHorseId: horse.jraHorseId,
        jbisHorseId: String(cachedJbisHorseId),
      });
    }
    results.push({ ...resultIdentity, status: "cached", jbisHorseId: cachedJbisHorseId });
    continue;
  }

  try {
    let candidateIds = existing?.jbisHorseId ? [String(existing.jbisHorseId)] : [];
    if (!candidateIds.length) {
      const searchUrl = `${BASE_URL}/horse/result/?sid=horse&keyword=${encodeURIComponent(horse.horseName)}&match=exact`;
      const searchHtml = await fetchHtml(searchUrl);
      candidateIds = extractJbisHorseCandidates(searchHtml, horse.horseName)
        .map((candidate) => candidate.jbisHorseId);
    }

    const verified = [];
    for (const jbisHorseId of candidateIds) {
      const sourceUrl = `${BASE_URL}/horse/${jbisHorseId}/pedigree/`;
      const html = await fetchHtml(sourceUrl);
      const parsed = parsePedigreeHtml(html);
      if (parsed.format !== "jbis-five-generation" || parsed.ancestors.length !== 62) continue;
      const record = buildPedigreeRecord({
        horseName: horse.horseName,
        parsed,
        sourceMeta: {
          sourceUrl,
          jraHorseId: horse.jraHorseId,
          jbisHorseId,
          resolvedBy: "exact-name-and-pedigree-identity",
        },
      });
      if (pedigreeIdentityMatches(record, horse.pedigree)) verified.push({ jbisHorseId, record });
    }

    if (verified.length !== 1) {
      results.push({
        ...resultIdentity,
        status: verified.length ? "ambiguous" : "unresolved",
        candidateCount: candidateIds.length,
        verifiedCount: verified.length,
      });
      continue;
    }

    const resolved = verified[0];
    const entry = {
      horseName: horse.horseName,
      jraHorseId: horse.jraHorseId,
      jbisHorseId: resolved.jbisHorseId,
    };
    resolvedEntries.push(entry);
    if (confirm) {
      writeFileSync(
        join(cacheDir, `${horse.horseName}.json`),
        `${JSON.stringify({ ...resolved.record, cacheVersion: 1 }, null, 2)}\n`,
        "utf8",
      );
      cacheRecordsByName.set(normalizedName, resolved.record);
    }
    results.push({ ...entry, status: confirm ? "cached_new" : "verified_dry_run", ancestorCount: 62 });
  } catch (error) {
    const status = error.status === 403 ? "access_denied" : "error";
    results.push({ ...resultIdentity, status, error: error.message });
    if (status === "access_denied") accessBlocked = resultIdentity;
  }
}

let manifestEntries = manifest.length;
if (confirm && resolvedEntries.length) {
  const merged = new Map(manifest.map((entry) => [String(entry.jraHorseId), entry]));
  for (const entry of resolvedEntries) merged.set(String(entry.jraHorseId), entry);
  const output = [...merged.values()].sort((left, right) =>
    String(left.jraHorseId).localeCompare(String(right.jraHorseId))
  );
  writeFileSync(manifestPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  manifestEntries = output.length;
}

const summary = {
  input: inputPath,
  confirm,
  selected: selected.length,
  cachedExisting: results.filter((result) => result.status === "cached").length,
  resolved: results.filter((result) => ["cached_new", "verified_dry_run"].includes(result.status)).length,
  unresolved: results.filter((result) => result.status === "unresolved").length,
  ambiguous: results.filter((result) => result.status === "ambiguous").length,
  errors: results.filter((result) => result.status === "error").length,
  accessDenied: results.filter((result) => result.status === "access_denied").length,
  deferred: results.filter((result) => result.status === "deferred").length,
  manifestEntries,
};
const report = { ...summary, results };
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  ...summary,
  report: reportPath,
  issues: verbose
    ? results
    : results.filter((result) => !["cached", "cached_new", "verified_dry_run"].includes(result.status)),
}, null, 2));
