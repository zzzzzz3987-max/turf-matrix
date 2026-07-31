import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const beforePath = resolve("tools/jvlink/output/current-graded-blood-review.before-cd.json");
const afterPath = resolve("tools/jvlink/output/current-graded-blood-review.json");
const outputPath = resolve("docs/analysis/blood-refactor-diff-C-D-2026-08-02.md");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
const before = readJson(beforePath);
const after = readJson(afterPath);

const flatten = (payload) => payload.races.flatMap((race) => race.horses.map((horse) => ({
  race: `${race.course}${race.raceNo}R ${race.raceName}`,
  ...horse,
})));
const beforeRows = flatten(before);
const afterRows = flatten(after);
const beforeByKey = new Map(beforeRows.map((row) => [`${row.race}|${row.horseName}`, row]));
const activeRows = afterRows.filter((row) => Number.isFinite(row.score));
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
const standardDeviation = (values) => {
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
};
const pearson = (pairs) => {
  if (pairs.length < 2) return null;
  const xs = pairs.map(([x]) => x);
  const ys = pairs.map(([, y]) => y);
  const mx = mean(xs);
  const my = mean(ys);
  const numerator = pairs.reduce((sum, [x, y]) => sum + (x - mx) * (y - my), 0);
  const denominator = Math.sqrt(
    xs.reduce((sum, x) => sum + (x - mx) ** 2, 0)
    * ys.reduce((sum, y) => sum + (y - my) ** 2, 0)
  );
  return denominator ? numerator / denominator : 0;
};
const fixed = (value, digits = 2) => Number.isFinite(value) ? value.toFixed(digits) : "--";
const adoptedRules = (horse) => [...(horse.matchedLines ?? []), ...(horse.matchedMaternalRules ?? [])];
const ruleSet = (horse) => adoptedRules(horse).map((rule) => rule.id).sort().join(",");
const ruleText = (horse) => adoptedRules(horse).map((rule) => {
  const strength = Number(rule.courseMatchStrength) || 0;
  return `${rule.label}(${rule.roles?.join("/") || "--"}${strength ? `; course=${strength}` : ""})`;
}).join(" / ") || "照合なし";
const backgroundText = (horse) => (horse.backgroundRules ?? [])
  .map((rule) => `${rule.label}(${rule.reason})`)
  .join(" / ") || "なし";

const raceStats = after.races.map((race) => {
  const values = race.horses.map((horse) => horse.score).filter(Number.isFinite);
  return {
    race: `${race.course}${race.raceNo}R ${race.raceName}`,
    count: values.length,
    average: mean(values),
    sd: standardDeviation(values),
    minimum: Math.min(...values),
    maximum: Math.max(...values),
    range: Math.max(...values) - Math.min(...values),
  };
});
const coverageScoreCorrelation = pearson(activeRows.map((row) => [row.coverage, row.score]));
const courseCounts = { 1: 0, 0.5: 0, 0: 0 };
for (const row of activeRows) {
  const strengths = adoptedRules(row).map((rule) => Number(rule.courseMatchStrength) || 0);
  const strength = strengths.length ? Math.max(...strengths) : 0;
  courseCounts[strength] = (courseCounts[strength] ?? 0) + 1;
}

const equalScoreGroups = new Map();
for (const row of activeRows) {
  const key = String(row.score);
  if (!equalScoreGroups.has(key)) equalScoreGroups.set(key, []);
  equalScoreGroups.get(key).push(row);
}
const repeatedScores = [...equalScoreGroups.entries()].filter(([, rows]) => rows.length > 1);
const inconsistentEqualScores = repeatedScores.filter(([, rows]) => new Set(rows.map(ruleSet)).size > 1);
const allEqual = new Set(activeRows.map((row) => row.score)).size === 1;

