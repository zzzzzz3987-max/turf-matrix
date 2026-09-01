#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { aggregateShadowEvaluation, evaluateRaceShadowPrediction } from "./lib/blood-pairing-cross-shadow.mjs";

const ANALYZE_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(ANALYZE_DIR, "..", "..");
const ARCHIVE_DIR = join(ROOT, "data", "archive");
const SHADOW_DIR = join(ROOT, "data", "shadow", "blood-pairing-cross-v1");
const OUTPUT_DATE = "2026-09-01";
const OUTPUT = join(ROOT, "docs", "analysis", `blood-pairing-cross-shadow-evaluation-${OUTPUT_DATE}.md`);
const MIN_RACES = 30;
const MIN_ADJUSTED_HORSES = 20;
const MIN_LEADER_CHANGES = 5;

const readJson = (path) => JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
const stableJson = (value) => `${JSON.stringify(value, null, 2)}\n`;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const pct = (value) => Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : "-";

const artifacts = existsSync(SHADOW_DIR)
  ? readdirSync(SHADOW_DIR)
      .filter((name) => /^\d{4}-\d{2}-\d{2}-pre-race\.json$/.test(name))
      .sort()
      .map((name) => readJson(join(SHADOW_DIR, name)))
  : [];
const completed = [];
const pendingDates = [];
const incompleteRaces = [];

for (const artifact of artifacts) {
  const expectedHash = sha256(stableJson({
    modelVersion: artifact.modelVersion,
    modelSpecSha256: artifact.source.modelSpecSha256,
    raceDate: artifact.raceDate,
    statisticsCutoff: artifact.statistics.evaluationCutoff,
    predictions: artifact.predictions,
  }));
  if (expectedHash !== artifact.predictionSha256) throw new Error(`Frozen Blood prediction hash mismatch: ${artifact.raceDate}`);
  if (artifact.policy.currentRaceResultRead !== false || artifact.statistics.evaluationCutoff !== artifact.raceDate.replaceAll("-", "")) {
    throw new Error(`Invalid pre-race policy in Blood artifact: ${artifact.raceDate}`);
  }
  const resultPath = join(ARCHIVE_DIR, `${artifact.raceDate}-results.json`);
  if (!existsSync(resultPath)) {
    pendingDates.push(artifact.raceDate);
    continue;
  }
  const results = readJson(resultPath);
  const byBundle = new Map((results.races ?? []).map((race) => [race.bundleId, race]));
  const byId = new Map((results.races ?? []).map((race) => [race.id, race]));
  const races = [];
  for (const prediction of artifact.predictions) {
    const resultRace = byBundle.get(prediction.bundleId) ?? byId.get(prediction.raceId);
    const evaluated = evaluateRaceShadowPrediction(prediction, resultRace);
    if (!evaluated) {
      incompleteRaces.push(`${artifact.raceDate} ${prediction.track}${prediction.raceNumber}R`);
      continue;
    }
    races.push({ ...evaluated, date: artifact.raceDate });
  }
  completed.push({ date: artifact.raceDate, races });
}

const races = completed.flatMap((day) => day.races);
const aggregate = aggregateShadowEvaluation(races);
const minimumEvidence = aggregate.raceCount >= MIN_RACES
  && aggregate.adjustedHorseCount >= MIN_ADJUSTED_HORSES
  && aggregate.leaderSetChangedRaceCount >= MIN_LEADER_CHANGES;
const criteria = [
  ["評価済み30レース以上", aggregate.raceCount >= MIN_RACES, `${aggregate.raceCount}レース`],
  ["補正発火20頭以上", aggregate.adjustedHorseCount >= MIN_ADJUSTED_HORSES, `${aggregate.adjustedHorseCount}頭`],
  ["首位集合変動5レース以上", aggregate.leaderSetChangedRaceCount >= MIN_LEADER_CHANGES, `${aggregate.leaderSetChangedRaceCount}レース`],
  ["最大補正2点以内", aggregate.maxAbsAdjustment <= 2, aggregate.maxAbsAdjustment.toFixed(4)],
  ["首位勝数を維持", aggregate.shadowLeaderWins >= aggregate.currentLeaderWins, `${aggregate.currentLeaderWins}→${aggregate.shadowLeaderWins}`],
  ["首位複勝数を維持", aggregate.shadowLeaderPlaces >= aggregate.currentLeaderPlaces, `${aggregate.currentLeaderPlaces}→${aggregate.shadowLeaderPlaces}`],
  ["上位3ランクの実馬券内数を維持", aggregate.shadowTop3ActualPlaces >= aggregate.currentTop3ActualPlaces, `${aggregate.currentTop3ActualPlaces}→${aggregate.shadowTop3ActualPlaces}`],
  ["勝馬の上位3ランク捕捉を維持", aggregate.shadowWinnerInTop3 >= aggregate.currentWinnerInTop3, `${aggregate.currentWinnerInTop3}→${aggregate.shadowWinnerInTop3}`],
  ["全頭pairwise整合率を維持", (aggregate.shadowPairwiseRate ?? 0) >= (aggregate.currentPairwiseRate ?? 0), `${pct(aggregate.currentPairwiseRate)}→${pct(aggregate.shadowPairwiseRate)}`],
  ["同率首位レースを増やさない", aggregate.shadowLeaderTieRaces <= aggregate.currentLeaderTieRaces, `${aggregate.currentLeaderTieRaces}→${aggregate.shadowLeaderTieRaces}`],
  ["少なくとも1指標を改善", [
    aggregate.shadowLeaderWins > aggregate.currentLeaderWins,
    aggregate.shadowLeaderPlaces > aggregate.currentLeaderPlaces,
    aggregate.shadowTop3ActualPlaces > aggregate.currentTop3ActualPlaces,
    aggregate.shadowWinnerInTop3 > aggregate.currentWinnerInTop3,
    (aggregate.shadowPairwiseRate ?? 0) > (aggregate.currentPairwiseRate ?? 0),
  ].some(Boolean), "勝数・複勝数・上位捕捉・pairwiseのいずれか"],
];
const accepted = minimumEvidence && criteria.every(([, pass]) => pass);
const status = accepted ? "PASS（Blood接続候補）" : minimumEvidence ? "FAIL（現行維持）" : "HOLD（発火標本蓄積中）";

