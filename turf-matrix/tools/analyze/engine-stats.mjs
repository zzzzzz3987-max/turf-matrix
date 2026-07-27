#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TOOLS_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const REPO_ROOT = join(TOOLS_DIR, "..");
const ARCHIVE_DIR = join(REPO_ROOT, "data", "archive");
const OUTPUT_DIR = join(REPO_ROOT, "docs", "analysis");

const ENGINES = [
  ["ability", "Ability"],
  ["blood", "Blood"],
  ["training", "Training"],
  ["course", "Course"],
  ["pace", "Pace"],
  ["stable", "Stable"],
  ["form", "Form"],
  ["value", "Value"],
];

const isFiniteNumber = (value) => Number.isFinite(Number(value));
const toNumber = (value) => isFiniteNumber(value) ? Number(value) : null;
const formatNumber = (value, digits = 2) => value == null ? "—" : value.toFixed(digits);
const formatPercent = (hits, total) => total === 0 ? "—" : `${(hits / total * 100).toFixed(1)}%`;

const normalizeHorseName = (value) => String(value ?? "")
  .normalize("NFKC")
  .replace(/[\s\u3000]/g, "")
  .replace(/^[*＊$＄]+/, "");

const parseRaceTime = (value) => {
  const match = String(value ?? "").trim().match(/^(?:(\d+):)?(\d{1,2})\.(\d)$/);
  if (!match) return null;
  return Number(match[1] ?? 0) * 60 + Number(match[2]) + Number(match[3]) / 10;
};

const mean = (values) => values.length === 0
  ? null
  : values.reduce((sum, value) => sum + value, 0) / values.length;

const standardDeviation = (values) => {
  if (values.length === 0) return null;
  const average = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length);
};

const averageRanks = (values) => {
  const sorted = values
    .map((value, index) => ({ value, index }))
    .sort((a, b) => a.value - b.value);
  const ranks = Array(values.length);
  for (let start = 0; start < sorted.length;) {
    let end = start + 1;
    while (end < sorted.length && sorted[end].value === sorted[start].value) end += 1;
    const averageRank = (start + 1 + end) / 2;
    for (let index = start; index < end; index += 1) ranks[sorted[index].index] = averageRank;
    start = end;
  }
  return ranks;
};

const pearson = (left, right) => {
  if (left.length < 3 || left.length !== right.length) return null;
  const leftMean = mean(left);
  const rightMean = mean(right);
  let numerator = 0;
  let leftSum = 0;
  let rightSum = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftDelta = left[index] - leftMean;
    const rightDelta = right[index] - rightMean;
    numerator += leftDelta * rightDelta;
    leftSum += leftDelta ** 2;
    rightSum += rightDelta ** 2;
  }
  const denominator = Math.sqrt(leftSum * rightSum);
  return denominator === 0 ? null : numerator / denominator;
};

const spearman = (pairs) => pearson(
  averageRanks(pairs.map(([left]) => left)),
  averageRanks(pairs.map(([, right]) => right)),
);

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

const resolveArchivePairs = () => readdirSync(ARCHIVE_DIR)
  .map((fileName) => fileName.match(/^(\d{4}-\d{2}-\d{2})-preodds\.json$/)?.[1])
  .filter(Boolean)
  .sort()
  .map((date) => ({
    date,
    snapshotPath: join(ARCHIVE_DIR, `${date}-preodds.json`),
    resultsPath: join(ARCHIVE_DIR, `${date}-results.json`),
  }))
  .filter(({ resultsPath }) => existsSync(resultsPath));

const findResultRace = (snapshotRace, resultRaces) => resultRaces.find((race) => (
  race.bundleId === snapshotRace.bundleId
));

const findResultHorse = (snapshotHorse, resultHorses) => {
  const horseNumber = Number(snapshotHorse.number ?? snapshotHorse.horseNumber);
  const expectedName = normalizeHorseName(snapshotHorse.name ?? snapshotHorse.horseName);
  const byNumber = resultHorses.find((horse) => Number(horse.horseNumber) === horseNumber);
  if (!byNumber || normalizeHorseName(byNumber.horseName) !== expectedName) return null;
  return byNumber;
};

