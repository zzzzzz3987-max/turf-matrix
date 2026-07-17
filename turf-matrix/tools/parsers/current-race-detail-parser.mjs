import { inspectTextInput, parseCsvRows, readTextSmart, resolveFromRepo, toNumber } from "./parser-contract.mjs";

export const parserId = "target-current-race-detail-csv";

export const source = Object.freeze({
  type: "csv",
  fileName: "current-race-detail.csv",
  path: "tools/csv/input/current-race-detail.csv",
  requiredForProduction: true,
  sourceSystem: "TARGET frontier JV",
});

export const extractionTargets = Object.freeze([
  "currentRace.raceDate",
  "currentRace.course",
  "currentRace.raceNo",
  "currentRace.raceName",
  "currentRace.grade",
  "currentRace.surface",
  "currentRace.distance",
  "currentRace.time",
  "currentRace.horseNumber",
  "currentRace.horseName",
  "currentRace.sex",
  "currentRace.age",
  "currentRace.jockey",
  "currentRace.carriedWeight",
  "currentRace.trainer",
  "currentRace.stableSide",
  "currentRace.owner",
  "currentRace.breeder",
  "currentRace.sire",
  "currentRace.dam",
  "currentRace.broodmareSire",
  "currentRace.coatColor",
  "currentRace.raceEntryId",
]);

export const inspect = ({ path = source.path } = {}) =>
  inspectTextInput({
    parserId,
    source: { ...source, path },
    extractionTargets,
    required: true,
    minBytes: 1024,
    minRows: 1,
  });

const valueAt = (row, oneBasedIndex) => String(row[oneBasedIndex - 1] ?? "").trim();

const parseTargetDate = (value) => {
  const raw = String(value ?? "").trim();
  const match = raw.match(/^(\d{2})(\d{2})(\d{2})$/);
  if (!match) return null;
  const [, yy, mm, dd] = match;
  return `20${yy}-${mm}-${dd}`;
};

const splitRaceNameAndGrade = (raceNameRaw) => {
  const raw = String(raceNameRaw ?? "").trim();
  const match = raw.match(/(G[123]|GI|GII|GIII)$/);
  if (!match) return { raceName: raw || null, grade: null, raceNameRaw: raw || null };
  return {
    raceName: raw.slice(0, -match[1].length) || null,
    grade: match[1],
    raceNameRaw: raw,
  };
};

const normalizeEntry = (row) => {
  const raceNameParts = splitRaceNameAndGrade(valueAt(row, 5));
  return {
    raceDate: parseTargetDate(valueAt(row, 1)),
    course: valueAt(row, 2) || null,
    raceNo: toNumber(valueAt(row, 3)),
    horseNumber: toNumber(valueAt(row, 4)),
    ...raceNameParts,
    surface: valueAt(row, 6) || null,
    distance: toNumber(valueAt(row, 7)),
    time: valueAt(row, 34) || null,
    horseName: valueAt(row, 8) || null,
    sex: valueAt(row, 9) || null,
    age: toNumber(valueAt(row, 10)),
    jockey: valueAt(row, 11) || null,
    carriedWeight: toNumber(valueAt(row, 12)),
    trainer: valueAt(row, 13) || null,
    stableSide: valueAt(row, 14) || null,
    owner: valueAt(row, 15) || null,
    breeder: valueAt(row, 16) || null,
    sire: valueAt(row, 17) || null,
    dam: valueAt(row, 18) || null,
    horseId: valueAt(row, 19) || null,
    broodmareSire: valueAt(row, 21) || null,
    coatColor: valueAt(row, 22) || null,
    raceEntryId: valueAt(row, 33) || null,
  };
};

const duplicateValues = (entries, key) => {
  const seen = new Set();
  const duplicates = new Set();
  for (const entry of entries) {
    const value = entry[key];
    if (value == null || value === "") continue;
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
};

const distinctValues = (entries, key) => [...new Set(entries.map((entry) => entry[key]))];

export const validateEntries = (entries) => {
  const errors = [];
  if (!entries.length) errors.push("current-race-detail.csv has no entries");

  const requiredKeys = [
    "raceDate",
    "course",
    "raceNo",
    "raceName",
    "surface",
    "distance",
    "horseNumber",
    "horseName",
    "sex",
    "age",
    "jockey",
    "carriedWeight",
    "trainer",
    "stableSide",
    "raceEntryId",
  ];

  entries.forEach((entry, index) => {
    for (const key of requiredKeys) {
      if (entry[key] == null || entry[key] === "") errors.push(`row ${index + 1}: ${key} is missing`);
      if (typeof entry[key] === "number" && Number.isNaN(entry[key])) errors.push(`row ${index + 1}: ${key} is NaN`);
    }
  });

  for (const key of ["raceDate", "course", "raceNo", "raceName", "grade", "surface", "distance"]) {
    const values = distinctValues(entries, key);
    if (values.length !== 1) errors.push(`${key} must be identical across all rows: ${values.join(", ")}`);
  }

  for (const key of ["horseNumber", "horseName", "raceEntryId"]) {
    const duplicates = duplicateValues(entries, key);
    if (duplicates.length) errors.push(`${key} has duplicates: ${duplicates.join(", ")}`);
  }

  const horseNumbers = entries.map((entry) => entry.horseNumber).sort((a, b) => a - b);
  const expected = Array.from({ length: entries.length }, (_, index) => index + 1);
  if (horseNumbers.some((value, index) => value !== expected[index])) {
    errors.push(`horseNumber must be 1-${entries.length}: ${horseNumbers.join(", ")}`);
  }

  return errors;
};

export const parse = ({ path: sourcePath = source.path } = {}) => {
  const path = resolveFromRepo(sourcePath);
  const { text, encoding } = readTextSmart(path);
  const rows = parseCsvRows(text);
  const entries = rows.map(normalizeEntry);
  const errors = validateEntries(entries);

  if (errors.length) {
    const error = new Error(`current-race-detail.csv validation failed:\n${errors.join("\n")}`);
    error.errors = errors;
    throw error;
  }

  const race = {
    raceDate: entries[0].raceDate,
    course: entries[0].course,
    raceNo: entries[0].raceNo,
    raceName: entries[0].raceName,
    raceNameRaw: entries[0].raceNameRaw,
    grade: entries[0].grade,
    surface: entries[0].surface,
    distance: entries[0].distance,
    time: entries[0].time,
    fieldSize: entries.length,
  };

  return {
    parserId,
    encoding,
    rowCount: rows.length,
    entryCount: entries.length,
    race,
    entries,
  };
};
