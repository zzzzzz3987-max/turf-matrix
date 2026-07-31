import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const beforePath = resolve("tools/jvlink/output/current-graded-blood-review.before-tanh-position.json");
const afterPath = resolve("tools/jvlink/output/current-graded-blood-review.json");
const outputPath = resolve("docs/analysis/blood-tanh-position-2026-08-02.md");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
const before = readJson(beforePath);
const after = readJson(afterPath);
const SCALE = 7.5;

const flatten = (payload) => payload.races.flatMap((race) => race.horses.map((horse) => ({
  key: `${race.course}${race.raceNo}R|${horse.horseName}`,
  race: `${race.course}${race.raceNo}R ${race.raceName}`,
  ...horse,
})));
const beforeRows = flatten(before);
const afterRows = flatten(after);
const beforeByKey = new Map(beforeRows.map((row) => [row.key, row]));
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
const sd = (values) => {
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
};
const stats = (values) => ({ mean: mean(values), sd: sd(values), min: Math.min(...values), max: Math.max(...values) });
const fixed = (value, digits = 3) => Number.isFinite(value) ? value.toFixed(digits) : "--";
const correlation = (rows) => {
  const xs = rows.map((row) => row.coverage);
  const ys = rows.map((row) => row.score);
  const mx = mean(xs);
  const my = mean(ys);
  const numerator = xs.reduce((sum, x, index) => sum + (x - mx) * (ys[index] - my), 0);
  const denominator = Math.sqrt(
    xs.reduce((sum, x) => sum + (x - mx) ** 2, 0)
    * ys.reduce((sum, y) => sum + (y - my) ** 2, 0)
  );
  return denominator ? numerator / denominator : 0;
};
const saturationPairCount = (rows) => {
  let count = 0;
  for (let left = 0; left < rows.length; left += 1) {
    for (let right = left + 1; right < rows.length; right += 1) {
      const rawDifference = Math.abs(rows[left].contributionDiagnostics.raw - rows[right].contributionDiagnostics.raw);
      const outputDifference = Math.abs(rows[left].contributionDiagnostics.adjusted - rows[right].contributionDiagnostics.adjusted);
      if (rawDifference >= 2 && outputDifference < 0.1) count += 1;
    }
  }
  return count;
};
const beforeCorrelation = correlation(beforeRows);
const afterCorrelation = correlation(afterRows);
const beforeSaturationPairs = saturationPairCount(beforeRows);
const afterSaturationPairs = saturationPairCount(afterRows);
const tanhInputs = afterRows.map((row) => row.contributionDiagnostics.raw / SCALE);
const ruleRawValues = afterRows.flatMap((row) => row.contributionDiagnostics.evidence.map((item) => item.raw));
const tanhInputStats = stats(tanhInputs);
const ruleRawStats = stats(ruleRawValues);

const raceStats = after.races.map((race) => {
  const values = race.horses.map((horse) => horse.score);
  return {
    race: `${race.course}${race.raceNo}R ${race.raceName}`,
    average: mean(values),
    sd: sd(values),
    min: Math.min(...values),
    max: Math.max(...values),
    range: Math.max(...values) - Math.min(...values),
  };
});

const courseCounts = { 1: 0, 0.5: 0, 0: 0 };
for (const row of afterRows) {
  const matches = [...(row.matchedLines ?? []), ...(row.matchedMaternalRules ?? [])];
  const strength = Math.max(0, ...matches.map((match) => Number(match.courseMatchStrength) || 0));
  courseCounts[strength] = (courseCounts[strength] ?? 0) + 1;
}
const ruleSet = (row) => [...(row.matchedLines ?? []), ...(row.matchedMaternalRules ?? [])]
  .map((match) => match.id).sort().join(",");
const scoreGroups = new Map();
for (const row of afterRows) {
  const key = String(row.score);
  if (!scoreGroups.has(key)) scoreGroups.set(key, []);
  scoreGroups.get(key).push(row);
}
const inconsistentEqualScores = [...scoreGroups.values()]
  .filter((group) => group.length > 1 && new Set(group.map(ruleSet)).size > 1).length;
const accepted = (
  Math.max(...tanhInputs.map(Math.abs)) < 2
  && afterSaturationPairs === 0
  && afterCorrelation < 0.3
  && new Set(afterRows.map((row) => row.score)).size > 1
  && inconsistentEqualScores === 0
);