const collect = (pairs) => {
  const records = [];
  const races = [];
  const warnings = [];
  let skippedRaceCount = 0;
  let skippedHorseCount = 0;

  for (const pair of pairs) {
    const snapshot = readJson(pair.snapshotPath);
    const results = readJson(pair.resultsPath);
    for (const snapshotRace of snapshot.races ?? []) {
      const resultRace = findResultRace(snapshotRace, results.races ?? []);
      if (!resultRace) {
        skippedRaceCount += 1;
        warnings.push(`${pair.date} ${snapshotRace.bundleId}: 確定結果レース未検出`);
        continue;
      }

      const winner = (resultRace.horses ?? []).find((horse) => Number(horse.finishPosition) === 1);
      const winnerTime = parseRaceTime(winner?.time);
      const raceRecords = [];

      for (const snapshotHorse of snapshotRace.horses ?? []) {
        const resultHorse = findResultHorse(snapshotHorse, resultRace.horses ?? []);
        if (!resultHorse) {
          skippedHorseCount += 1;
          warnings.push(`${pair.date} ${snapshotRace.bundleId} ${snapshotHorse.number} ${snapshotHorse.name}: 馬番・馬名JOIN失敗`);
          continue;
        }
        const finishPosition = toNumber(resultHorse.finishPosition);
        const raceTime = parseRaceTime(resultHorse.time);
        const marginSeconds = winnerTime != null && raceTime != null
          ? Math.max(0, Number((raceTime - winnerTime).toFixed(1)))
          : null;
        const factors = Object.fromEntries(ENGINES.map(([key]) => [
          key,
          toNumber(snapshotHorse.analysis?.factorsDetail?.[key]?.score),
        ]));
        const record = {
          date: pair.date,
          bundleId: snapshotRace.bundleId,
          raceName: snapshotRace.name,
          horseNumber: Number(snapshotHorse.number),
          horseName: snapshotHorse.name,
          tmIndex: toNumber(snapshotHorse.tmIndex),
          indexRank: toNumber(snapshotHorse.analysis?.relative?.rank),
          finishPosition,
          marginSeconds,
          factors,
        };
        raceRecords.push(record);
        if (finishPosition != null) records.push(record);
      }

      if (raceRecords.length === 0) {
        skippedRaceCount += 1;
        continue;
      }
      races.push({
        date: pair.date,
        bundleId: snapshotRace.bundleId,
        raceName: snapshotRace.name,
        records: raceRecords,
      });
    }
  }

  return { records, races, warnings, skippedRaceCount, skippedHorseCount };
};

const calculateEngineStats = (records) => ENGINES.map(([key, label]) => {
  const scored = records.filter((record) => record.factors[key] != null);
  const values = scored.map((record) => record.factors[key]);
  const finishPairs = scored.map((record) => [record.factors[key], record.finishPosition]);
  const marginPairs = scored
    .filter((record) => record.marginSeconds != null)
    .map((record) => [record.factors[key], record.marginSeconds]);
  const minimum = values.length ? Math.min(...values) : null;
  const maximum = values.length ? Math.max(...values) : null;
  return {
    key,
    label,
    count: values.length,
    average: mean(values),
    sd: standardDeviation(values),
    minimum,
    maximum,
    range: minimum == null ? null : maximum - minimum,
    finishCorrelation: spearman(finishPairs),
    marginCorrelation: spearman(marginPairs),
    marginCount: marginPairs.length,
  };
});

const selectRanked = (race) => [...race.records]
  .filter((record) => record.tmIndex != null)
  .sort((left, right) => (
    (left.indexRank ?? Number.MAX_SAFE_INTEGER) - (right.indexRank ?? Number.MAX_SAFE_INTEGER)
    || right.tmIndex - left.tmIndex
    || left.horseNumber - right.horseNumber
  ));

const selectAtIndexRank = (race, rank) => {
  const ranked = selectRanked(race);
  return ranked.find((record) => record.indexRank === rank) ?? ranked[rank - 1] ?? null;
};

const calculateRankStats = (races) => [1, 2, 3].map((rank) => {
  const selected = races
    .map((race) => selectAtIndexRank(race, rank))
    .filter((record) => record?.finishPosition != null);
  return {
    rank,
    count: selected.length,
    wins: selected.filter((record) => record.finishPosition === 1).length,
    places: selected.filter((record) => record.finishPosition <= 3).length,
  };
});

const GAP_BANDS = [
  { label: "0以上1pt未満", test: (gap) => gap >= 0 && gap < 1 },
  { label: "1以上2pt未満", test: (gap) => gap >= 1 && gap < 2 },
  { label: "2以上3pt未満", test: (gap) => gap >= 2 && gap < 3 },
  { label: "3pt以上", test: (gap) => gap >= 3 },
];

