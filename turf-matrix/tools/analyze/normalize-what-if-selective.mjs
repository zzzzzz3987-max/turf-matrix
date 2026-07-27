#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { weightsFor } from "../intelligence/tm-index-engine.mjs";

const TOOLS_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const REPO_ROOT = join(TOOLS_DIR, "..");
const ARCHIVE_DIR = join(REPO_ROOT, "data", "archive");
const OUTPUT_DIR = join(REPO_ROOT, "docs", "analysis");

const INDEX_ENGINES = ["ability", "form", "distance", "course", "training", "blood", "pace"];
const SELECTIVE_ENGINES = new Set(["course", "training", "pace"]);
const REFERENCE_ENGINES = ["ability", "form"];
const LABELS = {
  ability: "Ability",
  form: "Form",
  distance: "Distance",
  course: "Course",
  training: "Training",
  blood: "Blood",
  pace: "Pace",
};
const REQUIRED_HORSES = ["ワタシマツワ", "ライフセービング", "ライヴスプーン", "マテンロウコマンド"];

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const finite = (value) => Number.isFinite(Number(value));
const numberOrNull = (value) => finite(value) ? Number(value) : null;
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const mean = (values) => values.length
  ? values.reduce((sum, value) => sum + value, 0) / values.length
  : null;
const sd = (values) => {
  const average = mean(values);
  return average == null
    ? null
    : Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length);
};
const median = (values) => {
  const sorted = values.filter(finite).map(Number).sort((left, right) => left - right);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const format = (value, digits = 3) => value == null ? "—" : Number(value).toFixed(digits);
const percent = (hits, total) => total ? `${(hits / total * 100).toFixed(1)}%` : "—";

const normalizeHorseName = (value) => String(value ?? "")
  .normalize("NFKC")
  .replace(/[\s\u3000]/g, "")
  .replace(/^[*＊$]+/, "");

const averageRanks = (values) => {
  const sorted = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const ranks = Array(values.length);
  for (let start = 0; start < sorted.length;) {
    let end = start + 1;
    while (end < sorted.length && sorted[end].value === sorted[start].value) end += 1;
    const rank = (start + 1 + end) / 2;
    for (let index = start; index < end; index += 1) ranks[sorted[index].index] = rank;
    start = end;
  }
  return ranks;
};

const pearson = (left, right) => {
  if (left.length < 3 || left.length !== right.length) return null;
  const leftMean = mean(left);
  const rightMean = mean(right);
  let numerator = 0;
  let leftSquares = 0;
  let rightSquares = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftDelta = left[index] - leftMean;
    const rightDelta = right[index] - rightMean;
    numerator += leftDelta * rightDelta;
    leftSquares += leftDelta ** 2;
    rightSquares += rightDelta ** 2;
  }
  const denominator = Math.sqrt(leftSquares * rightSquares);
  return denominator ? numerator / denominator : null;
};

const spearman = (pairs) => pearson(
  averageRanks(pairs.map(([left]) => left)),
  averageRanks(pairs.map(([, right]) => right)),
);

const resolvePairs = () => readdirSync(ARCHIVE_DIR)
  .map((fileName) => fileName.match(/^(\d{4}-\d{2}-\d{2})-preodds\.json$/)?.[1])
  .filter(Boolean)
  .sort()
  .map((date) => ({
    date,
    snapshot: join(ARCHIVE_DIR, `${date}-preodds.json`),
    results: join(ARCHIVE_DIR, `${date}-results.json`),
  }))
  .filter(({ results }) => existsSync(results));

const factorScore = (horse, key) => numberOrNull(horse.analysis?.factorsDetail?.[key]?.score);

