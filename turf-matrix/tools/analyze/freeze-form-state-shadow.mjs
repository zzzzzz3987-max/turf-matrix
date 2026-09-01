#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRaceFormStatePrediction } from "./lib/form-state-shadow.mjs";

const ANALYZE_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(ANALYZE_DIR, "..", "..");
const ARCHIVE_DIR = join(ROOT, "data", "archive");
const SHADOW_DIR = join(ROOT, "data", "shadow", "form-state-v1");
const DEFAULT_INPUT = join(ROOT, "tools", "week-data.batch-candidate.json");
const MODEL_VERSION = "form-recent-quality-shadow-v1";
const args = process.argv.slice(2);
const valueAfter = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const flag = (name) => args.includes(name);
const inputPath = valueAfter("--input", DEFAULT_INPUT);
const dryRun = flag("--dry-run");

const readJson = (path) => JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
const stableJson = (value) => `${JSON.stringify(value, null, 2)}\n`;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const hashFiles = (paths) => {
  const hash = createHash("sha256");
  for (const path of paths.sort()) {
    hash.update(relative(ROOT, path).replaceAll("\\", "/"));
    hash.update("\0");
    hash.update(readFileSync(path));
    hash.update("\0");
  }
  return hash.digest("hex");
};

if (!existsSync(inputPath)) throw new Error(`Form shadow input is missing: ${inputPath}`);
const candidate = readJson(inputPath);
const raceDate = candidate.meta?.date ?? candidate.races?.[0]?.horses?.[0]?.currentRace?.raceDate;
if (!/^\d{4}-\d{2}-\d{2}$/.test(raceDate ?? "")) throw new Error("Form shadow race date is missing");
if (existsSync(join(ARCHIVE_DIR, `${raceDate}-results.json`)) && !flag("--reconstruct")) {
  throw new Error(`Results already exist for ${raceDate}; pre-race Form freeze refused`);
}

const predictions = (candidate.races ?? []).map(buildRaceFormStatePrediction);
if (!predictions.length || predictions.some((race) => race.horseCount < 2)) {
  throw new Error("Form shadow candidate has an incomplete race");
}
const modelSpecSha256 = hashFiles([
  join(ROOT, "tools", "intelligence", "form-state-shadow.mjs"),
  join(ROOT, "tools", "analyze", "lib", "form-state-shadow.mjs"),
]);
const predictionPayload = { modelVersion: MODEL_VERSION, modelSpecSha256, raceDate, predictions };
const predictionSha256 = sha256(stableJson(predictionPayload));
const artifact = {
  schemaVersion: 1,
  status: flag("--reconstruct") ? "reconstructed-pre-race-shadow" : "frozen-pre-race-shadow",
  modelVersion: MODEL_VERSION,
  frozenAt: new Date().toISOString(),
  raceDate,
  productionConnected: false,
  policy: {
    purpose: "Form直近内容・状態推移の事前影評価",
    currentRaceResultRead: false,
    popularityOddsValueUsed: false,
    candidateTargetDistanceSurfaceCourseUsed: false,
    rawLast3FUsed: false,
    candidateAbilityZiOpponentEvidenceUsed: false,
    carriedWeightUsed: false,
    momentumUsedAsPerformanceScore: false,
    passingProgressUsedAsPerformanceScore: false,
    maxFormAdjustment: 3,
  },
  source: {
    input: relative(ROOT, inputPath).replaceAll("\\", "/"),
    inputSha256: sha256(readFileSync(inputPath)),
    modelSpecSha256,
    raceCount: predictions.length,
    horseCount: predictions.reduce((sum, race) => sum + race.horseCount, 0),
  },
  summary: {
    raceCount: predictions.length,
    horseCount: predictions.reduce((sum, race) => sum + race.horseCount, 0),
    adjustedHorseCount: predictions.reduce((sum, race) => sum + race.horses.filter((horse) => horse.formAdjustment !== 0).length, 0),
    formLeaderChangedRaceCount: predictions.filter((race) => race.formLeaderChanged).length,
    tmLeaderChangedRaceCount: predictions.filter((race) => race.tmLeaderChanged).length,
    maxAbsAdjustment: Math.max(0, ...predictions.flatMap((race) => race.horses.map((horse) => Math.abs(horse.formAdjustment)))),
  },
  predictionSha256,
  predictions,
};

mkdirSync(SHADOW_DIR, { recursive: true });
const output = join(SHADOW_DIR, `${raceDate}-pre-race.json`);
if (dryRun) {
  // Validation-only mode intentionally leaves no pre-race artifact behind.
} else if (existsSync(output)) {
  const previous = readJson(output);
  if (previous.predictionSha256 !== predictionSha256) throw new Error(`Frozen Form shadow differs: ${output}`);
} else {
  writeFileSync(output, stableJson(artifact));
}

const reportPath = join(ROOT, "docs", "analysis", `form-state-shadow-${raceDate}.md`);
const rows = predictions.map((race) => `| ${race.track}${race.raceNumber}R | ${race.raceName} | ${race.currentFormLeader?.name ?? "-"} | ${race.shadowFormLeader?.name ?? "-"} | ${race.currentTmLeader?.name ?? "-"} | ${race.shadowTmLeader?.name ?? "-"} |`).join("\n");
const report = `# Form State 事前影評価 (${raceDate})

- 本番Form・TM INDEXへの接続: **なし**
- 対象: ${artifact.summary.raceCount}レース / ${artifact.summary.horseCount}頭
- Form補正発火: ${artifact.summary.adjustedHorseCount}頭
- Form首位変更: ${artifact.summary.formLeaderChangedRaceCount}レース
- TM首位変更: ${artifact.summary.tmLeaderChangedRaceCount}レース
- 最大Form補正: ${artifact.summary.maxAbsAdjustment}点
- 人気・オッズ・Value・今回結果・生上がり3F: 使用しない
- 予測SHA256: \`${predictionSha256}\`

| レース | レース名 | 現Form首位 | 影Form首位 | 現TM首位 | 影TM首位 |
|---|---|---|---|---|---|
${rows}

結果取得後はこの固定artifactだけを評価し、係数や閾値を結果に合わせて変更しない。
`;
if (!dryRun) writeFileSync(reportPath, report, "utf8");
console.log(JSON.stringify({ output, reportPath, dryRun, raceDate, predictionSha256, ...artifact.summary }, null, 2));
