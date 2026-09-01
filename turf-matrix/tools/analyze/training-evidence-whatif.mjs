#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildTrainingEvidenceShadow } from "../intelligence/training-evidence-shadow.mjs";
import { buildTrainingProfile } from "../intelligence/training-ai.mjs";
import { calculateTmIndex } from "../intelligence/tm-index-engine.mjs";

const ANALYZE_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(ANALYZE_DIR, "..", "..");
const ARCHIVE_DIR = join(ROOT, "data", "archive");
const OUTPUT = join(ROOT, "docs", "analysis", "training-evidence-whatif-2026-09-02.md");
const VARIANTS = ["qualityOnly", "oneWeekPrimary", "empiricalQuality"];

const readJson = (path) => JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
const finite = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
const number = (value) => finite(value) ? Number(value) : null;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const normalizeName = (value) => String(value ?? "").normalize("NFKC").replace(/[\s\u3000]/g, "");
const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const pct = (hits, total) => total ? `${(hits / total * 100).toFixed(1)}%` : "-";

const averageRanks = (values) => {
  const sorted = values.map((value, index) => ({ value, index })).sort((left, right) => left.value - right.value);
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

const spearman = (rows, key) => {
  const pairs = rows.filter((row) => finite(row[key]) && finite(row.finish));
  return pearson(
    averageRanks(pairs.map((row) => Number(row[key]))),
    averageRanks(pairs.map((row) => Number(row.finish))),
  );
};

const archivePairs = () => readdirSync(ARCHIVE_DIR)
  .map((name) => name.match(/^(\d{4}-\d{2}-\d{2})-preodds\.json$/)?.[1])
  .filter(Boolean)
  .sort()
  .map((date) => ({
    date,
    snapshot: join(ARCHIVE_DIR, `${date}-preodds.json`),
    results: join(ARCHIVE_DIR, `${date}-results.json`),
  }))
  .filter((pair) => existsSync(pair.results));

const resultHorseFor = (horse, race) => {
  const horseNumber = Number(horse.number ?? horse.horseNumber);
  const horseName = normalizeName(horse.name ?? horse.horseName);
  const result = (race?.horses ?? []).find((item) => Number(item.horseNumber ?? item.number) === horseNumber);
  return result && normalizeName(result.horseName ?? result.name) === horseName ? result : null;
};

const detailScore = (horse, key) => number(horse.analysis?.factorsDetail?.[key]?.score);
const scoreSet = (horse, training) => ({
  ability: detailScore(horse, "ability"),
  form: detailScore(horse, "form"),
  distance: number(horse.analysis?.factors?.distance),
  course: detailScore(horse, "course") ?? number(horse.analysis?.factors?.course),
  training,
  blood: detailScore(horse, "blood"),
  pace: detailScore(horse, "pace") ?? number(horse.analysis?.factors?.pace),
});

const experienceFactor = (horse) => {
  const count = horse.pastRuns?.length ?? 0;
  return count <= 0 ? 0.3 : count === 1 ? 0.5 : count === 2 ? 0.7 : 1;
};

const leader = (rows, key) => [...rows].sort((left, right) =>
  Number(right[key]) - Number(left[key]) || left.number - right.number
)[0] ?? null;

const races = [];
let joinMisses = 0;
for (const pair of archivePairs()) {
  const snapshot = readJson(pair.snapshot);
  const results = readJson(pair.results);
  const resultsByBundle = new Map((results.races ?? []).map((race) => [race.bundleId, race]));
  for (const race of snapshot.races ?? []) {
    const resultRace = resultsByBundle.get(race.bundleId);
    if (!resultRace) continue;
    const rows = [];
    for (const horse of race.horses ?? []) {
      const result = resultHorseFor(horse, resultRace);
      const finish = number(result?.finishPosition ?? result?.finish);
      const currentTraining = detailScore(horse, "training") ?? number(horse.analysis?.factors?.training);
      const currentTm = number(horse.tmIndex);
      if (finish == null || currentTraining == null || currentTm == null) {
        joinMisses += 1;
        continue;
      }

      const profile = buildTrainingProfile(horse);
      const context = race.raceContext ?? { category: race.category, surface: race.surface };
      const currentRaw = calculateTmIndex(scoreSet(horse, currentTraining), context);
      const row = {
        date: pair.date,
        track: race.track,
        raceNumber: Number(race.number),
        raceName: race.name,
        number: Number(horse.number),
        name: horse.name,
        finish,
        currentTraining,
        currentTm,
        phaseQuality: number(profile.components?.phaseQuality),
        recentBest: number(profile.components?.recentBest),
        consistency: number(profile.components?.consistency),
        volume: number(profile.components?.volume),
        freshness: number(profile.components?.freshness),
        hasFinal: Boolean(profile.phaseRepresentatives?.final),
        hasOneWeek: Boolean(profile.phaseRepresentatives?.oneWeek),
        goodRunCompared: profile.goodRunComparison?.status && profile.goodRunComparison.status !== "missing",
        videoReviewed: Boolean(profile.videoReview),
        stablePatternActive: profile.stablePattern?.status === "照合済",
        sessionCount: profile.sessions?.length ?? 0,
      };

      for (const variant of VARIANTS) {
        const shadow = buildTrainingEvidenceShadow(profile, currentTraining, variant, {
          stableSide: horse.stableSide ?? horse.currentRace?.stableSide,
        });
        const shadowRaw = calculateTmIndex(scoreSet(horse, shadow.shadowScore), context);
        const tmDelta = finite(currentRaw) && finite(shadowRaw)
          ? Math.round((shadowRaw - currentRaw) * experienceFactor(horse))
          : 0;
        row[`${variant}Training`] = shadow.shadowScore;
        row[`${variant}Adjustment`] = shadow.adjustment;
        row[`${variant}Tm`] = clamp(currentTm + tmDelta, 45, 92);
      }
      rows.push(row);
    }
    if (rows.length >= 2) races.push({ date: pair.date, track: race.track, raceNumber: race.number, raceName: race.name, rows });
  }
}

const rows = races.flatMap((race) => race.rows);
const wins = (leaders) => leaders.filter((row) => row?.finish === 1).length;
const places = (leaders) => leaders.filter((row) => row?.finish <= 3).length;
const metricsFor = (variant = null) => {
  const trainingKey = variant ? `${variant}Training` : "currentTraining";
  const tmKey = variant ? `${variant}Tm` : "currentTm";
  const trainingLeaders = races.map((race) => leader(race.rows, trainingKey));
  const tmLeaders = races.map((race) => leader(race.rows, tmKey));
  return {
    trainingKey,
    tmKey,
    trainingCorrelation: spearman(rows, trainingKey),
    tmCorrelation: spearman(rows, tmKey),
    trainingWins: wins(trainingLeaders),
    trainingPlaces: places(trainingLeaders),
    tmWins: wins(tmLeaders),
    tmPlaces: places(tmLeaders),
    trainingLeaders,
    tmLeaders,
    adjustedHorseCount: variant ? rows.filter((row) => row[`${variant}Adjustment`] !== 0).length : 0,
    maxAdjustment: variant ? Math.max(0, ...rows.map((row) => Math.abs(row[`${variant}Adjustment`]))) : 0,
  };
};

const current = metricsFor();
const variants = Object.fromEntries(VARIANTS.map((variant) => [variant, metricsFor(variant)]));
const componentKeys = ["phaseQuality", "recentBest", "consistency", "volume", "freshness"];
const componentRows = componentKeys.map((key) => `| ${key} | ${rows.filter((row) => finite(row[key])).length} | ${spearman(rows, key)?.toFixed(3) ?? "-"} |`).join("\n");
const coverageRows = [
  ["最終あり", rows.filter((row) => row.hasFinal).length],
  ["一週前あり", rows.filter((row) => row.hasOneWeek).length],
  ["最終・一週前ともにあり", rows.filter((row) => row.hasFinal && row.hasOneWeek).length],
  ["調教時計なし", rows.filter((row) => row.sessionCount === 0).length],
  ["好走時比較あり", rows.filter((row) => row.goodRunCompared).length],
  ["映像所見あり", rows.filter((row) => row.videoReviewed).length],
  ["厩舎パターン有効", rows.filter((row) => row.stablePatternActive).length],
].map(([label, count]) => `| ${label} | ${count} | ${pct(count, rows.length)} |`).join("\n");

const variantLabels = { qualityOnly: "質のみ", oneWeekPrimary: "一週前主評価", empiricalQuality: "実測分位・質のみ" };
const comparisonRows = VARIANTS.map((variant) => {
  const metrics = variants[variant];
  return `| ${variantLabels[variant]} | ${metrics.trainingCorrelation?.toFixed(3)} | ${metrics.trainingWins} | ${metrics.trainingPlaces} | ${metrics.tmCorrelation?.toFixed(3)} | ${metrics.tmWins} | ${metrics.tmPlaces} | ${metrics.adjustedHorseCount} | ${metrics.maxAdjustment} |`;
}).join("\n");

const criteriaFor = (variant) => {
  const metrics = variants[variant];
  return [
    ["Training着順相関を維持", metrics.trainingCorrelation <= current.trainingCorrelation, `${current.trainingCorrelation?.toFixed(3)}→${metrics.trainingCorrelation?.toFixed(3)}`],
    ["Training首位勝数を維持", metrics.trainingWins >= current.trainingWins, `${current.trainingWins}→${metrics.trainingWins}`],
    ["Training首位複勝数を維持", metrics.trainingPlaces >= current.trainingPlaces, `${current.trainingPlaces}→${metrics.trainingPlaces}`],
    ["TM着順相関を維持", metrics.tmCorrelation <= current.tmCorrelation, `${current.tmCorrelation?.toFixed(3)}→${metrics.tmCorrelation?.toFixed(3)}`],
    ["TM首位勝数を維持", metrics.tmWins >= current.tmWins, `${current.tmWins}→${metrics.tmWins}`],
    ["TM首位複勝数を維持", metrics.tmPlaces >= current.tmPlaces, `${current.tmPlaces}→${metrics.tmPlaces}`],
    ["最大補正3点以内", metrics.maxAdjustment <= 3, `${metrics.maxAdjustment}点`],
  ];
};

const gateSections = VARIANTS.map((variant) => {
  const criteria = criteriaFor(variant);
  const pass = criteria.every(([, criterionPass]) => criterionPass);
  return `### ${variantLabels[variant]}: ${pass ? "PASS" : "FAIL"}\n\n| 条件 | 判定 | 実測 |\n|---|---|---|\n${criteria.map(([label, criterionPass, actual]) => `| ${label} | ${criterionPass ? "PASS" : "FAIL"} | ${actual} |`).join("\n")}`;
}).join("\n\n");

const report = `# Training Evidence what-if (2026-09-02)

## 結論

調教時計の取得は進んでいるが、現行Trainingの着順相関は${current.trainingCorrelation?.toFixed(3)}と弱い。特に本数と鮮度をパフォーマンス点として加算する設計、一週前より最終追い切りの重みが大きい設計を分離して診断した。

既存結果を使う本レポートは原因診断のみ。本番TrainingおよびTM INDEXには接続しない。

## 対象

- ${races.length}レース / ${rows.length}頭
- 結果JOIN失敗: ${joinMisses}件
- 候補補正: 現行Trainingから最大±3点
- 人気・オッズは不使用

## 現行成分の着順相関

高得点ほど着順が小さい想定なので、負の値が期待方向。

| 成分 | n | Spearman ρ |
|---|---:|---:|
${componentRows}

## Evidence充足率

| Evidence | 頭数 | 充足率 |
|---|---:|---:|
${coverageRows}

## 固定した候補式

### 質のみ

- phaseQuality 72% / recentBest 16% / consistency 12%
- 本数と鮮度はConfidence材料に限定し、調教の強さへ加点しない
- 厩舎パターン・好走時比較・映像所見の既存補正は維持

### 一週前主評価

- 最終と一週前がある場合: 一週前55% / 最終30% / consistency 15%
- 片方のみの場合: 取得済み主要追い切り80% / consistency 20%
- 本数と鮮度はConfidence材料に限定
- 厩舎パターン・好走時比較・映像所見の既存補正は維持

### 実測分位・質のみ

- 公開前スナップショットの追い切り期（1〜12日前）だけから時計分位を算出
- 美浦坂路・栗東坂路・ウッドC・ウッドDを別母集団にする
- 4F 45% / 1F 45% / 加速10%でセッション品質を評価
- 結果・人気・オッズは基準算出に使用しない
- 本数と鮮度は性能点に使わず、既存Evidence補正を維持

## 比較

| 方式 | Training相関 | Training首位勝 | Training首位複 | TM相関 | TM首位勝 | TM首位複 | 補正頭数 | 最大補正 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 現行 | ${current.trainingCorrelation?.toFixed(3)} | ${current.trainingWins} | ${current.trainingPlaces} | ${current.tmCorrelation?.toFixed(3)} | ${current.tmWins} | ${current.tmPlaces} | 0 | 0 |
${comparisonRows}

## 診断ゲート

${gateSections}

過去診断で通った場合も即接続せず、同じ算式を次回公開前に固定してから独立評価する。
`;

mkdirSync(dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, report, "utf8");
console.log(JSON.stringify({
  output: OUTPUT,
  raceCount: races.length,
  horseCount: rows.length,
  joinMisses,
  current: {
    trainingCorrelation: current.trainingCorrelation,
    trainingWins: current.trainingWins,
    trainingPlaces: current.trainingPlaces,
    tmCorrelation: current.tmCorrelation,
    tmWins: current.tmWins,
    tmPlaces: current.tmPlaces,
  },
  variants: Object.fromEntries(VARIANTS.map((variant) => [variant, {
    trainingCorrelation: variants[variant].trainingCorrelation,
    trainingWins: variants[variant].trainingWins,
    trainingPlaces: variants[variant].trainingPlaces,
    tmCorrelation: variants[variant].tmCorrelation,
    tmWins: variants[variant].tmWins,
    tmPlaces: variants[variant].tmPlaces,
    adjustedHorseCount: variants[variant].adjustedHorseCount,
    maxAdjustment: variants[variant].maxAdjustment,
    pass: criteriaFor(variant).every(([, criterionPass]) => criterionPass),
  }])),
}, null, 2));
