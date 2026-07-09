import { inspectTextInput } from "./parser-contract.mjs";

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

export const inspect = () =>
  inspectTextInput({
    parserId,
    source,
    extractionTargets,
    required: false,
    minBytes: 512,
    minRows: 2,
  });

