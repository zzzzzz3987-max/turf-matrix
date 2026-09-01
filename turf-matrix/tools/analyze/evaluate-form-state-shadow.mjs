#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  aggregateFormStateEvaluation,
  evaluateRaceFormStatePrediction,
} from "./lib/form-state-shadow.mjs";

const ANALYZE_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(ANALYZE_DIR, "..", "..");
const ARCHIVE_DIR = join(ROOT, "data", "archive");
const SHADOW_DIR = join(ROOT, "data", "shadow", "form-state-v1");
const OUTPUT_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const OUTPUT = join(ROOT, "docs", "analysis", `form-state-shadow-evaluation-${OUTPUT_DATE}.md`);
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
  if (expectedHash !== artifact.predictionSha256) throw new Error(`Frozen Form prediction hash mismatch: ${artifact.raceDate}`);
  if (
    artifact.productionConnected !== false ||
    artifact.policy.currentRaceResultRead !== false ||
    artifact.policy.popularityOddsValueUsed !== false ||
    artifact.policy.candidateTargetDistanceSurfaceCourseUsed !== false ||
    artifact.policy.rawLast3FUsed !== false ||
    artifact.policy.candidateAbilityZiOpponentEvidenceUsed !== false ||
    artifact.policy.carriedWeightUsed !== false ||
    artifact.policy.momentumUsedAsPerformanceScore !== false ||
    artifact.policy.passingProgressUsedAsPerformanceScore !== false
  ) throw new Error(`Invalid Form pre-race policy: ${artifact.raceDate}`);
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
    const evaluated = evaluateRaceFormStatePrediction(prediction, byBundle.get(prediction.bundleId) ?? byId.get(prediction.raceId));
    if (!evaluated) {
      incompleteRaces.push(`${artifact.raceDate} ${prediction.track}${prediction.raceNumber}R`);
      continue;
    }
    races.push({ ...evaluated, date: artifact.raceDate });
  }
  completed.push({ date: artifact.raceDate, races });
}

const races = completed.flatMap((day) => day.races);
const aggregate = aggregateFormStateEvaluation(races);
const enoughEvidence = aggregate.raceCount >= MIN_RACES && aggregate.tmLeaderChangedRaceCount >= MIN_TM_LEADER_CHANGES;
const criteria = [
  ["評価済み30レース以上", aggregate.raceCount >= MIN_RACES, `${aggregate.raceCount}レース`],
  ["TM首位変更5レース以上", aggregate.tmLeaderChangedRaceCount >= MIN_TM_LEADER_CHANGES, `${aggregate.tmLeaderChangedRaceCount}レース`],
  ["最大Form補正3点以内", aggregate.maxAbsAdjustment <= 3, `${aggregate.maxAbsAdjustment}点`],
  ["Form首位勝数を維持", aggregate.shadowFormWins >= aggregate.currentFormWins, `${aggregate.currentFormWins}→${aggregate.shadowFormWins}`],
  ["Form首位複勝数を維持", aggregate.shadowFormPlaces >= aggregate.currentFormPlaces, `${aggregate.currentFormPlaces}→${aggregate.shadowFormPlaces}`],
  ["Form全頭pairwiseを維持", (aggregate.shadowFormPairwiseRate ?? 0) >= (aggregate.currentFormPairwiseRate ?? 0), `${pct(aggregate.currentFormPairwiseRate)}→${pct(aggregate.shadowFormPairwiseRate)}`],
  ["TM首位勝数を維持", aggregate.shadowTmWins >= aggregate.currentTmWins, `${aggregate.currentTmWins}→${aggregate.shadowTmWins}`],
  ["TM首位複勝数を維持", aggregate.shadowTmPlaces >= aggregate.currentTmPlaces, `${aggregate.currentTmPlaces}→${aggregate.shadowTmPlaces}`],
  ["TM全頭pairwiseを維持", (aggregate.shadowTmPairwiseRate ?? 0) >= (aggregate.currentTmPairwiseRate ?? 0), `${pct(aggregate.currentTmPairwiseRate)}→${pct(aggregate.shadowTmPairwiseRate)}`],
  ["勝数または複勝数を1件以上改善", aggregate.shadowTmWins > aggregate.currentTmWins || aggregate.shadowTmPlaces > aggregate.currentTmPlaces, `勝${aggregate.shadowTmWins - aggregate.currentTmWins >= 0 ? "+" : ""}${aggregate.shadowTmWins - aggregate.currentTmWins} / 複${aggregate.shadowTmPlaces - aggregate.currentTmPlaces >= 0 ? "+" : ""}${aggregate.shadowTmPlaces - aggregate.currentTmPlaces}`],
];
const accepted = enoughEvidence && criteria.every(([, pass]) => pass);
const status = accepted ? "PASS（Form接続候補）" : enoughEvidence ? "FAIL（現行維持）" : "COLLECTING（標本蓄積中）";
const dayRows = completed.map((day) => {
  const value = aggregateFormStateEvaluation(day.races);
  return `| ${day.date} | ${value.raceCount} | ${value.tmLeaderChangedRaceCount} | ${value.currentTmWins}→${value.shadowTmWins} | ${value.currentTmPlaces}→${value.shadowTmPlaces} |`;
}).join("\n");
const changedRows = races.filter((race) => race.tmLeaderChanged).map((race) => `| ${race.date} | ${race.track}${race.raceNumber}R ${race.raceName} | ${race.currentTmLeader.name}(${race.currentTmLeader.finish}着) | ${race.shadowTmLeader.name}(${race.shadowTmLeader.finish}着・${race.shadowTmLeader.formAdjustment > 0 ? "+" : ""}${race.shadowTmLeader.formAdjustment}) |`).join("\n");
const report = `# Form State 影評価 (${OUTPUT_DATE})

## 判定

**${status}**

- 評価済み: ${aggregate.raceCount}レース / ${aggregate.horseCount}頭
- Form補正発火: ${aggregate.adjustedHorseCount}頭
- Form首位変更: ${aggregate.formLeaderChangedRaceCount}レース
- TM首位変更: ${aggregate.tmLeaderChangedRaceCount}レース
- 結果待ち: ${pendingDates.length ? pendingDates.join("、") : "なし"}
- JOIN不能: ${incompleteRaces.length}レース
- 本番Form・TM INDEX: 未接続

| 指標 | 現行 | 影評価 |
|---|---:|---:|
| Form首位勝数 | ${aggregate.currentFormWins} | ${aggregate.shadowFormWins} |
| Form首位複勝数 | ${aggregate.currentFormPlaces} | ${aggregate.shadowFormPlaces} |
| Form pairwise | ${pct(aggregate.currentFormPairwiseRate)} | ${pct(aggregate.shadowFormPairwiseRate)} |
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

事前固定済みartifactのみを評価する。全条件を満たすまで本番Formへ接続せず、結果を見た係数変更も行わない。
`;
mkdirSync(dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, report, "utf8");
console.log(JSON.stringify({ output: OUTPUT, status, pendingDates, incompleteRaces: incompleteRaces.length, ...aggregate }, null, 2));
