#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { aggregatePaceShapeEvaluation, evaluateRacePaceShapePrediction } from "./lib/pace-shape-shadow.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ARCHIVE_DIR = join(ROOT, "data", "archive");
const SHADOW_DIR = join(ROOT, "data", "shadow", "pace-shape-v2");
const TODAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const OUTPUT = join(ROOT, "docs", "analysis", `pace-shape-shadow-evaluation-${TODAY}.md`);
const readJson = (path) => JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
const stableJson = (value) => `${JSON.stringify(value, null, 2)}\n`;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const pct = (value) => Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : "-";
const artifacts = existsSync(SHADOW_DIR)
  ? readdirSync(SHADOW_DIR).filter((name) => /^\d{4}-\d{2}-\d{2}-pre-race\.json$/.test(name)).sort().map((name) => readJson(join(SHADOW_DIR, name)))
  : [];
const races = [];
const pendingDates = [];
for (const artifact of artifacts) {
  const expected = sha256(stableJson({
    modelVersion: artifact.modelVersion,
    modelSpecSha256: artifact.source.modelSpecSha256,
    historySha256: artifact.source.historySha256,
    raceDate: artifact.raceDate,
    predictions: artifact.predictions,
  }));
  if (expected !== artifact.predictionSha256) throw new Error(`Frozen Pace prediction hash mismatch: ${artifact.raceDate}`);
  if (artifact.productionConnected !== false || artifact.policy.currentRaceResultRead !== false || artifact.policy.futureRaceShapeJoinAllowed !== false || artifact.policy.popularityOddsValueUsed !== false || artifact.policy.observedRaceLapUsed !== true) {
    throw new Error(`Invalid Pace pre-race policy: ${artifact.raceDate}`);
  }
  const resultPath = join(ARCHIVE_DIR, `${artifact.raceDate}-results.json`);
  if (!existsSync(resultPath)) { pendingDates.push(artifact.raceDate); continue; }
  const results = readJson(resultPath);
  const byBundle = new Map((results.races ?? []).map((race) => [race.bundleId, race]));
  for (const prediction of artifact.predictions) {
    const evaluated = evaluateRacePaceShapePrediction(prediction, byBundle.get(prediction.bundleId));
    if (evaluated) races.push({ ...evaluated, date: artifact.raceDate });
  }
}
const aggregate = aggregatePaceShapeEvaluation(races);
const criteria = [
  ["評価30レース以上", aggregate.raceCount >= 30, `${aggregate.raceCount}レース`],
  ["補正発火10レース以上", aggregate.adjustedRaceCount >= 10, `${aggregate.adjustedRaceCount}レース`],
  ["Pace首位変更5レース以上", aggregate.paceLeaderChangedRaceCount >= 5, `${aggregate.paceLeaderChangedRaceCount}レース`],
  ["Pace pairwiseを維持", (aggregate.shadowPacePairwiseRate ?? 0) >= (aggregate.currentPacePairwiseRate ?? 0), `${pct(aggregate.currentPacePairwiseRate)}→${pct(aggregate.shadowPacePairwiseRate)}`],
  ["Pace首位勝数を維持", aggregate.shadowPaceWins >= aggregate.currentPaceWins, `${aggregate.currentPaceWins}→${aggregate.shadowPaceWins}`],
  ["Pace首位複勝数を維持", aggregate.shadowPacePlaces >= aggregate.currentPacePlaces, `${aggregate.currentPacePlaces}→${aggregate.shadowPacePlaces}`],
  ["勝数または複勝数を改善", aggregate.shadowPaceWins > aggregate.currentPaceWins || aggregate.shadowPacePlaces > aggregate.currentPacePlaces, `勝${aggregate.shadowPaceWins - aggregate.currentPaceWins >= 0 ? "+" : ""}${aggregate.shadowPaceWins - aggregate.currentPaceWins} / 複${aggregate.shadowPacePlaces - aggregate.currentPacePlaces >= 0 ? "+" : ""}${aggregate.shadowPacePlaces - aggregate.currentPacePlaces}`],
  ["最大補正2点以内", aggregate.maxAbsAdjustment <= 2, `${aggregate.maxAbsAdjustment}点`],
];
const accepted = criteria.every(([, pass]) => pass);
const status = accepted ? "PASS（Pace接続候補）" : aggregate.raceCount >= 30 ? "FAIL（現行維持）" : "COLLECTING（標本蓄積中）";
const report = `# Pace Race Shape 影評価 (${TODAY})

## 判定

**${status}**

- 評価済み: ${aggregate.raceCount}レース / ${aggregate.horseCount}頭
- 過去形状照合: ${aggregate.matchedRaceCount}レース / ${aggregate.matchedHorseCount}頭
- 補正発火: ${aggregate.adjustedRaceCount}レース / ${aggregate.adjustedHorseCount}頭
- Pace首位変更: ${aggregate.paceLeaderChangedRaceCount}レース
- 結果待ち: ${pendingDates.length ? pendingDates.join("、") : "なし"}
- 本番Pace・TM INDEX: 未接続

| 指標 | 現行 | 影評価 |
|---|---:|---:|
| Pace首位勝数 | ${aggregate.currentPaceWins} | ${aggregate.shadowPaceWins} |
| Pace首位複勝数 | ${aggregate.currentPacePlaces} | ${aggregate.shadowPacePlaces} |
| Pace pairwise | ${pct(aggregate.currentPacePairwiseRate)} | ${pct(aggregate.shadowPacePairwiseRate)} |
| TM首位勝数 | ${aggregate.currentTmWins} | ${aggregate.shadowTmWins} |
| TM首位複勝数 | ${aggregate.currentTmPlaces} | ${aggregate.shadowTmPlaces} |

## 採用ゲート

| 条件 | 判定 | 実測 |
|---|---|---|
${criteria.map(([label, pass, actual]) => `| ${label} | ${pass ? "PASS" : "WAIT/FAIL"} | ${actual} |`).join("\n")}
`;
mkdirSync(dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, report, "utf8");
console.log(JSON.stringify({ output: OUTPUT, status, pendingDates, ...aggregate }, null, 2));
