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
const ENGINE_LABELS = {
  ability: "Ability",
  form: "Form",
  distance: "Distance",
  course: "Course",
  training: "Training",
  blood: "Blood",
  pace: "Pace",
};

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const finite = (value) => Number.isFinite(Number(value));
const numberOrNull = (value) => finite(value) ? Number(value) : null;
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const mean = (values) => values.length
  ? values.reduce((sum, value) => sum + value, 0) / values.length
  : null;
const standardDeviation = (values) => {
  const average = mean(values);
  return average == null
    ? null
    : Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length);
};
const format = (value, digits = 2) => value == null ? "—" : Number(value).toFixed(digits);
const percent = (hits, total) => total ? `${(hits / total * 100).toFixed(1)}%` : "—";

const normalizeHorseName = (value) => String(value ?? "")
  .normalize("NFKC")
  .replace(/[\s\u3000]/g, "")
  .replace(/^[*＊$＄]+/, "");

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
        const result = (resultRace.horses ?? []).find((item) => (
          Number(item.horseNumber) === number
          && normalizeHorseName(item.horseName) === normalizeHorseName(horse.name ?? horse.horseName)
        ));
        if (!result) {
          warnings.push(`${pair.date} ${race.bundleId} ${number} ${horse.name}: 結果JOIN失敗`);
          return null;
        }
        return {
          number,
          name: horse.name ?? horse.horseName,
          currentIndex: numberOrNull(horse.tmIndex),
          currentRank: numberOrNull(horse.analysis?.relative?.rank),
          finish: numberOrNull(result.finishPosition),
          scores: Object.fromEntries(INDEX_ENGINES.map((key) => [key, factorScore(horse, key)])),
          sampleAdjustment: numberOrNull(horse.analysis?.sampleAdjustment) ?? 0,
          goingAdjustment: numberOrNull(horse.analysis?.goingAdjustment) ?? 0,
        };
      }).filter(Boolean);
      if (horses.length) races.push({
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
  return { races, warnings };
};

const buildBasis = (races) => {
  const basis = {};
  for (const surface of [...new Set(races.map((race) => race.surface))].sort()) {
    const horses = races.filter((race) => race.surface === surface).flatMap((race) => race.horses);
    basis[surface] = Object.fromEntries(INDEX_ENGINES.map((key) => {
      const values = horses.map((horse) => horse.scores[key]).filter((value) => value != null);
      return [key, { n: values.length, mean: mean(values), sd: standardDeviation(values) }];
    }));
  }
  return basis;
};

const calculateWhatIf = (races, basis) => races.map((race) => {
  const weights = weightsFor({ category: race.category });
  const provisional = race.horses.map((horse) => {
    const contributions = Object.fromEntries(INDEX_ENGINES.map((key) => {
      const stats = basis[race.surface]?.[key];
      const score = horse.scores[key];
      const z = score == null || !stats?.sd ? 0 : clamp((score - stats.mean) / stats.sd, -3, 3);
      return [key, { z, weighted: (weights[key] ?? 0) * z }];
    }));
    const raw = Object.values(contributions).reduce((sum, item) => sum + item.weighted, 0);
    const dominant = Object.entries(contributions)
      .sort((left, right) => Math.abs(right[1].weighted) - Math.abs(left[1].weighted))[0]?.[0] ?? null;
    return { ...horse, contributions, provisionalRaw: raw, dominant };
  });

  const rawValues = provisional.map((horse) => horse.provisionalRaw);
  const minimum = Math.min(...rawValues);
  const maximum = Math.max(...rawValues);
  const scaled = provisional.map((horse) => {
    const normalizedBase = maximum === minimum
      ? 70
      : 50 + (horse.provisionalRaw - minimum) / (maximum - minimum) * 40;
    const hypotheticalIndex = Math.round(clamp(
      normalizedBase + horse.sampleAdjustment + horse.goingAdjustment,
      45,
      92,
    ));
    return { ...horse, normalizedBase, hypotheticalIndex };
  });

  const abilityOrder = [...scaled].sort((left, right) => (
    (right.contributions.ability?.z ?? 0) - (left.contributions.ability?.z ?? 0)
    || left.number - right.number
  ));
  const abilityRanks = new Map(abilityOrder.map((horse, index) => [horse.number, index + 1]));
  const hypotheticalOrder = [...scaled].sort((left, right) => (
    right.hypotheticalIndex - left.hypotheticalIndex
    || (right.contributions.ability?.z ?? 0) - (left.contributions.ability?.z ?? 0)
    || left.number - right.number
  ));
  const hypotheticalRanks = new Map(hypotheticalOrder.map((horse, index) => [horse.number, index + 1]));

  return {
    ...race,
    horses: scaled.map((horse) => ({
      ...horse,
      abilityRank: abilityRanks.get(horse.number),
      hypotheticalRank: hypotheticalRanks.get(horse.number),
      rankChange: horse.currentRank == null ? null : horse.currentRank - hypotheticalRanks.get(horse.number),
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
    spearman: spearman(pairs),
    top3Selections: rankRows.reduce((sum, row) => sum + row.n, 0),
    top3Places: rankRows.reduce((sum, row) => sum + row.places, 0),
  };
};

const breakdown = (races, key, currentMetrics, hypotheticalMetrics) => [...new Set(races.map((race) => race[key]))]
  .sort()
  .map((value) => {
    const subset = races.filter((race) => race[key] === value);
    const current = metricsFor(subset, "currentRank");
    const hypothetical = metricsFor(subset, "hypotheticalRank");
    return {
      value,
      races: subset.length,
      currentTop1Places: current.rankRows[0].places,
      hypotheticalTop1Places: hypothetical.rankRows[0].places,
      currentWinnerTop3: current.winnerTop3,
      hypotheticalWinnerTop3: hypothetical.winnerTop3,
    };
  });

const report = ({ pairs, races, basis, warnings, outputDate }) => {
  const current = metricsFor(races, "currentRank");
  const hypothetical = metricsFor(races, "hypotheticalRank");
  const metricRows = [0, 1, 2].map((index) => {
    const before = current.rankRows[index];
    const after = hypothetical.rankRows[index];
    return `| ${index + 1}位 | ${before.wins}/${before.n} (${percent(before.wins, before.n)}) | ${after.wins}/${after.n} (${percent(after.wins, after.n)}) | ${before.places}/${before.n} (${percent(before.places, before.n)}) | ${after.places}/${after.n} (${percent(after.places, after.n)}) |`;
  }).join("\n");
  const basisRows = Object.entries(basis).flatMap(([surface, engines]) => INDEX_ENGINES.map((key) => (
    `| ${surface} | ${ENGINE_LABELS[key]} | ${engines[key].n} | ${format(engines[key].mean)} | ${format(engines[key].sd)} |`
  ))).join("\n");
  const raceSections = races.map((race) => {
    const currentTop = [...race.horses].sort((a, b) => a.currentRank - b.currentRank).slice(0, 3);
    const hypotheticalTop = [...race.horses].sort((a, b) => a.hypotheticalRank - b.hypotheticalRank).slice(0, 3);
    const currentTopNames = new Set(currentTop.map((horse) => horse.name));
    const hypotheticalTopNames = new Set(hypotheticalTop.map((horse) => horse.name));
    const dropped = currentTop.filter((horse) => !hypotheticalTopNames.has(horse.name));
    const added = hypotheticalTop.filter((horse) => !currentTopNames.has(horse.name));
    const winner = race.horses.find((horse) => horse.finish === 1);
    const rows = [...race.horses].sort((a, b) => a.hypotheticalRank - b.hypotheticalRank).map((horse) => (
      `| ${horse.number} | ${horse.name} | ${horse.currentIndex ?? "—"} | ${horse.currentRank ?? "—"} | ${horse.hypotheticalIndex} | ${horse.hypotheticalRank} | ${horse.rankChange > 0 ? "+" : ""}${horse.rankChange ?? "—"} | ${horse.finish ?? "—"} | ${horse.abilityRank} | ${ENGINE_LABELS[horse.dominant] ?? "—"} |`
    )).join("\n");
    return `### ${race.date} ${race.track}${race.number}R ${race.name}

- 現行1位: ${currentTop[0]?.name ?? "—"}
- 仮1位: ${hypotheticalTop[0]?.name ?? "—"}
- 勝ち馬: ${winner?.name ?? "—"}（現行${winner?.currentRank ?? "—"}位 → 仮${winner?.hypotheticalRank ?? "—"}位）
- 現行上位3頭: ${currentTop.map((horse) => horse.name).join(" / ")}
- 仮上位3頭: ${hypotheticalTop.map((horse) => horse.name).join(" / ")}
- 上位3頭から脱落: ${dropped.map((horse) => horse.name).join(" / ") || "なし"}
- 上位3頭へ追加: ${added.map((horse) => horse.name).join(" / ") || "なし"}

| 馬番 | 馬名 | 現行INDEX | 現行順位 | 仮INDEX | 仮順位 | 順位変動 | 着順 | Ability順位 | 仮INDEX最大寄与 |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
${rows}`;
  }).join("\n\n");
  const breakdownRows = [
    ["芝/ダート", breakdown(races, "surface")],
    ["重賞/特別", breakdown(races, "category")],
    ["馬場", breakdown(races, "going")],
  ].flatMap(([label, rows]) => rows.map((row) => (
    `| ${label} | ${row.value} | ${row.races} | ${row.currentTop1Places} → ${row.hypotheticalTop1Places} | ${row.currentWinnerTop3} → ${row.hypotheticalWinnerTop3} |`
  ))).join("\n");
  const improved = races.filter((race) => {
    const winner = race.horses.find((horse) => horse.finish === 1);
    return winner && winner.hypotheticalRank < winner.currentRank;
  });
  const worsened = races.filter((race) => {
    const winner = race.horses.find((horse) => horse.finish === 1);
    return winner && winner.hypotheticalRank > winner.currentRank;
  });
  const movers = races.flatMap((race) => race.horses.map((horse) => ({
    race: `${race.track}${race.number}R ${race.name}`,
    ...horse,
  })));
  const biggestRisers = [...movers].sort((a, b) => b.rankChange - a.rankChange).slice(0, 5);
  const biggestFallers = [...movers].sort((a, b) => a.rankChange - b.rankChange).slice(0, 5);
  const moverRows = [
    ...biggestRisers.map((horse) => `| 上昇 | ${horse.race} | ${horse.name} | ${horse.currentRank} → ${horse.hypotheticalRank} | ${horse.rankChange > 0 ? "+" : ""}${horse.rankChange} | ${ENGINE_LABELS[horse.dominant]} | ${horse.finish ?? "—"} |`),
    ...biggestFallers.map((horse) => `| 下降 | ${horse.race} | ${horse.name} | ${horse.currentRank} → ${horse.hypotheticalRank} | ${horse.rankChange} | ${ENGINE_LABELS[horse.dominant]} | ${horse.finish ?? "—"} |`),
  ].join("\n");

  return `# TM INDEX Normalization What-if ${outputDate}

## 実行条件

- 対象: ${pairs.map(({ date }) => date).join("、")}の${races.length}レース
- normalizationBasis.version: what-if-v1.0
- normalizationBasis.computedFrom: ${pairs.map(({ date }) => date).join("、")}
- 本番非接続。既存TM INDEX・重み・タイブレーク・UI・week-dataは未変更。
- 正規化対象: ${INDEX_ENGINES.map((key) => ENGINE_LABELS[key]).join(" / ")}
- StableとValueは現行TM INDEX非算入のため除外。
- 母集団: 芝/ダート別の全対象公開スナップショット。過去18レースのwhat-ifに限り全期間のμ・σを使用。
- 本番採用時は発走時点までの固定済み基準のみを使い、未来データを混入させない。
- z-scoreは[-3, +3]にclip。欠損またはSD=0はz=0。
- 現行のレースカテゴリ別重みを維持。
- 現行のサンプル不足補正・馬場補正をそのまま仮INDEXへ加算。
- 仮rawINDEXはレース内50〜90へ線形変換。仮同値はAbility z、次に馬番で決定。

> **重要:** これは18レースへの過去適合を確認する判断材料であり、本番採用の許可ではありません。最低100〜300頭・複数週での再現確認が必要です。

## normalizationBasis

| Surface | Engine | n | μ | σ |
| --- | --- | ---: | ---: | ---: |
${basisRows}

## 全体指標（現行 vs 仮）

| INDEX順位 | 現行勝率 | 仮勝率 | 現行複勝率 | 仮複勝率 |
| --- | ---: | ---: | ---: | ---: |
${metricRows}

- 上位3頭の勝ち馬捕捉: ${current.winnerTop3}/${races.length} → ${hypothetical.winnerTop3}/${races.length}
- 上位3頭の複勝率: ${current.top3Places}/${current.top3Selections} (${percent(current.top3Places, current.top3Selections)}) → ${hypothetical.top3Places}/${hypothetical.top3Selections} (${percent(hypothetical.top3Places, hypothetical.top3Selections)})
- Spearman（INDEX順位 vs 着順）: ${format(current.spearman, 3)} → ${format(hypothetical.spearman, 3)}
- 勝ち馬順位が改善したレース: ${improved.length}
- 勝ち馬順位が悪化したレース: ${worsened.length}

## 層別

| 分類 | 層 | レース数 | INDEX1位3着内（現行→仮） | 勝ち馬上位3頭（現行→仮） |
| --- | --- | ---: | ---: | ---: |
${breakdownRows}

## 最大順位変動

| 方向 | レース | 馬名 | 現行→仮 | 変動 | 仮INDEX最大寄与 | 着順 |
| --- | --- | --- | ---: | ---: | --- | ---: |
${moverRows}

## レース・馬単位

${raceSections}

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
  const simulated = calculateWhatIf(races, basis);
  const outputDate = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
  const output = report({ pairs, races: simulated, basis, warnings, outputDate });
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const outputPath = join(OUTPUT_DIR, `normalize-what-if-${outputDate}.md`);
  writeFileSync(outputPath, output, "utf8");
  console.log(`[analyze:whatif] archive pairs: ${pairs.length}`);
  console.log(`[analyze:whatif] races: ${simulated.length}`);
  console.log(`[analyze:whatif] horses: ${simulated.reduce((sum, race) => sum + race.horses.length, 0)}`);
  console.log(`[analyze:whatif] warnings: ${warnings.length}`);
  console.log(`[analyze:whatif] report: ${outputPath}`);
};

try {
  main();
} catch (error) {
  console.error(`[analyze:whatif] ${error.message}`);
  process.exit(1);
}
