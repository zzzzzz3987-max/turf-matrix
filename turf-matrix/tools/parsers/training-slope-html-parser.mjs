import { inspectTextInput, parseTargetHtmlRows, readTextSmart, resolveFromRepo, toNumber } from "./parser-contract.mjs";

export const parserId = "target-training-slope-html";

export const source = Object.freeze({
  type: "html",
  fileName: "training-slope.html",
  path: "tools/target-html/input/training-slope.html",
  requiredForProduction: false,
  sourceSystem: "TARGET frontier JV",
});

export const extractionTargets = Object.freeze([
  "horse.name",
  "training.date",
  "training.course",
  "training.slopeTime",
  "training.lap",
  "training.trainer",
  "training.evaluation",
]);

export const inspect = ({ path = source.path } = {}) =>
  inspectTextInput({
    parserId,
    source: { ...source, path },
    extractionTargets,
    required: false,
    minBytes: 512,
    minRows: 2,
  });

export const parse = ({ path: sourcePath = source.path } = {}) => {
  const path = resolveFromRepo(sourcePath);
  const { text, encoding } = readTextSmart(path);
  const rows = parseTargetHtmlRows(text).filter((row) => row[0] !== "場所");

  return {
    parserId,
    encoding,
    rowCount: rows.length,
    records: rows.map((row) => ({
      horseName: row[4] || null,
      date: row[1] || null,
      trainer: row[9] || null,
      "4F": toNumber(row[10]),
      "3F": toNumber(row[11]),
      "2F": toNumber(row[12]),
      "1F": toNumber(row[13]),
      lap: {
        lap4: toNumber(row[14]),
        lap3: toNumber(row[15]),
        lap2: toNumber(row[16]),
        lap1: toNumber(row[17]),
      },
    })),
  };
};