const dayRows = completed.map((day) => {
  const value = aggregateShadowEvaluation(day.races);
  return `| ${day.date} | ${value.raceCount} | ${value.adjustedHorseCount} | ${value.leaderSetChangedRaceCount} | ${value.currentLeaderWins}→${value.shadowLeaderWins} | ${value.currentLeaderPlaces}→${value.shadowLeaderPlaces} | ${pct(value.currentPairwiseRate)}→${pct(value.shadowPairwiseRate)} |`;
}).join("\n");
const criterionRows = criteria.map(([label, pass, value]) => `| ${label} | ${pass ? "PASS" : "WAIT/FAIL"} | ${value} |`).join("\n");
const changedLeaderRows = races.filter((race) => race.leaderSetChanged).map((race) => {
  const current = race.currentLeaders.map((horse) => `${horse.name}(${horse.finish}着)`).join(" / ");
  const shadow = race.shadowLeaders.map((horse) => `${horse.name}(${horse.finish}着・${horse.adjustment >= 0 ? "+" : ""}${horse.adjustment.toFixed(3)})`).join(" / ");
  const evidence = race.shadowLeaders.map((horse) => horse.pairing
    ? `${horse.pairing.fallbackLevel} N=${horse.pairing.sampleSize}`
    : "配合統計なし"
  ).join(" / ");
  return `| ${race.date} | ${race.track}${race.raceNumber}R ${race.raceName} | ${current} | ${shadow} | ${evidence} |`;
}).join("\n");
const report = `# Blood配合・クロス影 累積評価 (${OUTPUT_DATE})

## 判定

**${status}**

- 評価済み: ${aggregate.raceCount}レース / ${aggregate.horseCount}頭
- 補正発火: ${aggregate.adjustedHorseCount}頭
- Blood順位変動: ${aggregate.rankChangedHorseCount}頭
- 首位集合変動: ${aggregate.leaderSetChangedRaceCount}レース
- 最大絶対補正: ${aggregate.maxAbsAdjustment.toFixed(4)}点
- 結果待ち: ${pendingDates.length ? pendingDates.join("、") : "なし"}
- JOIN不能レース: ${incompleteRaces.length}
- 本番Blood・TM INDEX: 未接続

## 累積成績

| 指標 | 現Blood | 影Blood |
|---|---:|---:|
| 首位勝数 | ${aggregate.currentLeaderWins} | ${aggregate.shadowLeaderWins} |
| 首位複勝数 | ${aggregate.currentLeaderPlaces} | ${aggregate.shadowLeaderPlaces} |
| 上位3ランクの実馬券内数 | ${aggregate.currentTop3ActualPlaces} | ${aggregate.shadowTop3ActualPlaces} |
| 勝馬の上位3ランク捕捉 | ${aggregate.currentWinnerInTop3} | ${aggregate.shadowWinnerInTop3} |
| 全頭pairwise整合率 | ${pct(aggregate.currentPairwiseRate)} | ${pct(aggregate.shadowPairwiseRate)} |
| 同率首位レース | ${aggregate.currentLeaderTieRaces} | ${aggregate.shadowLeaderTieRaces} |

## 日別

| 日付 | レース | 補正発火 | 首位変動 | 首位勝数 | 首位複勝数 | pairwise整合率 |
|---|---:|---:|---:|---:|---:|---:|
${dayRows || "| - | 0 | 0 | 0 | 0→0 | 0→0 | - |"}

## 首位集合が変わったレース

| 日付 | レース | 現Blood首位 | 影Blood首位 | 影首位のEvidence |
|---|---|---|---|---|
${changedLeaderRows || "| - | - | - | - | - |"}

## 採用ゲート

| 基準 | 判定 | 実測 |
|---|---|---|
${criterionRows}

過去分は保存済みpreoddsからの再構成freezeであり、当時リアルタイムに保存したartifactではない。評価は固定artifactのSHA検証後にだけ結果を読み、閾値・係数は結果を見て変更しない。全基準を満たすまで本番Bloodへ接続せず、TM INDEXへの接続はさらに別工程とする。
`;
mkdirSync(dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, report, "utf8");
console.log(JSON.stringify({ output: OUTPUT, status, pendingDates, incompleteRaces: incompleteRaces.length, ...aggregate }, null, 2));