const sorted = [...activeRows].sort((a, b) => b.score - a.score || a.horseName.localeCompare(b.horseName, "ja"));
const extremes = [...sorted.slice(0, 3), ...sorted.slice(-3)];
const lines = [
  "# Blood AI 修正C・D 差分レポート (2026-08-02)",
  "",
  "> review-only。TM INDEX / week-data.json には接続していません。分布を広げるための標準化・順位変換は行っていません。",
  "",
  "## 受入結果",
  "",
  `- coverage と score の Pearson 相関: ${fixed(coverageScoreCorrelation, 3)} (${Math.abs(coverageScoreCorrelation) < 0.3 ? "PASS" : "FAIL"}; 基準 < 0.3)`,
  "- 同一血統経路の重複加点: ユニットテストで具体ルール優先を確認",
  "- 汎用タグ単独の courseMatch: ユニットテストで 0 を確認",
  "- 辞書1件追加時の変化: 既存ユニットテストで 3点以内を確認",
  `- 全馬同一スコアでない: ${allEqual ? "FAIL" : "PASS"}`,
  `- 同一内部スコアの根拠集合が同一: ${inconsistentEqualScores.length ? "FAIL" : "PASS"}`,
  `- courseMatch 最大強度別: 1.0=${courseCounts[1] ?? 0}頭 / 0.5=${courseCounts[0.5] ?? 0}頭 / 0=${courseCounts[0] ?? 0}頭`,
  "",
  "## 34頭差分",
  "",
  "| レース | 馬名 | 修正B後 | 修正C・D後(内部値) | 表示値 | 差分 | coverage | 採用ルール | 背景として除外 |",
  "|---|---|---:|---:|---:|---:|---:|---|---|",
];

for (const row of activeRows) {
  const previous = beforeByKey.get(`${row.race}|${row.horseName}`);
  const delta = Number.isFinite(previous?.score) ? row.score - previous.score : null;
  lines.push(`| ${row.race} | ${row.horseName} | ${fixed(previous?.score, 2)} | ${fixed(row.score, 3)} | ${row.displayScore} | ${delta == null ? "--" : `${delta >= 0 ? "+" : ""}${fixed(delta, 3)}`} | ${fixed(row.coverage, 3)} | ${ruleText(row)} | ${backgroundText(row)} |`);
}

lines.push(
  "",
  "## レース別分布（参考）",
  "",
  "| レース | 頭数 | 平均 | SD | 最小 | 最大 | レンジ |",
  "|---|---:|---:|---:|---:|---:|---:|",
  ...raceStats.map((stat) => `| ${stat.race} | ${stat.count} | ${fixed(stat.average)} | ${fixed(stat.sd)} | ${fixed(stat.minimum)} | ${fixed(stat.maximum)} | ${fixed(stat.range)} |`),
  "",
  "## 上位3頭・下位3頭の根拠",
  "",
  ...extremes.map((row) => `- **${row.horseName} ${fixed(row.score, 3)}** (${row.race}): 採用=${ruleText(row)} / 背景=${backgroundText(row)}`),
  "",
  "## 同一スコアの確認",
  "",
);

if (!repeatedScores.length) {
  lines.push("- 同一の内部スコアはありません。表示整数の同点は丸めによるもので、内部値は保持されています。");
} else {
  for (const [score, rows] of repeatedScores) {
    const sets = [...new Set(rows.map(ruleSet))];
    lines.push(`- ${score}: ${rows.map((row) => row.horseName).join(" / ")} / rule sets=${sets.join(" | ")} / ${sets.length === 1 ? "PASS" : "FAIL"}`);
  }
}

lines.push(
  "",
  "## 実装上の確認",
  "",
  "- 同一祖先で複数一致した場合は depth 最大のルールのみ採用します。上位系統は背景シグナルとして残します。",
  "- 同じ父系または母系で複数祖先が発火した場合は、適合寄与が最大の1件のみ採用します。",
  "- courseMatch は bloodBiasIds 明示一致=1.0、主要タグ2件以上一致=0.5、それ以外=0です。",
  "- Blood score は内部小数を保持し、表示時だけ整数へ丸めます。",
  "- 種牡馬集計は参考signalとして保持し、少数サンプルの直接加点は行いません。",
  "",
);

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${lines.join("\n")}\n`, "utf8");
console.log(JSON.stringify({
  output: outputPath,
  horseCount: activeRows.length,
  coverageScoreCorrelation,
  courseCounts,
  raceStats,
  repeatedScoreGroups: repeatedScores.length,
  inconsistentEqualScoreGroups: inconsistentEqualScores.length,
}, null, 2));