const lines = [
  "# Blood AI tanh適用位置検証 (2026-08-02)",
  "",
  "> review-only。定数 amplitude=7.5 / scale=7.5、中心値82は変更していません。TM INDEX / week-data.jsonには接続していません。",
  "",
  "## 総合判定",
  "",
  `- 枝統合後tanh候補: **${accepted ? "PASS" : "FAIL"}**`,
  `- tanh入力最大絶対値: ${fixed(Math.max(...tanhInputs.map(Math.abs)))} (${Math.max(...tanhInputs.map(Math.abs)) < 2 ? "PASS" : "FAIL"}; 基準 < 2.0)`,
  `- 飽和ペア数: ${beforeSaturationPairs} → ${afterSaturationPairs} (${afterSaturationPairs === 0 ? "PASS" : "FAIL"})`,
  `- coverage-score相関: ${fixed(beforeCorrelation)} → ${fixed(afterCorrelation)} (${afterCorrelation < 0.3 ? "PASS" : "FAIL"}; 基準 < 0.3)`,
  `- 結論: ${accepted ? "候補を採用できます。" : "飽和は解消しますが既存受入基準を満たさないため、このままTM INDEXへ接続できません。"}`,
  "",
  "## 34頭差分",
  "",
  "| レース | 馬名 | 変更前 | 変更後候補 | 差分 | raw_horse | x=raw/scale |",
  "|---|---|---:|---:|---:|---:|---:|",
];
for (const row of afterRows) {
  const previous = beforeByKey.get(row.key);
  lines.push(`| ${row.race} | ${row.horseName} | ${fixed(previous?.score)} | ${fixed(row.score)} | ${fixed(row.score - previous.score)} | ${fixed(row.contributionDiagnostics.raw)} | ${fixed(row.contributionDiagnostics.raw / SCALE)} |`);
}
lines.push(
  "",
  "## tanh入力分布",
  "",
  `- 平均: ${fixed(tanhInputStats.mean)}`,
  `- SD: ${fixed(tanhInputStats.sd)}`,
  `- 最小: ${fixed(tanhInputStats.min)}`,
  `- 最大: ${fixed(tanhInputStats.max)}`,
  `- ルール単位raw平均: ${fixed(ruleRawStats.mean)} (中心値バイアス監視)`,
  `- ルール単位raw SD: ${fixed(ruleRawStats.sd)}`,
  "",
  "## レース別分布（参考）",
  "",
  "| レース | 平均 | SD | 最小 | 最大 | レンジ |",
  "|---|---:|---:|---:|---:|---:|",
  ...raceStats.map((item) => `| ${item.race} | ${fixed(item.average)} | ${fixed(item.sd)} | ${fixed(item.min)} | ${fixed(item.max)} | ${fixed(item.range)} |`),
  "",
  "## 回帰・監視項目",
  "",
  `- coverage-score相関 < 0.3: ${afterCorrelation < 0.3 ? "PASS" : "FAIL"}`,
  "- 同一血統経路1加点: ユニットテストで確認",
  "- 汎用タグ単独courseMatchなし: ユニットテストで確認",
  "- 辞書1件追加で3点以内: ユニットテストで確認",
  "- 5代目のみ一致で±1以内: ユニットテストで確認",
  "- 未照合馬 score 65 / coverage 0 / confidence low: ユニットテストで確認",
  `- 同一内部スコアの根拠集合一致: ${inconsistentEqualScores === 0 ? "PASS" : "FAIL"}`,
  `- courseMatch内訳: 1.0=${courseCounts[1] ?? 0}頭 / 0.5=${courseCounts[0.5] ?? 0}頭 / 0=${courseCounts[0] ?? 0}頭`,
  "",
  "## 次工程判断",
  "",
  accepted
    ? "受入基準を満たしたため、別工程でTM INDEX what-if接続へ進めます。"
    : "適用位置移動だけではcoverage-score相関が悪化します。中心値82のwhat-ifを切り分けて検証するまでTM INDEX接続を保留します。",
  "",
);

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${lines.join("\n")}\n`, "utf8");
console.log(JSON.stringify({
  output: outputPath,
  horseCount: afterRows.length,
  accepted,
  tanhInputStats,
  beforeSaturationPairs,
  afterSaturationPairs,
  beforeCorrelation,
  afterCorrelation,
  ruleRawMean: ruleRawStats.mean,
  courseCounts,
}, null, 2));