const collectRaces = (pairs) => {
  const races = [];
  const warnings = [];
  for (const pair of pairs) {
    const snapshot = readJson(pair.snapshot);
    const results = readJson(pair.results);
    for (const race of snapshot.races ?? []) {
      const resultRace = (results.races ?? []).find((item) => item.bundleId === race.bundleId);
      if (!resultRace) {
        warnings.push(`${pair.date} ${race.bundleId}: 確定結果未検出`);
        continue;
      }
      const horses = (race.horses ?? []).map((horse) => {
        const number = Number(horse.number ?? horse.horseNumber);
        const name = horse.name ?? horse.horseName;
        const result = (resultRace.horses ?? []).find((item) => (
          Number(item.horseNumber) === number
          && normalizeHorseName(item.horseName) === normalizeHorseName(name)
        ));
        if (!result) {
          warnings.push(`${pair.date} ${race.bundleId} ${number} ${name}: 結果JOIN失敗`);
          return null;
        }
        return {
          number,
          name,
          currentIndex: numberOrNull(horse.tmIndex),
          currentRank: numberOrNull(horse.analysis?.relative?.rank),
          finish: numberOrNull(result.finishPosition),
          scores: Object.fromEntries(INDEX_ENGINES.map((key) => [key, factorScore(horse, key)])),
          sampleAdjustment: numberOrNull(horse.analysis?.sampleAdjustment) ?? 0,
          goingAdjustment: numberOrNull(horse.analysis?.goingAdjustment) ?? 0,
        };
      }).filter(Boolean);
      if (horses.length) {
        races.push({
          date: pair.date,
          bundleId: race.bundleId,
          name: race.name,
          track: race.track,
          number: race.number,
          surface: race.surface || "未取得",
          going: race.going || "未取得",
          category: race.category || "unknown",
          horses,
        });
      }
    }
  }
  return { races, warnings };
};

const buildBasis = (races) => {
  const basis = {};
  for (const surface of [...new Set(races.map((race) => race.surface))].sort()) {
    const horses = races.filter((race) => race.surface === surface).flatMap((race) => race.horses);
    const engines = Object.fromEntries(INDEX_ENGINES.map((key) => {
      const values = horses.map((horse) => horse.scores[key]).filter(finite).map(Number);
      return [key, { n: values.length, mean: mean(values), sd: sd(values) }];
    }));
    basis[surface] = {
      engines,
      targetSd: median(REFERENCE_ENGINES.map((key) => engines[key].sd)),
    };
  }
  return basis;
};

const weightedIndex = (scores, context) => {
  const weights = weightsFor(context);
  const available = Object.entries(weights).filter(([key]) => finite(scores[key]));
  const totalWeight = available.reduce((sum, [, weight]) => sum + weight, 0);
  if (!totalWeight) return null;
  const weighted = available.reduce((sum, [key, weight]) => sum + Number(scores[key]) * weight, 0) / totalWeight;
  return Math.round(clamp(weighted + 8, 45, 92));
};

const rankRace = (horses, indexKey, abilityKey) => {
  const order = [...horses].sort((left, right) => (
    right[indexKey] - left[indexKey]
    || right[abilityKey] - left[abilityKey]
    || left.number - right.number
  ));
  return new Map(order.map((horse, index) => [horse.number, index + 1]));
};

const calculateCandidates = (races, basis) => races.map((race) => {
  const surfaceBasis = basis[race.surface];
  const weights = weightsFor({ category: race.category });
  const prepared = race.horses.map((horse) => {
    const abilityStats = surfaceBasis.engines.ability;
    const abilityZ = finite(horse.scores.ability) && abilityStats.sd
      ? clamp((horse.scores.ability - abilityStats.mean) / abilityStats.sd, -3, 3)
      : 0;
    const selectiveScores = Object.fromEntries(INDEX_ENGINES.map((key) => {
      const score = horse.scores[key];
      if (!SELECTIVE_ENGINES.has(key)) return [key, score];
      const stats = surfaceBasis.engines[key];
      const z = finite(score) && stats.sd ? clamp((score - stats.mean) / stats.sd, -3, 3) : 0;
      return [key, stats.mean + z * surfaceBasis.targetSd];
    }));
    const selectiveBase = weightedIndex(selectiveScores, { category: race.category });
    const selectiveIndex = selectiveBase == null
      ? null
      : Math.round(clamp(selectiveBase + horse.sampleAdjustment + horse.goingAdjustment, 45, 92));

    const fullContributions = Object.fromEntries(INDEX_ENGINES.map((key) => {
      const stats = surfaceBasis.engines[key];
      const score = horse.scores[key];
      const z = finite(score) && stats.sd ? clamp((score - stats.mean) / stats.sd, -3, 3) : 0;
      return [key, (weights[key] ?? 0) * z];
    }));
    const fullRaw = Object.values(fullContributions).reduce((sum, value) => sum + value, 0);
    return { ...horse, abilityZ, selectiveScores, selectiveIndex, fullRaw };
  });

  const fullMinimum = Math.min(...prepared.map((horse) => horse.fullRaw));
  const fullMaximum = Math.max(...prepared.map((horse) => horse.fullRaw));
  const scored = prepared.map((horse) => {
    const fullBase = fullMaximum === fullMinimum
      ? 70
      : 50 + (horse.fullRaw - fullMinimum) / (fullMaximum - fullMinimum) * 40;
    const fullIndex = Math.round(clamp(
      fullBase + horse.sampleAdjustment + horse.goingAdjustment,
      45,
      92,
    ));
    return { ...horse, fullIndex };
  });
  const selectiveRanks = rankRace(scored, "selectiveIndex", "abilityZ");
  const fullRanks = rankRace(scored, "fullIndex", "abilityZ");
  return {
    ...race,
    horses: scored.map((horse) => ({
      ...horse,
      selectiveRank: selectiveRanks.get(horse.number),
      fullRank: fullRanks.get(horse.number),
    })),
  };
});

