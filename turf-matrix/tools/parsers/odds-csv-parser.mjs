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

export const inspect = () =>
  inspectTextInput({
    parserId,
    source,
    extractionTargets,
    required: true,
    minBytes: 1024,
    minRows: 17,
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

const normalizeEntry = (row, headerMap) => ({
  popularity: toNumber(cell(row, headerMap, "人気")),
  frameNumber: toNumber(cell(row, headerMap, "枠")),
  horseNumber: toNumber(cell(row, headerMap, "馬番")),
  horseName: cell(row, headerMap, "馬名") || null,
  jockey: cell(row, headerMap, "騎手") || null,
  zi: toNumber(cell(row, headerMap, "ZI")),
  winOdds: toNumber(cell(row, headerMap, "単勝")),
});

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

const validateEntries = (entries) => {
  const errors = [];
  if (entries.length !== 16) errors.push(`odds.csv entries must be 16 but got ${entries.length}`);

  entries.forEach((entry, index) => {
    for (const key of ["popularity", "horseNumber", "horseName", "winOdds"]) {
      if (entry[key] == null || entry[key] === "") errors.push(`row ${index + 1}: ${key} is missing`);
    }
    if (entry.winOdds != null && entry.winOdds <= 0) errors.push(`row ${index + 1}: winOdds must be positive`);
  });

  for (const key of ["popularity", "horseNumber", "horseName"]) {
    const dupes = duplicates(entries, key);
    if (dupes.length) errors.push(`${key} has duplicates: ${dupes.join(", ")}`);
  }

  const horseNumbers = entries.map((entry) => entry.horseNumber).sort((a, b) => a - b);
  const popularities = entries.map((entry) => entry.popularity).sort((a, b) => a - b);
  const expected = Array.from({ length: 16 }, (_, index) => index + 1);
  if (horseNumbers.some((value, index) => value !== expected[index])) {
    errors.push(`horseNumber must be 1-16: ${horseNumbers.join(", ")}`);
  }
  if (popularities.some((value, index) => value !== expected[index])) {
    errors.push(`popularity must be 1-16: ${popularities.join(", ")}`);
  }

  return errors;
};

export const parse = () => {
  const path = resolveFromRepo(source.path);
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
  const errors = validateEntries(entries);
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
    status: "active",
    entries,
  };
};