const calculateGapStats = (races) => {
  const observations = races.map((race) => {
    const first = selectAtIndexRank(race, 1);
    const second = selectAtIndexRank(race, 2);
    if (!first || !second || first.finishPosition == null) return null;
    return {
      race: `${race.date} ${race.raceName}`,
      first,
      second,
      gap: first.tmIndex - second.tmIndex,
      firstPlaced: first.finishPosition <= 3,
    };
  }).filter(Boolean);

  return GAP_BANDS.map((band) => {
    const selected = observations.filter(({ gap }) => band.test(gap));
    return {
      label: band.label,
      count: selected.length,
      firstPlaced: selected.filter(({ firstPlaced }) => firstPlaced).length,
    };
  });
};

const median = (values) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
};

const buildFindings = (engineStats, gapStats) => {
  const bySd = [...engineStats].filter((item) => item.sd != null).sort((a, b) => b.sd - a.sd);
  const largestSd = bySd[0];
  const medianRange = median(engineStats.map((item) => item.range).filter((value) => value != null));
  const medianAbsCorrelation = median(engineStats
    .map((item) => item.finishCorrelation == null ? null : Math.abs(item.finishCorrelation))
    .filter((value) => value != null));
  const disruptors = engineStats.filter((item) => (
    item.range >= medianRange && Math.abs(item.finishCorrelation ?? 0) <= medianAbsCorrelation
  ));
  const populatedGaps = gapStats.filter((item) => item.count > 0);
  const narrow = populatedGaps[0];
  const wider = populatedGaps.at(-1);
  const gapConclusion = populatedGaps.length < 2
    ? "比較可能な差帯が2区分未満のため判定不能"
    : narrow.firstPlaced / narrow.count < wider.firstPlaced / wider.count
      ? "小さい差帯ほど1位複勝率が低い傾向を観測"
      : "小さい差帯ほど低下する傾向は現サンプルでは未確認";

  return {
    largestSd,
    disruptors,
    medianRange,
    medianAbsCorrelation,
    gapConclusion,
  };
};

