#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRaceShadowPrediction } from "./lib/blood-pairing-cross-shadow.mjs";

const ANALYZE_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(ANALYZE_DIR, "..", "..");
const ARCHIVE_DIR = join(ROOT, "data", "archive");
const SHADOW_DIR = join(ROOT, "data", "shadow", "blood-pairing-cross-v1");
const RUNTIME_DIR = join(ROOT, "tools", "pad-runtime");
const DEFAULT_INPUT = join(ROOT, "tools", "week-data.preodds.json");
const MODEL_VERSION = "blood-pairing-cross-shadow-v1";
const REPORT_DATE = "2026-09-01";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const valueAfter = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
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

const modelFiles = [
  join(ROOT, "tools", "learn", "extract-blood-aptitude.mjs"),
  join(ROOT, "tools", "intelligence", "blood-pairing-statistics.mjs"),
  join(ROOT, "tools", "intelligence", "bloodline-resolver.mjs"),
  join(ROOT, "tools", "intelligence", "dictionaries", "bloodline-dictionary.mjs"),
];
const modelSpecSha256 = hashFiles(modelFiles);

const buildStatistics = (inputPath, date) => {
  mkdirSync(RUNTIME_DIR, { recursive: true });
  const outputPath = join(RUNTIME_DIR, `blood-pairing-cross-${date}.learned.json`);
  const result = spawnSync(process.execPath, [
    "tools/learn/extract-blood-aptitude.mjs",
    "--input", inputPath,
    "--output", outputPath,
    "--archive", ARCHIVE_DIR,
    "--cutoff", date,
    "--for-week", date,
  ], { cwd: ROOT, encoding: "utf8" });
  if (result.status !== 0) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    throw new Error(`Blood statistics build failed for ${date}`);
  }
  const statistics = readJson(outputPath);
  rmSync(outputPath, { force: true });
  return statistics;
};

const historicalInputs = () => readdirSync(ARCHIVE_DIR)
  .filter((name) => /^\d{4}-\d{2}-\d{2}-preodds\.json$/.test(name))
  .sort()
  .map((name) => join(ARCHIVE_DIR, name));

const inputPaths = flag("--all-historical")
  ? historicalInputs()
  : [resolve(valueAfter("--input", DEFAULT_INPUT))];
const requestedDate = valueAfter("--date", null);
const summaries = [];
mkdirSync(SHADOW_DIR, { recursive: true });

for (const inputPath of inputPaths) {
  if (!existsSync(inputPath)) throw new Error(`Pre-race input is missing: ${inputPath}`);
  const source = readJson(inputPath);
  const date = source.meta?.date ?? source.raceDate ?? inputPath.match(/(\d{4}-\d{2}-\d{2})/)?.[1];
  if (!date || (requestedDate && requestedDate !== date)) continue;
  if (!(source.races?.length > 0)) continue;
  const statistics = buildStatistics(inputPath, date);
  if (statistics.evaluationCutoff !== date.replaceAll("-", "")) {
    throw new Error(`Statistics cutoff mismatch for ${date}: ${statistics.evaluationCutoff}`);
  }
  const predictions = source.races.map((race) => buildRaceShadowPrediction(race, statistics));
  const predictionPayload = {
    modelVersion: MODEL_VERSION,
    modelSpecSha256,
    raceDate: date,
    statisticsCutoff: statistics.evaluationCutoff,
    predictions,
  };
  const predictionSha256 = sha256(stableJson(predictionPayload));
  const artifact = {
    schemaVersion: 1,
    status: flag("--all-historical") ? "reconstructed-pre-race-shadow" : "frozen-pre-race-shadow",
    modelVersion: MODEL_VERSION,
    frozenAt: new Date().toISOString(),
    raceDate: date,
    productionConnected: false,
    policy: {
      purpose: "Blood配合・クロス実績の事前影評価",
      currentRaceResultRead: false,
      popularityOddsValueUsed: false,
      statisticsRule: "対象日より前の着順だけを集計し、対象馬自身はleave-one-horse-out",
      scoreLimit: 2,
    },
    source: {
      input: relative(ROOT, inputPath).replaceAll("\\", "/"),
      inputSha256: sha256(readFileSync(inputPath)),
      modelSpecSha256,
      raceCount: predictions.length,
      horseCount: predictions.reduce((sum, race) => sum + race.horseCount, 0),
    },
    statistics: {
      schemaVersion: statistics.schemaVersion,
      evaluationCutoff: statistics.evaluationCutoff,
      futureObservationCount: statistics.futureObservationCount,
      observationCount: statistics.observationCount,
      archivePairCount: statistics.archivePairCount,
      minimumSamples: statistics.minimumSamples,
      baseline: statistics.baseline,
      lineResolution: statistics.lineResolution,
    },
    summary: {
      raceCount: predictions.length,
      horseCount: predictions.reduce((sum, race) => sum + race.horseCount, 0),
      adjustedHorseCount: predictions.reduce((sum, race) => sum + race.horses.filter((horse) => horse.shadowAdjustment !== 0).length, 0),
      rankChangedHorseCount: predictions.reduce((sum, race) => sum + race.horses.filter((horse) => horse.currentRank !== horse.shadowRank).length, 0),
      leaderSetChangedRaceCount: predictions.filter((race) => race.leaderSetChanged).length,
      maxAbsAdjustment: Math.max(0, ...predictions.flatMap((race) => race.horses.map((horse) => Math.abs(horse.shadowAdjustment)))),
      unresolvedSireLineCount: predictions.reduce((sum, race) => sum + race.horses.filter((horse) => !horse.lineIds.sire).length, 0),
      unresolvedBroodmareSireLineCount: predictions.reduce((sum, race) => sum + race.horses.filter((horse) => !horse.lineIds.broodmareSire).length, 0),
    },
    predictionSha256,
    predictions,
  };
  const outputPath = join(SHADOW_DIR, `${date}-pre-race.json`);
  if (existsSync(outputPath)) {
    const previous = readJson(outputPath);
    if (previous.predictionSha256 !== predictionSha256) {
      if (flag("--replace-reconstructed") && previous.status === "reconstructed-pre-race-shadow" && artifact.status === "reconstructed-pre-race-shadow") {
        writeFileSync(outputPath, stableJson(artifact));
      } else {
        throw new Error(`Frozen Blood shadow differs from existing artifact: ${outputPath}`);
      }
    }
  } else {
    writeFileSync(outputPath, stableJson(artifact));
  }
  summaries.push({ date, outputPath, ...artifact.summary, predictionSha256 });
}

