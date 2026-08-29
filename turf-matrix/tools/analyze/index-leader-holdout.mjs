#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  INDEX_LEADER_COMPARATOR_CONFIG,
  INDEX_LEADER_FACTORS,
  applyIndexLeaderComparator,
  buildStandardizer,
  trainIndexLeaderComparator,
} from "./lib/index-leader-comparator.mjs";
import { collectHistoricalComparisons, resolveArchivePairs } from "./lib/index-leader-history.mjs";

const ANALYZE_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(ANALYZE_DIR, "..", "..");
const ARCHIVE_DIR = join(ROOT, "data", "archive");
const OUTPUT_DATE = "2026-08-28";
const OUTPUT = join(ROOT, "docs", "analysis", `index-leader-holdout-${OUTPUT_DATE}.md`);
const HOLDOUT_DATE_COUNT = 3;
const WALK_FORWARD_SEED_DATES = 4;
const {
  maxGapToReview: MAX_GAP_TO_REVIEW,
  swapProbability: SWAP_PROBABILITY,
  ridgeLambda: RIDGE_LAMBDA,
} = INDEX_LEADER_COMPARATOR_CONFIG;
const FACTORS = INDEX_LEADER_FACTORS;

const finite = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
const number = (value) => finite(value) ? Number(value) : null;
const pct = (hits, count) => count ? `${(hits / count * 100).toFixed(1)}%` : "—";
const signed = (value, digits = 1) => value == null ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;
const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

const createStats = (rows, selector) => {
  const selections = rows.map((row) => ({ row, horse: selector(row) })).filter((item) => item.horse);
  return {
    count: selections.length,
    wins: selections.filter(({ horse }) => horse.finish === 1).length,
    places: selections.filter(({ horse }) => horse.finish <= 3).length,
    beatsOther: selections.filter(({ row, horse }) => {
      const other = horse === row.leader ? row.second : row.leader;
      return horse.finish < other.finish;
    }).length,
  };
};

const compareStats = (rows) => ({
  current: createStats(rows, (row) => row.leader),
  second: createStats(rows, (row) => row.second),
  model: createStats(rows, (row) => row.selected),
  swaps: rows.filter((row) => row.swap).length,
});

const archivePairs = resolveArchivePairs(ARCHIVE_DIR);
if (archivePairs.length <= HOLDOUT_DATE_COUNT) throw new Error("Not enough archive dates for a time-based holdout");
const dates = archivePairs.map((pair) => pair.date);
const trainDates = dates.slice(0, -HOLDOUT_DATE_COUNT);
const holdoutDates = dates.slice(-HOLDOUT_DATE_COUNT);
const collected = collectHistoricalComparisons(archivePairs);
const trainRows = collected.rows.filter((row) => trainDates.includes(row.date));
const holdoutRows = collected.rows.filter((row) => holdoutDates.includes(row.date));
const trainEligible = trainRows.filter((row) => row.complete && row.gap <= MAX_GAP_TO_REVIEW && row.leader.finish !== row.second.finish);
const standardizer = buildStandardizer(trainEligible);
const model = trainIndexLeaderComparator(trainEligible, standardizer);
const modeledTrain = applyIndexLeaderComparator(trainRows, model, standardizer);
const modeledHoldout = applyIndexLeaderComparator(holdoutRows, model, standardizer);
const trainStats = compareStats(modeledTrain);
const holdoutStats = compareStats(modeledHoldout);

const walkForwardFolds = dates.slice(WALK_FORWARD_SEED_DATES).map((testDate, index) => {
  const foldTrainDates = dates.slice(0, WALK_FORWARD_SEED_DATES + index);
  const foldTrainRows = collected.rows.filter((row) => foldTrainDates.includes(row.date));
  const foldTestRows = collected.rows.filter((row) => row.date === testDate);
  const eligible = foldTrainRows.filter((row) => row.complete && row.gap <= MAX_GAP_TO_REVIEW && row.leader.finish !== row.second.finish);
  const foldStandardizer = buildStandardizer(eligible);
  const foldModel = trainIndexLeaderComparator(eligible, foldStandardizer);
  const modeled = applyIndexLeaderComparator(foldTestRows, foldModel, foldStandardizer);
  return {
    testDate,
    trainDateCount: foldTrainDates.length,
    trainRaceCount: foldTrainRows.length,
    eligibleCount: eligible.length,
    modeled,
    stats: compareStats(modeled),
  };
});
const walkForwardRows = walkForwardFolds.flatMap((fold) => fold.modeled);
const walkForwardStats = compareStats(walkForwardRows);

const factorRows = FACTORS.map((key, index) => {
  const secondAhead = trainEligible.filter((row) => row.secondAhead).map((row) => row.featureDeltas[key]);
  const leaderAhead = trainEligible.filter((row) => !row.secondAhead).map((row) => row.featureDeltas[key]);
  return {
    key,
    secondAheadMean: mean(secondAhead),
    leaderAheadMean: mean(leaderAhead),
    coefficient: model.weights[index],
  };
});

