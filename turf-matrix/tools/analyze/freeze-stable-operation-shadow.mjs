#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRaceStableOperationPrediction } from "./lib/stable-operation-shadow.mjs";

const ANALYZE_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(ANALYZE_DIR, "..", "..");
const ARCHIVE_DIR = join(ROOT, "data", "archive");
const SHADOW_DIR = join(ROOT, "data", "shadow", "stable-operation-v2");
const DEFAULT_INPUT = join(ROOT, "tools", "week-data.batch-candidate.json");
const MODEL_VERSION = "stable-operation-empirical-v2";
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

if (!existsSync(inputPath)) throw new Error(`Stable shadow input is missing: ${inputPath}`);
const candidate = readJson(inputPath);
const raceDate = candidate.meta?.date ?? candidate.races?.[0]?.horses?.[0]?.currentRace?.raceDate;
if (!/^\d{4}-\d{2}-\d{2}$/.test(raceDate ?? "")) throw new Error("Stable shadow race date is missing");
if (existsSync(join(ARCHIVE_DIR, `${raceDate}-results.json`)) && !flag("--reconstruct")) {
  throw new Error(`Results already exist for ${raceDate}; pre-race Stable freeze refused`);
}

const predictions = (candidate.races ?? []).map(buildRaceStableOperationPrediction);
if (!predictions.length || predictions.some((race) => race.horseCount < 2)) {
  throw new Error("Stable shadow candidate has an incomplete race");
}
const modelSpecSha256 = hashFiles([
  join(ROOT, "tools", "intelligence", "stable-operation-features.mjs"),
  join(ROOT, "tools", "intelligence", "stable-operation-shadow.mjs"),
  join(ROOT, "tools", "learn", "stable-operation-learning.mjs"),
  join(ROOT, "tools", "analyze", "lib", "stable-operation-shadow.mjs"),
  join(ROOT, "data", "master", "stable-operations.json"),
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
    purpose: "厩舎別のローテ・騎手継続・遠征実績を時系列検証後に用いる事前影評価",
    currentRaceResultRead: false,
    popularityOddsValueUsed: false,
    trainingPatternScoredInStable: false,
    genericOperationAssumptionsScored: false,
    stableScoreOnly: true,
    tmIndexConnected: false,
    maxStableAdjustment: 3,
  },
  source: {
    input: relative(ROOT, inputPath).replaceAll("\\", "/"),
    inputSha256: sha256(readFileSync(inputPath)),
    modelSpecSha256,
    modelPeriod: readJson(join(ROOT, "data", "master", "stable-operations.json")).period,
    raceCount: predictions.length,
    horseCount: predictions.reduce((sum, race) => sum + race.horseCount, 0),
  },
  summary: {
    raceCount: predictions.length,
    horseCount: predictions.reduce((sum, race) => sum + race.horseCount, 0),
    adjustedHorseCount: predictions.reduce((sum, race) => sum + race.adjustedHorseCount, 0),
    empiricalMatchCount: predictions.reduce((sum, race) => sum + race.empiricalMatchCount, 0),
    leaderChangedRaceCount: predictions.filter((race) => race.leaderChanged).length,
    maxAbsAdjustment: Math.max(0, ...predictions.flatMap((race) => race.horses.map((horse) => Math.abs(horse.stableAdjustment)))),
  },
  predictionSha256,
  predictions,
};

mkdirSync(SHADOW_DIR, { recursive: true });
const output = join(SHADOW_DIR, `${raceDate}-pre-race.json`);
if (!dryRun && existsSync(output)) {
  const previous = readJson(output);
  if (previous.predictionSha256 !== predictionSha256) throw new Error(`Frozen Stable shadow differs: ${output}`);
} else if (!dryRun) {
  writeFileSync(output, stableJson(artifact));
}

const reportPath = join(ROOT, "docs", "analysis", `stable-operation-shadow-${raceDate}.md`);
const rows = predictions.map((race) => `| ${race.track}${race.raceNumber}R | ${race.raceName} | ${race.currentLeader?.name ?? "-"} | ${race.shadowLeader?.name ?? "-"} | ${race.empiricalMatchCount} |`).join("\n");
const report = `# Stable Operation 事前影評価 (${raceDate})

- 本番Stable・TM INDEXへの接続: **なし**
- 対象: ${artifact.summary.raceCount}レース / ${artifact.summary.horseCount}頭
- Stable補正発火: ${artifact.summary.adjustedHorseCount}頭
- 厩舎固有パターン合致: ${artifact.summary.empiricalMatchCount}頭
- Stable首位変更: ${artifact.summary.leaderChangedRaceCount}レース
- 最大Stable補正: ${artifact.summary.maxAbsAdjustment}点
- 人気・オッズ・Value・今回結果: 使用しない
- 調教好走パターン: Trainingだけで評価し、Stableでは二重加点しない
- 予測SHA256: \`${predictionSha256}\`

| レース | レース名 | 現Stable首位 | 影Stable首位 | 固有パターン合致 |
|---|---|---|---|---:|
${rows}

結果取得後はこの固定artifactだけを評価し、採用条件を満たすまで本番へ接続しない。
`;
if (!dryRun) writeFileSync(reportPath, report, "utf8");
console.log(JSON.stringify({ output, reportPath, dryRun, raceDate, predictionSha256, ...artifact.summary }, null, 2));
