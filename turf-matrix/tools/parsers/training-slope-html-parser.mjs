import { inspectTextInput } from "./parser-contract.mjs";

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

export const inspect = () =>
  inspectTextInput({
    parserId,
    source,
    extractionTargets,
    required: false,
    minBytes: 512,
    minRows: 2,
  });

