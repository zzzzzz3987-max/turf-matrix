#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  aggregateStableOperationEvaluation,
  evaluateRaceStableOperationPrediction,
} from "./lib/stable-operation-shadow.mjs";

const ANALYZE_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(ANALYZE_DIR, "..", "..");
const ARCHIVE_DIR = join(ROOT, "data", "archive");
const SHADOW_DIR = join(ROOT, "data", "shadow", "stable-operation-v2");
const OUTPUT_DATE = new Date().toISOString().slice(0, 10);
const OUTPUT = join(ROOT, "docs", "analysis", `stable-operation-shadow-evaluation-${OUTPUT_DATE}.md`);
const MIN_RACES = 30;
const MIN_EMPIRICAL_MATCHES = 20;
const MIN_LEADER_CHANGES = 5;
const readJson = (path) => JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
const stableJson = (value) => `${JSON.stringify(value, null, 2)}\n`;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const pct = (value) => Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : "-";

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
  if (expectedHash !== artifact.predictionSha256) throw new Error(`Frozen Stable prediction hash mismatch: ${artifact.raceDate}`);
  if (
    artifact.productionConnected !== false ||
    artifact.policy.currentRaceResultRead !== false ||
    artifact.policy.popularityOddsValueUsed !== false ||
    artifact.policy.trainingPatternScoredInStable !== false ||
    artifact.policy.genericOperationAssumptionsScored !== false ||
    artifact.policy.tmIndexConnected !== false
  ) throw new Error(`Invalid Stable pre-race policy: ${artifact.raceDate}`);
  const resultPath = join(ARCHIVE_DIR, `${artifact.raceDate}-results.json`);
  if (!existsSync(resultPath)) {
    pendingDates.push(artifact.raceDate);
    continue;
  }
  const results = readJson(resultPath);
  const byBundle = new Map((results.races ?? []).map((race) => [race.bundleId, race]));
  const byId = new Map((results.races ?? []).map((race) => [race.id, race]));
  for (const prediction of artifact.predictions) {
    const evaluated = evaluateRaceStableOperationPrediction(prediction, byBundle.get(prediction.bundleId) ?? byId.get(prediction.raceId));
    if (!evaluated) incompleteRaces.push(`${artifact.raceDate} ${prediction.track}${prediction.raceNumber}R`);
    else races.push({ ...evaluated, date: artifact.raceDate });
  }
}

const aggregate = aggregateStableOperationEvaluation(races);
const criteria = [
  ["評価済み30レース以上", aggregate.raceCount >= MIN_RACES, `${aggregate.raceCount}レース`],
  ["厩舎固有パターン合致20頭以上", aggregate.empiricalMatchCount >= MIN_EMPIRICAL_MATCHES, `${aggregate.empiricalMatchCount}頭`],
  ["Stable首位変更5レース以上", aggregate.leaderChangedRaceCount >= MIN_LEADER_CHANGES, `${aggregate.leaderChangedRaceCount}レース`],
  ["最大Stable補正3点以内", aggregate.maxAbsAdjustment <= 3, `${aggregate.maxAbsAdjustment}点`],
  ["Stable首位勝数を維持", aggregate.shadowLeaderWins >= aggregate.currentLeaderWins, `${aggregate.currentLeaderWins}→${aggregate.shadowLeaderWins}`],
  ["Stable首位複勝数を維持", aggregate.shadowLeaderPlaces >= aggregate.currentLeaderPlaces, `${aggregate.currentLeaderPlaces}→${aggregate.shadowLeaderPlaces}`],
  ["Stable全頭pairwiseを維持", (aggregate.shadowPairwiseRate ?? 0) >= (aggregate.currentPairwiseRate ?? 0), `${pct(aggregate.currentPairwiseRate)}→${pct(aggregate.shadowPairwiseRate)}`],
  ["勝数または複勝数を1件以上改善", aggregate.shadowLeaderWins > aggregate.currentLeaderWins || aggregate.shadowLeaderPlaces > aggregate.currentLeaderPlaces, `勝${aggregate.shadowLeaderWins - aggregate.currentLeaderWins >= 0 ? "+" : ""}${aggregate.shadowLeaderWins - aggregate.currentLeaderWins} / 複${aggregate.shadowLeaderPlaces - aggregate.currentLeaderPlaces >= 0 ? "+" : ""}${aggregate.shadowLeaderPlaces - aggregate.currentLeaderPlaces}`],
];
const accepted = criteria.every(([, pass]) => pass);
const enoughEvidence = aggregate.raceCount >= MIN_RACES && aggregate.empiricalMatchCount >= MIN_EMPIRICAL_MATCHES && aggregate.leaderChangedRaceCount >= MIN_LEADER_CHANGES;
const status = accepted ? "PASS（Stable接続候補）" : enoughEvidence ? "FAIL（現行維持）" : "COLLECTING（標本蓄積中）";
const changedRows = races.filter((race) => race.leaderChanged).map((race) => `| ${race.date} | ${race.track}${race.raceNumber}R ${race.raceName} | ${race.currentLeader.name}(${race.currentLeader.finish}着) | ${race.shadowLeader.name}(${race.shadowLeader.finish}着) |`).join("\n");
const report = `# Stable Operation 影評価 (${OUTPUT_DATE})

## 判定

**${status}**

- 評価済み: ${aggregate.raceCount}レース / ${aggregate.horseCount}頭
- 厩舎固有パターン合致: ${aggregate.empiricalMatchCount}頭
- Stable補正発火: ${aggregate.adjustedHorseCount}頭
- Stable首位変更: ${aggregate.leaderChangedRaceCount}レース
- 結果待ち: ${pendingDates.length ? pendingDates.join("、") : "なし"}
- JOIN不能: ${incompleteRaces.length}レース
- 本番Stable・TM INDEX: 未接続

| 指標 | 現行 | 影評価 |
|---|---:|---:|
| Stable首位勝数 | ${aggregate.currentLeaderWins} | ${aggregate.shadowLeaderWins} |
| Stable首位複勝数 | ${aggregate.currentLeaderPlaces} | ${aggregate.shadowLeaderPlaces} |
| Stable pairwise | ${pct(aggregate.currentPairwiseRate)} | ${pct(aggregate.shadowPairwiseRate)} |

## Stable首位変更

| 日付 | レース | 現行首位 | 影首位 |
|---|---|---|---|
${changedRows || "| - | - | - | - |"}

## 採用ゲート

| 条件 | 判定 | 実測 |
|---|---|---|
${criteria.map(([label, pass, value]) => `| ${label} | ${pass ? "PASS" : "WAIT/FAIL"} | ${value} |`).join("\n")}

事前固定済みartifactのみを評価する。全条件を満たすまでは本番Stableへ接続せず、TM INDEX接続は別途weight検証を行う。
`;
mkdirSync(dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, report, "utf8");
console.log(JSON.stringify({ output: OUTPUT, status, pendingDates, incompleteRaces: incompleteRaces.length, ...aggregate }, null, 2));