const metricsFor = (races, rankKey) => {
  const rankRows = [1, 2, 3].map((rank) => {
    const horses = races.map((race) => race.horses.find((horse) => horse[rankKey] === rank))
      .filter((horse) => horse?.finish != null);
    return {
      rank,
      n: horses.length,
      wins: horses.filter((horse) => horse.finish === 1).length,
      places: horses.filter((horse) => horse.finish <= 3).length,
    };
  });
  const winnerTop3 = races.filter((race) => race.horses.some((horse) => (
    horse.finish === 1 && horse[rankKey] <= 3
  ))).length;
  const pairs = races.flatMap((race) => race.horses
    .filter((horse) => horse.finish != null && horse[rankKey] != null)
    .map((horse) => [horse[rankKey], horse.finish]));
  return {
    rankRows,
    winnerTop3,
    top3Selections: rankRows.reduce((sum, row) => sum + row.n, 0),
    top3Places: rankRows.reduce((sum, row) => sum + row.places, 0),
    spearman: spearman(pairs),
  };
};

const breakdown = (races, key) => [...new Set(races.map((race) => race[key]))]
  .sort()
  .map((value) => {
    const subset = races.filter((race) => race[key] === value);
    return {
      value,
      races: subset.length,
      current: metricsFor(subset, "currentRank"),
      full: metricsFor(subset, "fullRank"),
      selective: metricsFor(subset, "selectiveRank"),
    };
  });

const metricSummary = (metrics) => ({
  top1Wins: metrics.rankRows[0].wins,
  top1Places: metrics.rankRows[0].places,
  winnerTop3: metrics.winnerTop3,
  top3Places: metrics.top3Places,
  spearman: metrics.spearman,
});

