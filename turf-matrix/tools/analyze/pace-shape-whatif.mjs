#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  aggregatePaceShapeEvaluation,
  buildRacePaceShapePrediction,
  evaluateRacePaceShapePrediction,
} from "./lib/pace-shape-shadow.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ARCHIVE_DIR = join(ROOT, "data", "archive");
const HISTORY_PATH = join(ROOT, "data", "master", "race-shape-history.json");
const OUTPUT = join(ROOT, "docs", "analysis", "pace-shape-whatif-2026-09-02.md");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
const pct = (value) => Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : "-";
const history = readJson(HISTORY_PATH);
const dates = readdirSync(ARCHIVE_DIR)
  .map((name) => name.match(/^(\d{4}-\d{2}-\d{2})-preodds\.json$/)?.[1])
  .filter(Boolean)
  .filter((date) => existsSync(join(ARCHIVE_DIR, `${date}-results.json`)))
  .sort();

const evaluated = [];
const missed = [];
for (const date of dates) {
  const snapshot = readJson(join(ARCHIVE_DIR, `${date}-preodds.json`));
  const results = readJson(join(ARCHIVE_DIR, `${date}-results.json`));
  const byBundle = new Map((results.races ?? []).map((race) => [race.bundleId, race]));
  for (const race of snapshot.races ?? []) {
    const prediction = buildRacePaceShapePrediction(race, history);
    const result = evaluateRacePaceShapePrediction(prediction, byBundle.get(race.bundleId));
    if (!result) missed.push(`${date} ${race.track}${race.number}R`);
    else evaluated.push({ ...result, date });
  }
}

const aggregate = aggregatePaceShapeEvaluation(evaluated);
const criteria = [
  ["評価100レース以上", aggregate.raceCount >= 100, `${aggregate.raceCount}レース`],
  ["補正発火30レース以上", aggregate.adjustedRaceCount >= 30, `${aggregate.adjustedRaceCount}レース`],
  ["Pace首位変更5レース以上", aggregate.paceLeaderChangedRaceCount >= 5, `${aggregate.paceLeaderChangedRaceCount}レース`],
  ["Pace pairwiseを維持", (aggregate.shadowPacePairwiseRate ?? 0) >= (aggregate.currentPacePairwiseRate ?? 0), `${pct(aggregate.currentPacePairwiseRate)}→${pct(aggregate.shadowPacePairwiseRate)}`],
  ["Pace首位勝数を維持", aggregate.shadowPaceWins >= aggregate.currentPaceWins, `${aggregate.currentPaceWins}→${aggregate.shadowPaceWins}`],
  ["Pace首位複勝数を維持", aggregate.shadowPacePlaces >= aggregate.currentPacePlaces, `${aggregate.currentPacePlaces}→${aggregate.shadowPacePlaces}`],
  ["勝数または複勝数を改善", aggregate.shadowPaceWins > aggregate.currentPaceWins || aggregate.shadowPacePlaces > aggregate.currentPacePlaces, `勝${aggregate.shadowPaceWins - aggregate.currentPaceWins >= 0 ? "+" : ""}${aggregate.shadowPaceWins - aggregate.currentPaceWins} / 複${aggregate.shadowPacePlaces - aggregate.currentPacePlaces >= 0 ? "+" : ""}${aggregate.shadowPacePlaces - aggregate.currentPacePlaces}`],
  ["最大Pace補正2点以内", aggregate.maxAbsAdjustment <= 2, `${aggregate.maxAbsAdjustment}点`],
];
const pass = criteria.every(([, value]) => value);
const dayRows = dates.map((date) => {
  const day = aggregatePaceShapeEvaluation(evaluated.filter((race) => race.date === date));
  return `| ${date} | ${day.raceCount} | ${day.adjustedRaceCount} | ${day.paceLeaderChangedRaceCount} | ${day.currentPaceWins}→${day.shadowPaceWins} | ${day.currentPacePlaces}→${day.shadowPacePlaces} |`;
}).join("\n");
const changedRows = evaluated.filter((race) => race.paceLeaderChanged).map((race) =>
  `| ${race.date} | ${race.track}${race.raceNumber}R ${race.raceName} | ${race.currentPaceLeader.name} (${race.currentPaceLeader.finish}着) | ${race.shadowPaceLeader.name} (${race.shadowPaceLeader.finish}着・${race.shadowPaceLeader.paceAdjustment >= 0 ? "+" : ""}${race.shadowPaceLeader.paceAdjustment}) |`
).join("\n");

const report = `# Pace Race Shape what-if (2026-09-02)

## 結論

**過去診断: ${pass ? "PASS" : "FAIL"} / 本番接続: HOLD**

実ラップは未取得のため、全馬の角位置と着順から「前崩れ・前残り・中立」を判定するrace-shape proxyとして評価した。ハイ・スローの実測値とは呼ばない。

## 履歴

- 採用レース: ${history.summary.raceCount}レース
- 前崩れ: ${history.summary.counts.front_collapse} / 前残り: ${history.summary.counts.front_survival} / 中立: ${history.summary.counts.neutral}
- 不完全レース除外: ${history.summary.skippedWithoutCorners}
- 人気・オッズ・Value: 不使用
- レースラップ: 未取得

## 補正

- 前崩れで前方から踏ん張った走り、前残りを後方から押し上げた走りをプラス評価。
- 流れの恩恵を受けた3着内好走は1点だけ割り引く。
- 1走だけのEvidenceは60%へ縮小し、Pace補正は最大±2点。
- 現行の今回レース脚質構成、Pace weight 3%、TM INDEX算式は変更しない。

## 実測

| 指標 | 現行 | 影評価 |
|---|---:|---:|
| 対象 | ${aggregate.raceCount}レース / ${aggregate.horseCount}頭 | 同左 |
| race-shape照合 | - | ${aggregate.matchedRaceCount}レース / ${aggregate.matchedHorseCount}頭 |
| 補正発火 | - | ${aggregate.adjustedRaceCount}レース / ${aggregate.adjustedHorseCount}頭 |
| Pace pairwise | ${pct(aggregate.currentPacePairwiseRate)} | ${pct(aggregate.shadowPacePairwiseRate)} |
| Pace首位勝数 | ${aggregate.currentPaceWins} | ${aggregate.shadowPaceWins} |
| Pace首位複勝数 | ${aggregate.currentPacePlaces} | ${aggregate.shadowPacePlaces} |
| Pace首位変更 | - | ${aggregate.paceLeaderChangedRaceCount}レース |
| TM首位変更 | - | ${aggregate.tmLeaderChangedRaceCount}レース |
| 最大補正 | - | ${aggregate.maxAbsAdjustment}点 |

## 日別

| 日付 | レース | 補正発火R | Pace首位変更 | 勝数 | 複勝数 |
|---|---:|---:|---:|---:|---:|
${dayRows}

## Pace首位変更

| 日付 | レース | 現行首位 | 影首位 |
|---|---|---|---|
${changedRows || "| - | - | - | - |"}

## 診断ゲート

| 条件 | 判定 | 実測 |
|---|---|---|
${criteria.map(([label, value, actual]) => `| ${label} | ${value ? "PASS" : "FAIL"} | ${actual} |`).join("\n")}

過去診断の結果を見て係数や閾値は変更しない。次回以降は公開前に同じ算式を凍結し、結果取得後だけ採用可否を評価する。
`;
mkdirSync(dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, report, "utf8");
console.log(JSON.stringify({ output: OUTPUT, pass, missed: missed.length, ...aggregate }, null, 2));
