import { inspectTextInput, parseTargetHtmlRows, readTextSmart, resolveFromRepo, toNumber } from "./parser-contract.mjs";

export const parserId = "target-training-wood-html";

export const source = Object.freeze({
  type: "html",
  fileName: "training-wood.html",
  path: "tools/target-html/input/training-wood.html",
  requiredForProduction: false,
  sourceSystem: "TARGET frontier JV",
});

export const extractionTargets = Object.freeze([
  "horse.name",
  "training.date",
  "training.course",
  "training.turn",
  "training.time10FTo1F",
  "training.lap",
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
      horseName: row[6] || null,
      date: row[3] || null,
      trainer: row[11] || null,
      course: row[1] || null,
      direction: row[2] || null,
      times: {
        "10F": toNumber(row[12]),
        "9F": toNumber(row[13]),
        "8F": toNumber(row[14]),
        "7F": toNumber(row[15]),
        "6F": toNumber(row[16]),
        "5F": toNumber(row[17]),
        "4F": toNumber(row[18]),
        "3F": toNumber(row[19]),
        "2F": toNumber(row[20]),
        "1F": toNumber(row[21]),
      },
      lap: {
        lap6: toNumber(row[22]),
        lap5: toNumber(row[23]),
        lap4: toNumber(row[24]),
        lap3: toNumber(row[25]),
        lap2: toNumber(row[26]),
        lap1: toNumber(row[27]),
      },
    })),
  };
};