const buildReport = ({ pairs, races, basis, warnings, reportDate }) => {
  const current = metricsFor(races, "currentRank");
  const full = metricsFor(races, "fullRank");
  const selective = metricsFor(races, "selectiveRank");
  const currentSummary = metricSummary(current);
  const selectiveSummary = metricSummary(selective);
  const turf = races.filter((race) => race.surface === "芝");
  const special = races.filter((race) => race.category === "special");
  const currentTurf = metricsFor(turf, "currentRank");
  const selectiveTurf = metricsFor(turf, "selectiveRank");
  const currentSpecial = metricsFor(special, "currentRank");
  const selectiveSpecial = metricsFor(special, "selectiveRank");

  const requiredRows = REQUIRED_HORSES.map((name) => {
    const match = races.flatMap((race) => race.horses.map((horse) => ({ race, horse })))
      .find(({ horse }) => normalizeHorseName(horse.name) === normalizeHorseName(name));
    if (!match) return `| ${name} | 未検出 | — | — | — | — | — |`;
    const { race, horse } = match;
    return `| ${horse.name} | ${race.track}${race.number}R ${race.name} | ${horse.currentRank} | ${horse.fullRank} | ${horse.selectiveRank} | ${horse.finish} | ${horse.currentIndex} → ${horse.selectiveIndex} |`;
  }).join("\n");

  const comparisonRows = [0, 1, 2].map((index) => {
    const row = (metrics) => metrics.rankRows[index];
    return `| ${index + 1}位 | ${percent(row(current).wins, row(current).n)} | ${percent(row(full).wins, row(full).n)} | ${percent(row(selective).wins, row(selective).n)} | ${percent(row(current).places, row(current).n)} | ${percent(row(full).places, row(full).n)} | ${percent(row(selective).places, row(selective).n)} |`;
  }).join("\n");

  const basisRows = Object.entries(basis).flatMap(([surface, item]) => INDEX_ENGINES.map((key) => {
    const engine = item.engines[key];
    const mode = SELECTIVE_ENGINES.has(key) ? `圧縮 → SD ${format(item.targetSd, 2)}` : "現行維持";
    return `| ${surface} | ${LABELS[key]} | ${engine.n} | ${format(engine.mean, 2)} | ${format(engine.sd, 2)} | ${mode} |`;
  })).join("\n");

  const breakdownRows = [
    ["芝/ダート", breakdown(races, "surface")],
    ["重賞/特別", breakdown(races, "category")],
    ["馬場", breakdown(races, "going")],
  ].flatMap(([label, rows]) => rows.map((row) => (
    `| ${label} | ${row.value} | ${row.races} | ${row.current.winnerTop3} → ${row.full.winnerTop3} → ${row.selective.winnerTop3} | ${percent(row.current.top3Places, row.current.top3Selections)} → ${percent(row.full.top3Places, row.full.top3Selections)} → ${percent(row.selective.top3Places, row.selective.top3Selections)} |`
  ))).join("\n");

  const raceRows = races.map((race) => {
    const winner = race.horses.find((horse) => horse.finish === 1);
    const selectiveLeader = race.horses.find((horse) => horse.selectiveRank === 1);
    const direction = winner.selectiveRank < winner.currentRank
      ? "改善"
      : winner.selectiveRank > winner.currentRank ? "悪化" : "維持";
    return `| ${race.date} | ${race.track}${race.number}R ${race.name} | ${winner.name} | ${winner.currentRank} → ${winner.fullRank} → ${winner.selectiveRank} | ${selectiveLeader.name} | ${selectiveLeader.finish} | ${direction} |`;
  }).join("\n");

  const horseRows = races.flatMap((race) => [...race.horses]
    .sort((left, right) => left.selectiveRank - right.selectiveRank)
    .map((horse) => (
      `| ${race.track}${race.number}R | ${horse.number} | ${horse.name} | ${horse.currentIndex} | ${horse.currentRank} | ${horse.fullRank} | ${horse.selectiveIndex} | ${horse.selectiveRank} | ${horse.finish} |`
    ))).join("\n");

  const fullImproved = races.filter((race) => {
    const winner = race.horses.find((horse) => horse.finish === 1);
    return winner.fullRank < winner.currentRank;
  }).length;
  const fullWorsened = races.filter((race) => {
    const winner = race.horses.find((horse) => horse.finish === 1);
    return winner.fullRank > winner.currentRank;
  }).length;
  const selectiveImproved = races.filter((race) => {
    const winner = race.horses.find((horse) => horse.finish === 1);
    return winner.selectiveRank < winner.currentRank;
  }).length;
  const selectiveWorsened = races.filter((race) => {
    const winner = race.horses.find((horse) => horse.finish === 1);
    return winner.selectiveRank > winner.currentRank;
  }).length;

  const passChecks = [
    ["上位3頭の勝ち馬捕捉 10/18以上", selective.winnerTop3 >= 10],
    ["上位3頭複勝率 37.0%以上", selective.top3Places / selective.top3Selections >= 0.37],
    ["INDEX1位勝率 16.7%以上", selective.rankRows[0].wins / selective.rankRows[0].n >= 0.167],
    ["INDEX1位複勝率 16.7%以上", selective.rankRows[0].places / selective.rankRows[0].n >= 0.167],
    ["Spearman 0.273以上", selective.spearman >= 0.273],
    ["芝の勝ち馬上位3頭捕捉を維持", selectiveTurf.winnerTop3 >= currentTurf.winnerTop3],
    ["特別の勝ち馬上位3頭捕捉を維持", selectiveSpecial.winnerTop3 >= currentSpecial.winnerTop3],
  ];
  const watashimatsuwa = races.flatMap((race) => race.horses)
    .find((horse) => normalizeHorseName(horse.name) === normalizeHorseName("ワタシマツワ"));
  passChecks.push(["ワタシマツワ仮1位維持", watashimatsuwa?.selectiveRank === 1]);
  const allPassed = passChecks.every(([, passed]) => passed);
  const passRows = passChecks.map(([label, passed]) => `| ${label} | ${passed ? "YES" : "NO"} |`).join("\n");

  return `# TM INDEX 選択的分散圧縮 What-if ${reportDate}

## 結論

**判定: ${allPassed ? "候補Bは18レース測定の合格条件を満たした。ただし本番採用は凍結。" : "候補Bは不採用。合格条件を満たさなかった。"}**

本レポートは過去${races.length}レースの測定結果です。本番TM INDEX、重み、UI、week-data.jsonは変更していません。100〜300頭・複数週で再現するまで本番へ接続しません。

## 計算条件

- 対象: ${pairs.map(({ date }) => date).join("、")} / ${races.length}レース / ${races.reduce((sum, race) => sum + race.horses.length, 0)}頭
- 圧縮対象: Course / Training / Pace
- 現行維持: Ability / Form / Distance / Blood
- 芝/ダート別に平均・SDを計算
- z-scoreは \`[-3, +3]\` にclip
- \`sigma_target\` は各芝/ダート母集団の Ability / Form SD中央値から機械的に決定
- 重みは現行BASE/GRADE/SPECIALを維持
- サンプル不足補正・馬場補正は公開時点の差分をそのまま適用
- Value・人気・オッズはINDEXへ不使用
- 同値タイブレーク: Ability z → 馬番
- 特定馬・特定レースは計算に不使用（下記4頭は報告対象のみ）
- 全面正規化は前回と同じ比較方式（全エンジンz-score + レース内50〜90変換）

## normalizationBasis

| 芝/ダート | Engine | n | 平均 | SD | 候補B |
| --- | --- | ---: | ---: | ---: | --- |
${basisRows}

## 3方式比較

| INDEX順位 | 現行 勝率 | 全面正規化 勝率 | 選択的 勝率 | 現行 複勝率 | 全面正規化 複勝率 | 選択的 複勝率 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
${comparisonRows}

| 指標 | 現行 | 全面正規化 | 選択的 |
| --- | ---: | ---: | ---: |
| 上位3頭の勝ち馬捕捉 | ${current.winnerTop3}/${races.length} | ${full.winnerTop3}/${races.length} | ${selective.winnerTop3}/${races.length} |
| 上位3頭複勝率 | ${percent(current.top3Places, current.top3Selections)} | ${percent(full.top3Places, full.top3Selections)} | ${percent(selective.top3Places, selective.top3Selections)} |
| Spearman | ${format(current.spearman)} | ${format(full.spearman)} | ${format(selective.spearman)} |
| 勝ち馬順位 改善レース | — | ${fullImproved} | ${selectiveImproved} |
| 勝ち馬順位 悪化レース | — | ${fullWorsened} | ${selectiveWorsened} |

## 層別比較

並びは「現行 → 全面正規化 → 選択的」です。

| 区分 | 層 | レース数 | 勝ち馬上位3頭捕捉 | 上位3頭複勝率 |
| --- | --- | ---: | --- | --- |
${breakdownRows}

## 必須個別報告

| 馬名 | レース | 現行順位 | 全面順位 | 選択的順位 | 実着順 | INDEX 現行→選択的 |
| --- | --- | ---: | ---: | ---: | ---: | --- |
${requiredRows}

## レース別

| 日付 | レース | 勝ち馬 | 勝ち馬順位 現行→全面→選択的 | 選択的1位 | 1位実着順 | 判定 |
| --- | --- | --- | --- | --- | ---: | --- |
${raceRows}

## 全馬

| レース | 馬番 | 馬名 | 現行INDEX | 現行順位 | 全面順位 | 選択的INDEX | 選択的順位 | 着順 |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
${horseRows}

## 合格判定

| 条件 | 判定 |
| --- | --- |
${passRows}

全条件を満たしても、18レースで確認できるのは方向性だけです。本番採用は100〜300頭・複数週で同じ傾向が再現してから検討します。

## 警告

${warnings.length ? warnings.map((warning) => `- ${warning}`).join("\n") : "- なし"}
`;
};

