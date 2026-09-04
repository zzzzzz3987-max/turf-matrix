import { statSync } from "node:fs";
import { inspectTextInput, readTextSmart, resolveFromRepo, toNumber, cleanCell } from "./parser-contract.mjs";

export const parserId = "target-odds-csv";

export const source = Object.freeze({
  type: "csv",
  fileName: "odds.csv",
  path: "tools/csv/input/odds.csv",
  requiredForProduction: true,
  sourceSystem: "TARGET frontier JV",
});

export const extractionTargets = Object.freeze([
  "odds.popularity",
  "odds.frameNumber",
  "odds.horseNumber",
  "odds.horseName",
  "odds.jockey",
  "odds.zi",
  "odds.winOdds",
]);

export const inspect = ({ path = source.path, minRows = 2 } = {}) =>
  inspectTextInput({
    parserId,
    source: { ...source, path },
    extractionTargets,
    required: true,
    minBytes: 1024,
    minRows,
  });

const splitRows = (text) => {
  const lines = text.split(/\r\n|\n|\r/).filter((line) => line.trim().length > 0);
  if (!lines.length) return [];
  const delimiter = lines[0].includes("\t") ? "\t" : ",";
  return lines.map((line) => line.split(delimiter).map(cleanCell));
};

const indexByHeader = (header) => {
  const map = new Map();
  header.forEach((name, index) => map.set(name, index));
  return map;
};

const cell = (row, headerMap, name) => row[headerMap.get(name)] ?? "";

const normalizeEntry = (row, headerMap) => {
  const winOdds = toNumber(cell(row, headerMap, "単勝"));
  return {
    popularity: toNumber(cell(row, headerMap, "人気")),
    frameNumber: toNumber(cell(row, headerMap, "枠")),
    horseNumber: toNumber(cell(row, headerMap, "馬番")),
    horseName: cell(row, headerMap, "馬名") || null,
    jockey: cell(row, headerMap, "騎手") || null,
    zi: toNumber(cell(row, headerMap, "ZI")),
    winOdds,
    status: cell(row, headerMap, "状態") || (winOdds == null ? "missing" : "active"),
  };
};

const duplicates = (entries, key) => {
  const seen = new Set();
  const duplicated = new Set();
  for (const entry of entries) {
    const value = entry[key];
    if (value == null || value === "") continue;
    if (seen.has(value)) duplicated.add(value);
    seen.add(value);
  }
  return [...duplicated];
};

const validateEntries = (entries, expectedFieldSize = entries.length) => {
  const errors = [];
  if (!entries.length) errors.push("odds.csv has no entries");
  if (entries.length !== expectedFieldSize) {
    errors.push(`odds.csv entries must be ${expectedFieldSize} but got ${entries.length}`);
  }

  entries.forEach((entry, index) => {
    for (const key of ["popularity", "horseNumber", "horseName"]) {
      if (entry[key] == null || entry[key] === "") errors.push(`row ${index + 1}: ${key} is missing`);
    }
    if (entry.status === "active" && entry.winOdds == null) errors.push(`row ${index + 1}: active winOdds is missing`);
    if (!Number.isFinite(entry.winOdds) && entry.status !== "missing") errors.push(`row ${index + 1}: missing winOdds must have missing status`);
    if (entry.winOdds != null && entry.winOdds <= 0) errors.push(`row ${index + 1}: winOdds must be positive`);
  });

  for (const key of ["horseNumber", "horseName"]) {
    const dupes = duplicates(entries, key);
    if (dupes.length) errors.push(`${key} has duplicates: ${dupes.join(", ")}`);
  }

  for (const popularity of duplicates(entries, "popularity")) {
    const tiedEntries = entries.filter((entry) => entry.popularity === popularity && Number.isFinite(entry.winOdds));
    if (tiedEntries.length <= 1) continue;
    if (new Set(tiedEntries.map((entry) => entry.winOdds)).size !== 1) {
      errors.push(`popularity ${popularity} is duplicated across different odds`);
    }
  }

  const invalidHorseNumbers = entries
    .map((entry) => entry.horseNumber)
    .filter((value) => !Number.isInteger(value) || value < 1 || value > 18);
  if (invalidHorseNumbers.length) {
    errors.push(`horseNumber must be an integer within 1-18: ${invalidHorseNumbers.join(", ")}`);
  }
  const orderedByOdds = entries
    .filter((entry) => Number.isFinite(entry.winOdds))
    .sort((a, b) => a.winOdds - b.winOdds || a.horseNumber - b.horseNumber);
  let groupStart = 0;
  while (groupStart < orderedByOdds.length) {
    let groupEnd = groupStart;
    while (groupEnd + 1 < orderedByOdds.length && orderedByOdds[groupEnd + 1].winOdds === orderedByOdds[groupStart].winOdds) {
      groupEnd += 1;
    }
    const minimumRank = groupStart + 1;
    const maximumRank = groupEnd + 1;
    for (let index = groupStart; index <= groupEnd; index += 1) {
      const entry = orderedByOdds[index];
      if (entry.popularity < minimumRank || entry.popularity > maximumRank) {
        const expectedRank = minimumRank === maximumRank ? `${minimumRank}` : `${minimumRank}-${maximumRank}`;
        errors.push(`horse ${entry.horseNumber}: popularity ${entry.popularity} does not match odds rank ${expectedRank}`);
      }
    }
    groupStart = groupEnd + 1;
  }
  if (orderedByOdds.some((entry) => entry.popularity < 1 || entry.popularity > expectedFieldSize)) {
    errors.push(`popularity must be within 1-${expectedFieldSize}`);
  }

  return errors;
};

export const parse = ({ path: sourcePath = source.path, expectedFieldSize } = {}) => {
  const path = resolveFromRepo(sourcePath);
  const stats = statSync(path);
  const { text, encoding } = readTextSmart(path);
  const rows = splitRows(text);
  const header = rows[0] ?? [];
  const requiredHeaders = ["人気", "枠", "馬番", "馬名", "騎手", "ZI", "単勝"];
  const missingHeaders = requiredHeaders.filter((name) => !header.includes(name));
  if (missingHeaders.length) {
    throw new Error(`odds.csv headers missing: ${missingHeaders.join(", ")}`);
  }

  const headerMap = indexByHeader(header);
  const entries = rows.slice(1).map((row) => normalizeEntry(row, headerMap));
  const errors = validateEntries(entries, expectedFieldSize ?? entries.length);
  if (errors.length) {
    const error = new Error(`odds.csv validation failed:\n${errors.join("\n")}`);
    error.errors = errors;
    throw error;
  }

  return {
    parserId,
    encoding,
    rowCount: rows.length,
    entryCount: entries.length,
    updatedAt: stats.mtime.toISOString(),
    source: source.fileName,
    status: entries.some((entry) => entry.status === "missing") ? "partial" : "active",
    entries,
  };
};
