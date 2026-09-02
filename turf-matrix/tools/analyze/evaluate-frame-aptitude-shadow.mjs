#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  aggregateFrameAptitudeEvaluation,
  evaluateRaceFrameAptitudePrediction,
} from "./lib/frame-aptitude-shadow.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ARCHIVE_DIR = join(ROOT, "data", "archive");
const SHADOW_DIR = join(ROOT, "data", "shadow", "frame-aptitude-v2");
const OUTPUT_DATE = new Date().toISOString().slice(0, 10);
const OUTPUT = join(ROOT, "docs", "analysis", `frame-aptitude-shadow-evaluation-${OUTPUT_DATE}.md`);
const readJson = (path) => JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
const stableJson = (value) => `${JSON.stringify(value, null, 2)}\n`;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const pct = (value) => Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : "-";
const decimal = (value) => Number.isFinite(value) ? value.toFixed(4) : "-";

const artifacts = existsSync(SHADOW_DIR)
  ? readdirSync(SHADOW_DIR).filter((name) => /^\d{4}-\d{2}-\d{2}-pre-race\.json$/.test(name)).sort().map((name) => readJson(join(SHADOW_DIR, name)))
  : [];
const races = [];
const pendingDates = [];
const incompleteRaces = [];
for (const artifact of artifacts) {
  const expectedHash = sha256(stableJson({
    modelVersion: artifact.modelVersion,
    modelSpecSha256: artifact.source.modelSpecSha256,
    raceDate: artifact.raceDate,
    predictions: artifact.predictions,
  }));
  if (expectedHash !== artifact.predictionSha256) throw new Error(`Frozen Frame prediction hash mismatch: ${artifact.raceDate}`);
  if (
    artifact.productionConnected !== false ||
    artifact.policy.currentRaceResultRead !== false ||
    artifact.policy.popularityOddsValueUsed !== false ||
    artifact.policy.raceRunningPositionUsed !== false ||
    artifact.policy.tmIndexConnected !== false
  ) throw new Error(`Invalid Frame pre-race policy: ${artifact.raceDate}`);
  const resultPath = join(ARCHIVE_DIR, `${artifact.raceDate}-results.json`);
  if (!existsSync(resultPath)) {
    pendingDates.push(artifact.raceDate);
    continue;
  }
  const results = readJson(resultPath);
  const byBundle = new Map((results.races ?? []).map((race) => [race.bundleId, race]));
  const byId = new Map((results.races ?? []).map((race) => [race.id, race]));
  for (const prediction of artifact.predictions) {
    const evaluated = evaluateRaceFrameAptitudePrediction(prediction, byBundle.get(prediction.bundleId) ?? byId.get(prediction.raceId));
    if (!evaluated) incompleteRaces.push(`${artifact.raceDate} ${prediction.track}${prediction.raceNumber}R`);
    else races.push({ ...evaluated, date: artifact.raceDate });
  }
}

const aggregate = aggregateFrameAptitudeEvaluation(races);
const criteria = [
  ["評価済み30レース以上", aggregate.raceCount >= 30, `${aggregate.raceCount}レース`],
  ["評価済み300頭以上", aggregate.horseCount >= 300, `${aggregate.horseCount}頭`],
  ["統計条件合致率90%以上", aggregate.horseCount > 0 && aggregate.empiricalMatchCount / aggregate.horseCount >= 0.9, `${aggregate.empiricalMatchCount}/${aggregate.horseCount}`],
  ["Frame首位変更5レース以上", aggregate.leaderChangedRaceCount >= 5, `${aggregate.leaderChangedRaceCount}レース`],
  ["Brierを維持・改善", aggregate.shadowBrier != null && aggregate.baselineBrier != null && aggregate.shadowBrier <= aggregate.baselineBrier, `${decimal(aggregate.baselineBrier)}→${decimal(aggregate.shadowBrier)}`],
  ["Frame全頭pairwiseを維持", (aggregate.shadowPairwiseRate ?? 0) >= (aggregate.currentPairwiseRate ?? 0), `${pct(aggregate.currentPairwiseRate)}→${pct(aggregate.shadowPairwiseRate)}`],
  ["Frame首位勝数を維持", aggregate.shadowLeaderWins >= aggregate.currentLeaderWins, `${aggregate.currentLeaderWins}→${aggregate.shadowLeaderWins}`],
  ["Frame首位複勝数を維持", aggregate.shadowLeaderPlaces >= aggregate.currentLeaderPlaces, `${aggregate.currentLeaderPlaces}→${aggregate.shadowLeaderPlaces}`],
  ["有利判定群が不利判定群を上回る", aggregate.positiveSampleSize >= 30 && aggregate.negativeSampleSize >= 30 && (aggregate.positivePlaceRate ?? 0) > (aggregate.negativePlaceRate ?? 1), `${pct(aggregate.positivePlaceRate)} / ${pct(aggregate.negativePlaceRate)}`],
];
const accepted = criteria.every(([, pass]) => pass);
const enoughEvidence = aggregate.raceCount >= 30 && aggregate.horseCount >= 300 && aggregate.leaderChangedRaceCount >= 5;
const status = accepted ? "PASS（Frame表示接続候補）" : enoughEvidence ? "FAIL（現行維持）" : "COLLECTING（標本蓄積中）";
const changedRows = races.filter((race) => race.leaderChanged).map((race) => `| ${race.date} | ${race.track}${race.raceNumber}R ${race.raceName} | ${race.currentLeader.name}(${race.currentLeader.finish}着) | ${race.shadowLeader.name}(${race.shadowLeader.finish}着) |`).join("\n");
const report = `# Frame Aptitude 影評価 (${OUTPUT_DATE})

## 判定

**${status}**

- 評価済み: ${aggregate.raceCount}レース / ${aggregate.horseCount}頭
- 統計条件合致: ${aggregate.empiricalMatchCount}頭
- Frame首位変更: ${aggregate.leaderChangedRaceCount}レース
- 結果待ち: ${pendingDates.length ? pendingDates.join("、") : "なし"}
- JOIN不能: ${incompleteRaces.length}レース
- 本番Frame・TM INDEX: 未接続

| 指標 | 現行 | 影評価 |
|---|---:|---:|
| Frame首位勝数 | ${aggregate.currentLeaderWins} | ${aggregate.shadowLeaderWins} |
| Frame首位複勝数 | ${aggregate.currentLeaderPlaces} | ${aggregate.shadowLeaderPlaces} |
| Frame pairwise | ${pct(aggregate.currentPairwiseRate)} | ${pct(aggregate.shadowPairwiseRate)} |
| Brier | ${decimal(aggregate.baselineBrier)} | ${decimal(aggregate.shadowBrier)} |
| 有利 / 不利判定群3着内率 | - | ${pct(aggregate.positivePlaceRate)} / ${pct(aggregate.negativePlaceRate)} |

## Frame首位変更

| 日付 | レース | 現行首位 | 影首位 |
|---|---|---|---|
${changedRows || "| - | - | - | - |"}

## 採用ゲート

| 条件 | 判定 | 実測 |
|---|---|---|
${criteria.map(([label, pass, value]) => `| ${label} | ${pass ? "PASS" : "WAIT/FAIL"} | ${value} |`).join("\n")}

事前固定済みartifactのみを評価する。全条件を満たすまでは本番Frameへ接続せず、TM INDEX接続は別途weight検証を行う。
`;
mkdirSync(dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, report, "utf8");
console.log(JSON.stringify({ output: OUTPUT, status, pendingDates, incompleteRaces: incompleteRaces.length, ...aggregate }, null, 2));