const main = () => {
  if (!existsSync(ARCHIVE_DIR)) throw new Error(`Archive directory not found: ${ARCHIVE_DIR}`);
  const pairs = resolvePairs();
  if (!pairs.length) throw new Error("No publication snapshot/result pairs found");
  const { races, warnings } = collectRaces(pairs);
  if (!races.length) throw new Error("No joined races available");
  const basis = buildBasis(races);
  const simulated = calculateCandidates(races, basis);
  const reportDate = pairs.at(-1).date;
  const report = buildReport({ pairs, races: simulated, basis, warnings, reportDate });
  const outputPath = join(OUTPUT_DIR, `normalize-what-if-selective-${reportDate}.md`);
  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(outputPath, report, "utf8");
  console.log(`[analyze:whatif:selective] archive pairs: ${pairs.length}`);
  console.log(`[analyze:whatif:selective] races: ${simulated.length}`);
  console.log(`[analyze:whatif:selective] horses: ${simulated.reduce((sum, race) => sum + race.horses.length, 0)}`);
  console.log(`[analyze:whatif:selective] warnings: ${warnings.length}`);
  console.log(`[analyze:whatif:selective] report: ${outputPath}`);
};

try {
  main();
} catch (error) {
  console.error(`[analyze:whatif:selective] ${error.stack ?? error.message}`);
  process.exit(1);
}