const renderReport = ({ pairs, collected, engineStats, rankStats, gapStats, findings, outputDate }) => {
  const engineRows = engineStats.map((item) => (
    `| ${item.label} | ${item.count} | ${formatNumber(item.average)} | ${formatNumber(item.sd)} | ${formatNumber(item.minimum, 0)} | ${formatNumber(item.maximum, 0)} | ${formatNumber(item.range, 0)} |`
  )).join("\n");
  const correlationRows = engineStats.map((item) => (
    `| ${item.label} | ${item.count} | ${formatNumber(item.finishCorrelation, 3)} | ${item.marginCount} | ${formatNumber(item.marginCorrelation, 3)} |`
  )).join("\n");
  const rankRows = rankStats.map((item) => (
    `| ${item.rank}位 | ${item.count} | ${item.wins} | ${formatPercent(item.wins, item.count)} | ${item.places} | ${formatPercent(item.places, item.count)} |`
  )).join("\n");
  const gapRows = gapStats.map((item) => (
    `| ${item.label} | ${item.count} | ${item.firstPlaced} | ${formatPercent(item.firstPlaced, item.count)} |`
  )).join("\n");
  const disruptorText = findings.disruptors.length
    ? findings.disruptors.map((item) => `${item.label}（range ${formatNumber(item.range, 0)} / ρ ${formatNumber(item.finishCorrelation, 3)}）`).join("、")
    : "該当なし";
  const warningList = collected.warnings.length
    ? collected.warnings.map((warning) => `- ${warning}`).join("\n")
    : "- なし";

  return `# Engine Statistics ${outputDate}

## 対象

- 公開スナップショット・確定結果ペア: ${pairs.length}日分（${pairs.map(({ date }) => date).join("、")}）
- 対象レース: ${collected.races.length}
- 対象馬: ${collected.records.length}
- 着順データなしでスキップしたレース: ${collected.skippedRaceCount}
- JOINできずスキップした馬: ${collected.skippedHorseCount}

> **サンプル注意:** 現状は${collected.races.length}レース・${collected.records.length}頭の初期集計です。係数変更や重み最適化を決定できる量ではありません。本レポートは分散と撹乱源候補の計測に限定し、最低100〜300頭・複数週の蓄積後に再検証します。

## 集計方法

- エンジン値は公開時スナップショットの\`analysis.factorsDetail.<engine>.score\`を使用。
- 着順は確定結果の数値着順を使用。除外・中止は着順相関から除外。
- 着差は各馬の走破時計から同レース勝ち馬の走破時計を引いた秒数。時計欠損は着差相関から除外。
- 相関は同順位に平均順位を与えたSpearman順位相関。
- 高スコアほど着順・着差が小さい想定のため、**負の相関ほど期待方向に強い**。
- 標準偏差は対象母集団の母標準偏差（N除算）。

## 1. エンジンスコア分布

| Engine | n | 平均 | 標準偏差 | 最小 | 最大 | レンジ |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
${engineRows}

## 2. 着順・着差とのSpearman相関

| Engine | 着順n | ρ（着順） | 着差n | ρ（着差） |
| --- | ---: | ---: | ---: | ---: |
${correlationRows}

## 3. TM INDEX 1位−2位差と1位複勝率

差帯は重複を避けるため、0〜1ptを「0以上1未満」、1〜2ptを「1以上2未満」として扱います。

| 1位−2位差 | レース数 | 1位3着内 | 1位複勝率 |
| --- | ---: | ---: | ---: |
${gapRows}

**検証所見:** ${findings.gapConclusion}。ただし各帯のレース数が少なく、現時点では仮説の採否を決めません。

## 4. TM INDEX順位別成績

| INDEX順位 | 対象 | 1着 | 勝率 | 3着内 | 複勝率 |
| --- | ---: | ---: | ---: | ---: | ---: |
${rankRows}

## 自動所見

### 標準偏差が最大のエンジン

**${findings.largestSd?.label ?? "該当なし"}**（SD ${formatNumber(findings.largestSd?.sd)} / range ${formatNumber(findings.largestSd?.range, 0)}）。分散が大きいことだけで撹乱源とは断定できませんが、順位への影響が相対的に強い可能性があります。

### 対着順相関が弱く、レンジが大きい候補

${disruptorText}

候補判定は「レンジが8エンジンの中央値以上」かつ「|対着順ρ|が中央値以下」という初期ヒューリスティックです。サンプル増加後に再判定します。

### 僅差帯の非情報性

${findings.gapConclusion}。18レース規模では帯別件数が小さいため、結論ではなく継続観測対象です。

## スキップ・警告

${warningList}

## 結論

本レポートはSprint 1（計測）のみを実施したものです。TM INDEX、各エンジンの重み、正規化、タイブレーク、Valueロジックは変更していません。
`;
};

const main = () => {
  if (!existsSync(ARCHIVE_DIR)) throw new Error(`Archive directory was not found: ${ARCHIVE_DIR}`);
  const pairs = resolveArchivePairs();
  if (pairs.length === 0) throw new Error("No publication snapshot/result pairs were found in data/archive");

  const collected = collect(pairs);
  if (collected.races.length === 0 || collected.records.length === 0) {
    throw new Error("No completed races with matched horse results were available for analysis");
  }

  const engineStats = calculateEngineStats(collected.records);
  const rankStats = calculateRankStats(collected.races);
  const gapStats = calculateGapStats(collected.races);
  const findings = buildFindings(engineStats, gapStats);
  const outputDate = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
  const report = renderReport({ pairs, collected, engineStats, rankStats, gapStats, findings, outputDate });

  mkdirSync(OUTPUT_DIR, { recursive: true });
  const outputPath = join(OUTPUT_DIR, `engine-stats-${outputDate}.md`);
  writeFileSync(outputPath, report, "utf8");

  console.log(`[analyze:engines] snapshots/results: ${pairs.length}`);
  console.log(`[analyze:engines] analyzed races: ${collected.races.length}`);
  console.log(`[analyze:engines] analyzed horses: ${collected.records.length}`);
  console.log(`[analyze:engines] skipped races: ${collected.skippedRaceCount}`);
  console.log(`[analyze:engines] skipped horses: ${collected.skippedHorseCount}`);
  console.log(`[analyze:engines] report: ${outputPath}`);
  console.log(`[analyze:engines] largest SD: ${findings.largestSd?.label ?? "n/a"} (${formatNumber(findings.largestSd?.sd)})`);
  console.log(`[analyze:engines] gap finding: ${findings.gapConclusion}`);
};

try {
  main();
} catch (error) {
  console.error(`[analyze:engines] ${error.message}`);
  process.exit(1);
}
