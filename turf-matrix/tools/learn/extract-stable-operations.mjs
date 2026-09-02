#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  DEFAULT_OPERATION_LEARNING_OPTIONS,
  learnStableOperationPatterns,
} from "./stable-operation-learning.mjs";

const args = process.argv.slice(2);
const valueAfter = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const inputPath = resolve(valueAfter("--input", "tools/jvlink/output/stable-history-observations.json"));
const outputPath = resolve(valueAfter("--output", "tools/jvlink/output/stable-operations.learned.json"));
if (!existsSync(inputPath)) throw new Error(`Stable operation observations are missing: ${inputPath}`);

const source = JSON.parse(readFileSync(inputPath, "utf8").replace(/^\uFEFF/, ""));
const observations = source.operationObservations ?? [];
const learned = learnStableOperationPatterns(observations);
const payload = {
  schemaVersion: 1,
  status: "learned-shadow-candidate",
  productionConnected: false,
  source: "JV-Link race results with strictly previous runner history",
  sourceObservationCount: observations.length,
  sourceSchemaVersion: source.schemaVersion ?? null,
  globalBaselineHitRate: learned.globalBaseline,
  learningPolicy: {
    features: ["rotationBucket", "jockeyContinuity", "travelClass"],
    target: "top3 finish",
    hierarchy: "global baseline -> trainer comparable baseline -> trainer operation pattern",
    split: "chronological holdout",
    futureRaceRead: false,
    currentRaceOddsPopularityRead: false,
    currentRaceResultRead: false,
    ...DEFAULT_OPERATION_LEARNING_OPTIONS,
  },
  acceptedStableCount: learned.stables.length,
  eligibleStableCount: learned.candidates.length,
  uniqueStableCount: learned.diagnostics.length,
  stables: learned.stables,
  candidates: learned.candidates,
  diagnostics: learned.diagnostics,
};
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  output: outputPath,
  sourceObservationCount: observations.length,
  globalBaselineHitRate: learned.globalBaseline,
  uniqueStableCount: learned.diagnostics.length,
  eligibleStableCount: learned.candidates.length,
  acceptedStableCount: learned.stables.length,
  positivePatternCount: learned.stables.filter((stable) => stable.positivePattern?.accepted).length,
  riskPatternCount: learned.stables.filter((stable) => stable.riskPattern?.accepted).length,
}, null, 2));
