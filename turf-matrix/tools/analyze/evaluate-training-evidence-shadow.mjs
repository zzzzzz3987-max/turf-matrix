#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  aggregateTrainingEvidenceEvaluation,
  evaluateRaceTrainingEvidencePrediction,
} from "./lib/training-evidence-shadow.mjs";

const ANALYZE_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(ANALYZE_DIR, "..", "..");
const ARCHIVE_DIR = join(ROOT, "data", "archive");
const SHADOW_DIR = join(ROOT, "data", "shadow", "training-evidence-v1");
const OUTPUT_DATE = new Date().toISOString().slice(0, 10);
const OUTPUT = join(ROOT, "docs", "analysis", `training-evidence-shadow-evaluation-${OUTPUT_DATE}.md`);
const MIN_RACES = 30;
const MIN_TM_LEADER_CHANGES = 5;
const readJson = (path) => JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
const stableJson = (value) => `${JSON.stringify(value, null, 2)}\n`;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const pct = (value) => Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : "-";

const artifacts = existsSync(SHADOW_DIR)
  ? readdirSync(SHADOW_DIR).filter((name) => /^\d{4}-\d{2}-\d{2}-pre-race\.json$/.test(name)).sort().map((name) => readJson(join(SHADOW_DIR, name)))
  : [];
const completed = [];
const pendingDates = [];
const incompleteRaces = [];
for (const artifact of artifacts) {
  const expectedHash = sha256(stableJson({
    modelVersion: artifact.modelVersion,
    modelSpecSha256: artifact.source.modelSpecSha256,
    raceDate: artifact.raceDate,
    predictions: artifact.predictions,
  }));
  if (expectedHash !== artifact.predictionSha256) throw new Error(`Frozen Training prediction hash mismatch: ${artifact.raceDate}`);
  if (
    artifact.productionConnected !== false ||
    artifact.policy.currentRaceResultRead !== false ||
    artifact.policy.popularityOddsValueUsed !== false ||
    artifact.policy.volumeUsedAsPerformanceScore !== false ||
    artifact.policy.freshnessUsedAsPerformanceScore !== false ||
    artifact.policy.empiricalBaselineResultDataUsed !== false ||
    artifact.policy.empiricalBaselineMarketDataUsed !== false
  ) throw new Error(`Invalid Training pre-race policy: ${artifact.raceDate}`);
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
    const evaluated = evaluateRaceTrainingEvidencePrediction(prediction, byBundle.get(prediction.bundleId) ?? byId.get(prediction.raceId));
    if (!evaluated) {
      incompleteRaces.push(`${artifact.raceDate} ${prediction.track}${prediction.raceNumber}R`);
      continue;
    }
    races.push({ ...evaluated, date: artifact.raceDate });
  }
  completed.push({ date: artifact.raceDate, races });
}