const improvement = {
  wins: holdoutStats.model.wins - holdoutStats.current.wins,
  places: holdoutStats.model.places - holdoutStats.current.places,
  beatsOther: holdoutStats.model.beatsOther - holdoutStats.current.beatsOther,
};
const acceptance = [
  ["ホールドアウト20レース以上", holdoutRows.length >= 20, `${holdoutRows.length}レース`],
  ["逆転対象3レース以上", holdoutStats.swaps >= 3, `${holdoutStats.swaps}レース`],
  ["逆転率40%以下", holdoutStats.swaps / holdoutRows.length <= 0.4, pct(holdoutStats.swaps, holdoutRows.length)],
  ["指数1位の勝率を維持", holdoutStats.model.wins >= holdoutStats.current.wins, `${holdoutStats.current.wins}勝 → ${holdoutStats.model.wins}勝`],
  ["指数1位の複勝率を維持", holdoutStats.model.places >= holdoutStats.current.places, `${holdoutStats.current.places}頭 → ${holdoutStats.model.places}頭`],
  ["1位・2位間の先着選択率を維持", holdoutStats.model.beatsOther >= holdoutStats.current.beatsOther, `${holdoutStats.current.beatsOther}頭 → ${holdoutStats.model.beatsOther}頭`],
  ["勝数または複勝数が1件以上改善", improvement.wins >= 1 || improvement.places >= 1, `勝 ${signed(improvement.wins, 0)} / 複勝 ${signed(improvement.places, 0)}`],
  ["3点差以上を逆転しない", modeledHoldout.every((row) => row.gap < 3 || !row.swap), "設計で禁止"],
];
const accepted = acceptance.every(([, pass]) => pass);
const walkImprovement = {
  wins: walkForwardStats.model.wins - walkForwardStats.current.wins,
  places: walkForwardStats.model.places - walkForwardStats.current.places,
  beatsOther: walkForwardStats.model.beatsOther - walkForwardStats.current.beatsOther,
};
const walkAcceptance = [
  ["ウォークフォワード50レース以上", walkForwardRows.length >= 50, `${walkForwardRows.length}レース`],
  ["逆転対象5レース以上", walkForwardStats.swaps >= 5, `${walkForwardStats.swaps}レース`],
  ["逆転率40%以下", walkForwardStats.swaps / walkForwardRows.length <= 0.4, pct(walkForwardStats.swaps, walkForwardRows.length)],
  ["指数1位の勝率を維持", walkForwardStats.model.wins >= walkForwardStats.current.wins, `${walkForwardStats.current.wins}勝 → ${walkForwardStats.model.wins}勝`],
  ["指数1位の複勝率を維持", walkForwardStats.model.places >= walkForwardStats.current.places, `${walkForwardStats.current.places}頭 → ${walkForwardStats.model.places}頭`],
  ["1位・2位間の先着選択率を維持", walkForwardStats.model.beatsOther >= walkForwardStats.current.beatsOther, `${walkForwardStats.current.beatsOther}頭 → ${walkForwardStats.model.beatsOther}頭`],
  ["勝数または複勝数が1件以上改善", walkImprovement.wins >= 1 || walkImprovement.places >= 1, `勝 ${signed(walkImprovement.wins, 0)} / 複勝 ${signed(walkImprovement.places, 0)}`],
];
const walkAccepted = walkAcceptance.every(([, pass]) => pass);
const productionCandidate = accepted && walkAccepted;

const statsRows = (label, stats) => [
  `| ${label}・現行1位 | ${stats.current.count} | ${stats.current.wins} | ${pct(stats.current.wins, stats.current.count)} | ${stats.current.places} | ${pct(stats.current.places, stats.current.count)} | ${pct(stats.current.beatsOther, stats.current.count)} | — |`,
  `| ${label}・現行2位 | ${stats.second.count} | ${stats.second.wins} | ${pct(stats.second.wins, stats.second.count)} | ${stats.second.places} | ${pct(stats.second.places, stats.second.count)} | ${pct(stats.second.beatsOther, stats.second.count)} | — |`,
  `| ${label}・比較器 | ${stats.model.count} | ${stats.model.wins} | ${pct(stats.model.wins, stats.model.count)} | ${stats.model.places} | ${pct(stats.model.places, stats.model.count)} | ${pct(stats.model.beatsOther, stats.model.count)} | ${stats.swaps} |`,
].join("\n");

const featureTable = factorRows
  .sort((left, right) => Math.abs(right.coefficient) - Math.abs(left.coefficient))
  .map((row) => `| ${row.key} | ${signed(row.secondAheadMean)} | ${signed(row.leaderAheadMean)} | ${signed(row.coefficient, 3)} |`)
  .join("\n");
const swapRows = modeledHoldout.filter((row) => row.swap)
  .map((row) => `| ${row.date} | ${row.raceName} | ${row.gap} | ${row.leader.name} (${row.leader.finish}着) | ${row.second.name} (${row.second.finish}着) | ${(row.probability * 100).toFixed(1)}% | ${row.second.finish < row.leader.finish ? "成功" : "失敗"} |`)
  .join("\n");
