import { parseCsvRows, readTextSmart, resolveFromRepo, toNumber, inspectTextInput } from "./parser-contract.mjs";

export const parserId = "target-all-csv";

export const source = Object.freeze({
  type: "csv",
  fileName: "all.csv",
  path: "tools/csv/input/all.csv",
  requiredForProduction: true,
  sourceSystem: "TARGET frontier JV",
});

export const extractionTargets = Object.freeze([
  "race.date",
  "race.track",
  "race.number",
  "race.name",
  "race.grade",
  "race.startTime",
  "race.surface",
  "race.distance",
  "race.going",
  "horse.number",
  "horse.name",
  "horse.sexAge",
  "horse.jockey",
  "horse.trainer",
  "horse.bodyWeight",
  "horse.weightDiff",
  "horse.runningStyle",
  "horse.zi",
  "horse.recentForm",
  "horse.pedigree.sire",
  "horse.pedigree.dam",
  "horse.pedigree.damSire",
]);

export const inspect = () =>
  inspectTextInput({
    parserId,
    source,
    extractionTargets,
    required: true,
    minBytes: 1024,
    minRows: 2,
  });

const valueAt = (row, oneBasedIndex) => String(row[oneBasedIndex - 1] ?? "").trim();

const normalizeYear = (value) => {
  const number = toNumber(value);
  if (number == null) return null;
  return number < 100 ? 2000 + number : number;
};

const parseRaceDate = (row) => {
  const year = normalizeYear(valueAt(row, 1));
  const month = toNumber(valueAt(row, 2));
  const day = toNumber(valueAt(row, 3));
  if (year == null || month == null || day == null) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};

const extractRow = (row) => ({
  raceDate: parseRaceDate(row),
  course: valueAt(row, 5) || null,
  raceNo: toNumber(valueAt(row, 7)),
  raceName: valueAt(row, 8) || null,
  surface: valueAt(row, 10) || null,
  distance: toNumber(valueAt(row, 12)),
  trackCondition: valueAt(row, 13) || null,
  horseName: valueAt(row, 14) || null,
  sexAge: `${valueAt(row, 15)}${valueAt(row, 16)}` || null,
  jockey: valueAt(row, 17) || null,
  weight: toNumber(valueAt(row, 18)),
  trainer: valueAt(row, 35) || null,
  owner: valueAt(row, 42) || null,
  breeder: valueAt(row, 43) || null,
  bodyWeight: toNumber(valueAt(row, 34)),
  runningStyle: valueAt(row, 54) || null,
  availableIndex: {
    primary: toNumber(valueAt(row, 52)),
    rawCandidates: {
      column52: valueAt(row, 52) || null,
      column58: valueAt(row, 58) || null,
      column59: valueAt(row, 59) || null,
    },
  },
  pedigree: {
    sire: valueAt(row, 44) || null,
    dam: valueAt(row, 45) || null,
    broodmareSire: valueAt(row, 46) || null,
    sireLine: valueAt(row, 55) || null,
    damLine: valueAt(row, 56) || null,
  },
  recentRun: {
    fieldSize: toNumber(valueAt(row, 19)),
    popularity: toNumber(valueAt(row, 20)),
    finish: toNumber(valueAt(row, 21)),
    confirmedFinish: toNumber(valueAt(row, 22)),
    surfaceCode: valueAt(row, 23) || null,
    margin: toNumber(valueAt(row, 24)),
    horseNoCandidate: toNumber(valueAt(row, 25)),
    timeSeconds: toNumber(valueAt(row, 26)),
    timeText: valueAt(row, 27) || null,
    corners: [29, 30, 31, 32].map((column) => toNumber(valueAt(row, column))),
    last3F: toNumber(valueAt(row, 33)),
  },
  rawColumns: {
    firstColumnCount: row.length,
  },
});

export const parse = () => {
  const path = resolveFromRepo(source.path);
  const { text, encoding } = readTextSmart(path);
  const rows = parseCsvRows(text);
  const byHorse = new Map();

  for (const row of rows) {
    const record = extractRow(row);
    if (!record.horseName) continue;
    if (!byHorse.has(record.horseName)) {
      byHorse.set(record.horseName, {
        horseName: record.horseName,
        all: {
          raceDate: record.raceDate,
          course: record.course,
          raceNo: record.raceNo,
          raceName: record.raceName,
          surface: record.surface,
          distance: record.distance,
          trackCondition: record.trackCondition,
          horseName: record.horseName,
          sexAge: record.sexAge,
          jockey: record.jockey,
          weight: record.weight,
          trainer: record.trainer,
          owner: record.owner,
          breeder: record.breeder,
          bodyWeight: record.bodyWeight,
          runningStyle: record.runningStyle,
          availableIndex: record.availableIndex,
          pedigree: record.pedigree,
          recentRuns: [],
        },
      });
    }
    byHorse.get(record.horseName).all.recentRuns.push(record.recentRun);
  }

  return {
    parserId,
    encoding,
    rowCount: rows.length,
    horseCount: byHorse.size,
    horses: [...byHorse.values()],
  };
};