const reportPath = join(ROOT, "docs", "analysis", `blood-pairing-cross-shadow-freeze-${REPORT_DATE}.md`);
const totals = summaries.reduce((summary, item) => {
  for (const key of ["raceCount", "horseCount", "adjustedHorseCount", "rankChangedHorseCount", "leaderSetChangedRaceCount", "unresolvedSireLineCount", "unresolvedBroodmareSireLineCount"]) {
    summary[key] += item[key];
  }
  summary.maxAbsAdjustment = Math.max(summary.maxAbsAdjustment, item.maxAbsAdjustment);
  return summary;
}, {
  raceCount: 0,
  horseCount: 0,
  adjustedHorseCount: 0,
  rankChangedHorseCount: 0,
  leaderSetChangedRaceCount: 0,
  unresolvedSireLineCount: 0,
  unresolvedBroodmareSireLineCount: 0,
  maxAbsAdjustment: 0,
});
const report = `# Blood配合・クロス影予測 freeze (${REPORT_DATE})

## 固定状態

- 本番Blood・TM INDEXへの接続: **なし**
- 固定日: ${summaries.map((item) => item.date).join(" / ") || "なし"}
- 対象: ${totals.raceCount}レース / ${totals.horseCount}頭
- 補正発火: ${totals.adjustedHorseCount}頭
- Blood順位変動: ${totals.rankChangedHorseCount}頭 / 首位集合変動${totals.leaderSetChangedRaceCount}レース
- 最大絶対補正: ${totals.maxAbsAdjustment.toFixed(4)}点
- 未分類: 父系${totals.unresolvedSireLineCount}頭 / 母父系${totals.unresolvedBroodmareSireLineCount}頭
- 対象レース結果: freeze工程では読み込まない
- 人気・オッズ・Value: 使用しない
- モデル仕様SHA256: \`${modelSpecSha256}\`

## 日別artifact

| 日付 | レース | 頭数 | 補正発火 | 順位変動 | 首位変動 | 最大補正 |
|---|---:|---:|---:|---:|---:|---:|
${summaries.map((item) => `| ${item.date} | ${item.raceCount} | ${item.horseCount} | ${item.adjustedHorseCount} | ${item.rankChangedHorseCount} | ${item.leaderSetChangedRaceCount} | ${item.maxAbsAdjustment.toFixed(4)} |`).join("\n") || "| - | 0 | 0 | 0 | 0 | 0 | 0 |"}

過去分は保存済みpreoddsからの再構成freeze。今後分は同じスクリプトを結果取得前に実行し、既存artifactと異なる予測での上書きを拒否する。
`;
writeFileSync(reportPath, report, "utf8");
console.log(JSON.stringify({ reportPath, artifactCount: summaries.length, modelSpecSha256, ...totals }, null, 2));