const acceptanceRows = acceptance.map(([label, pass, value]) => `| ${label} | ${pass ? "PASS" : "FAIL"} | ${value} |`).join("\n");
const walkAcceptanceRows = walkAcceptance.map(([label, pass, value]) => `| ${label} | ${pass ? "PASS" : "FAIL"} | ${value} |`).join("\n");
const foldRows = walkForwardFolds.map((fold) => {
  const stats = fold.stats;
  return `| ${fold.testDate} | ${fold.trainDateCount}日 / ${fold.trainRaceCount}R | ${stats.current.wins} → ${stats.model.wins} | ${stats.current.places} → ${stats.model.places} | ${stats.current.beatsOther} → ${stats.model.beatsOther} | ${stats.swaps} |`;
}).join("\n");

const report = `# TM INDEX 1位・2位 時系列ホールドアウト検証 (${OUTPUT_DATE})

## 結論

**本番接続判定: ${productionCandidate ? "PASS（接続候補）" : "FAIL（現行順位を維持）"}**

指数2位を一律に昇格させず、指数差2点以内のときだけAbility / Form / Training / Course / Pace / Blood / Stableの公開時スコア差を比較した。人気・オッズ・Valueは入力していない。

## データ分割

- 分析用: ${trainDates.join("、")}（${trainRows.length}レース）
- ホールドアウト: ${holdoutDates.join("、")}（${holdoutRows.length}レース）
- 分析用の比較器学習対象: ${trainEligible.length}レース
- JOIN等でスキップ: ${collected.skipped}レース
- 分割方式: 日付順。後半3日をモデル構築から完全除外
- 注意: ホールドアウトも${holdoutRows.length}レースの初期標本であり、週次継続検証が必要

## 固定仕様

- 検討対象: TM INDEX差0〜${MAX_GAP_TO_REVIEW}点
- 逆転条件: 分析用データだけで学習した確率が${Math.round(SWAP_PROBABILITY * 100)}%以上
- モデル: L2正則化ロジスティック比較器（lambda ${RIDGE_LAMBDA}）
- 3点差以上: 現行1位を必ず維持
- 人気・オッズ・着順の本番入力: なし

## 成績

| 区分・方式 | 対象 | 1着 | 勝率 | 3着内 | 複勝率 | 相手より先着 | 逆転数 |
|---|---:|---:|---:|---:|---:|---:|---:|
${statsRows("分析用", trainStats)}
${statsRows("ホールドアウト", holdoutStats)}

## 時系列ウォークフォワード

最初の${WALK_FORWARD_SEED_DATES}開催日だけを初期学習に使い、以降は各開催日について「その日より前」だけで比較器を再学習して予測した。これにより${walkForwardRows.length}レースを未来リークなしの実戦形式で検証した。

${statsRows("ウォークフォワード", walkForwardStats)}

| 予測日 | その時点の学習量 | 勝数 現行→比較器 | 複勝数 現行→比較器 | 先着選択 現行→比較器 | 逆転数 |
|---|---:|---:|---:|---:|---:|
${foldRows}

### ウォークフォワード採用基準

| 基準 | 判定 | 実測 |
|---|---|---|
${walkAcceptanceRows}

## 1位と2位を分けた要因（分析用のみ）

差分は「現行2位 − 現行1位」。正の係数は、そのファクターで2位が優位なほど逆転判定を後押しする。

| Factor | 2位が先着した組の平均差 | 1位が先着した組の平均差 | 標準化係数 |
|---|---:|---:|---:|
${featureTable}

## ホールドアウトで逆転したレース

| 日付 | レース | 指数差 | 現行1位 | 現行2位 | 2位先着確率 | 判定 |
|---|---|---:|---|---|---:|---|
${swapRows || "| — | 逆転なし | — | — | — | — | — |"}

## 採用基準

| 基準 | 判定 | 実測 |
|---|---|---|
${acceptanceRows}

## 判定

固定ホールドアウトとウォークフォワードの両方が全基準PASSした場合だけ、公開時の首位選定へ接続を検討する。一つでもFAILなら現行TM INDEX順位を維持する。検証結果を見た閾値・係数の再調整は行わない。
`;

mkdirSync(dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, report);
console.log(JSON.stringify({
  output: OUTPUT,
  trainDates,
  holdoutDates,
  trainRaces: trainRows.length,
  holdoutRaces: holdoutRows.length,
  trainEligible: trainEligible.length,
  trainStats,
  holdoutStats,
  walkForward: {
    races: walkForwardRows.length,
    folds: walkForwardFolds.map((fold) => ({ date: fold.testDate, stats: fold.stats })),
    stats: walkForwardStats,
    accepted: walkAccepted,
  },
  accepted: productionCandidate,
  failedCriteria: acceptance.filter(([, pass]) => !pass).map(([label]) => label),
  failedWalkCriteria: walkAcceptance.filter(([, pass]) => !pass).map(([label]) => label),
}, null, 2));
