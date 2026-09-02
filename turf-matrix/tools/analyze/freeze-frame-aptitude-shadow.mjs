#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRaceFrameAptitudePrediction } from "./lib/frame-aptitude-shadow.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ARCHIVE_DIR = join(ROOT, "data", "archive");
const SHADOW_DIR = join(ROOT, "data", "shadow", "frame-aptitude-v2");
const DEFAULT_INPUT = join(ROOT, "tools", "week-data.batch-candidate.json");
const MODEL = join(ROOT, "data", "master", "frame-aptitude.json");
const MODEL_VERSION = "frame-aptitude-empirical-v2";
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
  for (const path of [...paths].sort()) {
    hash.update(relative(ROOT, path).replaceAll("\\", "/"));
    hash.update("\0");
    hash.update(readFileSync(path));
    hash.update("\0");
  }
  return hash.digest("hex");
};

if (!existsSync(inputPath)) throw new Error(`Frame shadow input is missing: ${inputPath}`);
const candidate = readJson(inputPath);
const raceDate = candidate.meta?.date ?? String(candidate.races?.[0]?.id ?? "").slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(raceDate ?? "")) throw new Error("Frame shadow race date is missing");
if (existsSync(join(ARCHIVE_DIR, `${raceDate}-results.json`)) && !flag("--reconstruct")) {
  throw new Error(`Results already exist for ${raceDate}; pre-race Frame freeze refused`);
}

const predictions = (candidate.races ?? []).map(buildRaceFrameAptitudePrediction);
if (!predictions.length || predictions.some((race) => race.horseCount < 2)) throw new Error("Frame shadow candidate has an incomplete race");
const model = readJson(MODEL);
if (String(model.period?.to ?? "") >= raceDate && !flag("--reconstruct")) {
  throw new Error(`Frame model period must end before the target race: ${model.period?.to} / ${raceDate}`);
}
const modelSpecSha256 = hashFiles([
  join(ROOT, "tools", "learn", "frame-aptitude-learning.mjs"),
  join(ROOT, "tools", "intelligence", "frame-ai.mjs"),
  join(ROOT, "tools", "analyze", "lib", "frame-aptitude-shadow.mjs"),
  MODEL,
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
    purpose: "相対枠位置とコース・馬場・距離・頭数の実績を時系列検証後に用いる事前影評価",
    currentRaceResultRead: false,
    popularityOddsValueUsed: false,
    raceRunningPositionUsed: false,
    frameScoreOnly: true,
    tmIndexConnected: false,
  },
  source: {
    input: relative(ROOT, inputPath).replaceAll("\\", "/"),
    inputSha256: sha256(readFileSync(inputPath)),
    modelSpecSha256,
    modelPeriod: model.period,
    historicalRaceCount: model.summary?.raceCount ?? 0,
  },
  summary: {
    raceCount: predictions.length,
    horseCount: predictions.reduce((sum, race) => sum + race.horseCount, 0),
    adjustedHorseCount: predictions.reduce((sum, race) => sum + race.adjustedHorseCount, 0),
    empiricalMatchCount: predictions.reduce((sum, race) => sum + race.empiricalMatchCount, 0),
    leaderChangedRaceCount: predictions.filter((race) => race.leaderChanged).length,
  },
  predictionSha256,
  predictions,
};

mkdirSync(SHADOW_DIR, { recursive: true });
const output = join(SHADOW_DIR, `${raceDate}-pre-race.json`);
if (!dryRun && existsSync(output)) {
  const previous = readJson(output);
  if (previous.predictionSha256 !== predictionSha256) throw new Error(`Frozen Frame shadow differs: ${output}`);
} else if (!dryRun) writeFileSync(output, stableJson(artifact));

const reportPath = join(ROOT, "docs", "analysis", `frame-aptitude-shadow-${raceDate}.md`);
const rows = predictions.map((race) => `| ${race.track}${race.raceNumber}R | ${race.raceName} | ${race.currentLeader?.name ?? "-"} | ${race.shadowLeader?.name ?? "-"} | ${race.empiricalMatchCount}/${race.horseCount} |`).join("\n");
const report = `# Frame Aptitude 事前影評価 (${raceDate})

- 本番Frame・TM INDEXへの接続: **なし**
- 対象: ${artifact.summary.raceCount}レース / ${artifact.summary.horseCount}頭
- 統計条件合致: ${artifact.summary.empiricalMatchCount}頭
- Frame首位変更: ${artifact.summary.leaderChangedRaceCount}レース
- 人気・オッズ・Value・今回結果・当該レース通過順: 使用しない
- 学習期間: ${model.period?.from}〜${model.period?.to}（${model.summary?.raceCount}レース）
- 予測SHA256: \`${predictionSha256}\`

| レース | レース名 | 現Frame首位 | 影Frame首位 | 条件合致 |
|---|---|---|---|---:|
${rows}

結果取得後はこの固定artifactだけを評価し、採用条件を満たすまで本番へ接続しない。
`;
if (!dryRun) writeFileSync(reportPath, report, "utf8");
console.log(JSON.stringify({ output, reportPath, dryRun, raceDate, predictionSha256, ...artifact.summary }, null, 2));
