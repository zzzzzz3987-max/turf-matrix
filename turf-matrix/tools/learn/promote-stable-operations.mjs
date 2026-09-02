#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const args = process.argv.slice(2);
const valueAfter = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const inputPath = resolve(valueAfter("--input", "tools/jvlink/output/stable-operations.learned.json"));
const outputPath = resolve(valueAfter("--output", "data/master/stable-operations.json"));
if (!existsSync(inputPath)) throw new Error(`Stable operation candidate is missing: ${inputPath}`);

const learned = JSON.parse(readFileSync(inputPath, "utf8").replace(/^\uFEFF/, ""));
const stables = (learned.stables ?? []).map((stable) => ({
  name: stable.name,
  trainingCenter: stable.trainingCenter,
  sampleSize: stable.sampleSize,
  placedCount: stable.placedCount,
  hitRate: stable.hitRate,
  period: stable.period,
  confidence: stable.confidence,
  positivePattern: stable.positivePattern?.accepted ? stable.positivePattern : null,
  riskPattern: stable.riskPattern?.accepted ? stable.riskPattern : null,
})).filter((stable) => stable.positivePattern || stable.riskPattern);

const summary = {
  input: inputPath,
  output: outputPath,
  sourceObservationCount: learned.sourceObservationCount ?? 0,
  approvedStableCount: stables.length,
  positivePatternCount: stables.filter((stable) => stable.positivePattern).length,
  riskPatternCount: stables.filter((stable) => stable.riskPattern).length,
};
if (!args.includes("--confirm")) {
  console.log(JSON.stringify({ ...summary, status: "review-only", note: "--confirm指定時のみ影評価モデルへ反映します。" }, null, 2));
  process.exitCode = 1;
} else {
  const dates = stables.flatMap((stable) => [stable.period?.from, stable.period?.to]).filter(Boolean).sort();
  const output = {
    schemaVersion: 1,
    status: "shadow-approved",
    productionConnected: false,
    source: learned.source,
    sourceObservationCount: learned.sourceObservationCount,
    globalBaselineHitRate: learned.globalBaselineHitRate,
    period: { from: dates[0] ?? null, to: dates.at(-1) ?? null },
    learningPolicy: learned.learningPolicy,
    stables,
  };
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ...summary, status: "shadow-approved", period: output.period }, null, 2));
}
