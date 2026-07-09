import { inspectTextInput } from "./parser-contract.mjs";

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