const races = completed.flatMap((day) => day.races);
const aggregate = aggregateTrainingEvidenceEvaluation(races);
const enoughEvidence = aggregate.raceCount >= MIN_RACES && aggregate.tmLeaderChangedRaceCount >= MIN_TM_LEADER_CHANGES;
const criteria = [
  ["評価済み30レース以上", aggregate.raceCount >= MIN_RACES, `${aggregate.raceCount}レース`],
  ["TM首位変更5レース以上", aggregate.tmLeaderChangedRaceCount >= MIN_TM_LEADER_CHANGES, `${aggregate.tmLeaderChangedRaceCount}レース`],
  ["最大Training補正3点以内", aggregate.maxAbsAdjustment <= 3, `${aggregate.maxAbsAdjustment}点`],
  ["Training首位勝数を維持", aggregate.shadowTrainingWins >= aggregate.currentTrainingWins, `${aggregate.currentTrainingWins}→${aggregate.shadowTrainingWins}`],
  ["Training首位複勝数を維持", aggregate.shadowTrainingPlaces >= aggregate.currentTrainingPlaces, `${aggregate.currentTrainingPlaces}→${aggregate.shadowTrainingPlaces}`],
  ["Training全頭pairwiseを維持", (aggregate.shadowTrainingPairwiseRate ?? 0) >= (aggregate.currentTrainingPairwiseRate ?? 0), `${pct(aggregate.currentTrainingPairwiseRate)}→${pct(aggregate.shadowTrainingPairwiseRate)}`],
  ["TM首位勝数を維持", aggregate.shadowTmWins >= aggregate.currentTmWins, `${aggregate.currentTmWins}→${aggregate.shadowTmWins}`],
  ["TM首位複勝数を維持", aggregate.shadowTmPlaces >= aggregate.currentTmPlaces, `${aggregate.currentTmPlaces}→${aggregate.shadowTmPlaces}`],
  ["TM全頭pairwiseを維持", (aggregate.shadowTmPairwiseRate ?? 0) >= (aggregate.currentTmPairwiseRate ?? 0), `${pct(aggregate.currentTmPairwiseRate)}→${pct(aggregate.shadowTmPairwiseRate)}`],
  ["勝数または複勝数を1件以上改善", aggregate.shadowTmWins > aggregate.currentTmWins || aggregate.shadowTmPlaces > aggregate.currentTmPlaces, `勝${aggregate.shadowTmWins - aggregate.currentTmWins >= 0 ? "+" : ""}${aggregate.shadowTmWins - aggregate.currentTmWins} / 複${aggregate.shadowTmPlaces - aggregate.currentTmPlaces >= 0 ? "+" : ""}${aggregate.shadowTmPlaces - aggregate.currentTmPlaces}`],
];
const accepted = enoughEvidence && criteria.every(([, pass]) => pass);
const status = accepted ? "PASS（Training接続候補）" : enoughEvidence ? "FAIL（現行維持）" : "COLLECTING（標本蓄積中）";
const dayRows = completed.map((day) => {
  const value = aggregateTrainingEvidenceEvaluation(day.races);
  return `| ${day.date} | ${value.raceCount} | ${value.tmLeaderChangedRaceCount} | ${value.currentTmWins}→${value.shadowTmWins} | ${value.currentTmPlaces}→${value.shadowTmPlaces} |`;
}).join("\n");
const changedRows = races.filter((race) => race.tmLeaderChanged).map((race) => `| ${race.date} | ${race.track}${race.raceNumber}R ${race.raceName} | ${race.currentTmLeader.name}(${race.currentTmLeader.finish}着) | ${race.shadowTmLeader.name}(${race.shadowTmLeader.finish}着・${race.shadowTmLeader.trainingAdjustment > 0 ? "+" : ""}${race.shadowTmLeader.trainingAdjustment}) |`).join("\n");
const report = `# Training Evidence 影評価 (${OUTPUT_DATE})

## 判定

**${status}**

- 評価済み: ${aggregate.raceCount}レース / ${aggregate.horseCount}頭
- Training補正発火: ${aggregate.adjustedHorseCount}頭
- Training首位変更: ${aggregate.trainingLeaderChangedRaceCount}レース
- TM首位変更: ${aggregate.tmLeaderChangedRaceCount}レース
- 結果待ち: ${pendingDates.length ? pendingDates.join("、") : "なし"}
- JOIN不能: ${incompleteRaces.length}レース
- 本番Training・TM INDEX: 未接続

| 指標 | 現行 | 影評価 |
|---|---:|---:|
| Training首位勝数 | ${aggregate.currentTrainingWins} | ${aggregate.shadowTrainingWins} |
| Training首位複勝数 | ${aggregate.currentTrainingPlaces} | ${aggregate.shadowTrainingPlaces} |
| Training pairwise | ${pct(aggregate.currentTrainingPairwiseRate)} | ${pct(aggregate.shadowTrainingPairwiseRate)} |
| TM首位勝数 | ${aggregate.currentTmWins} | ${aggregate.shadowTmWins} |
| TM首位複勝数 | ${aggregate.currentTmPlaces} | ${aggregate.shadowTmPlaces} |
| TM pairwise | ${pct(aggregate.currentTmPairwiseRate)} | ${pct(aggregate.shadowTmPairwiseRate)} |

## 日別

| 日付 | レース | TM首位変更 | 勝数 | 複勝数 |
|---|---:|---:|---:|---:|
${dayRows || "| - | 0 | 0 | 0→0 | 0→0 |"}

## TM首位変更

| 日付 | レース | 現行首位 | 影首位 |
|---|---|---|---|
${changedRows || "| - | - | - | - |"}

## 採用ゲート

| 条件 | 判定 | 実測 |
|---|---|---|
${criteria.map(([label, pass, value]) => `| ${label} | ${pass ? "PASS" : "WAIT/FAIL"} | ${value} |`).join("\n")}

事前固定済みartifactのみを評価する。全条件を満たすまで本番Trainingへ接続せず、結果を見た係数変更も行わない。
`;
mkdirSync(dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, report, "utf8");
console.log(JSON.stringify({ output: OUTPUT, status, pendingDates, incompleteRaces: incompleteRaces.length, ...aggregate }, null, 2));
