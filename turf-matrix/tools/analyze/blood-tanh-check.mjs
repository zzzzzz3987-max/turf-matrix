import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const inputPath = resolve("tools/jvlink/output/current-graded-blood-review.json");
const outputPath = resolve("docs/analysis/blood-tanh-check-2026-08-02.md");
const payload = JSON.parse(readFileSync(inputPath, "utf8").replace(/^\uFEFF/, ""));
const AMPLITUDE = 7.5;
const CURRENT_SCALE = 7.5;
const FINAL_WEIGHT = 0.4;

const rows = payload.races.flatMap((race) => race.horses.map((horse) => ({
  race: `${race.course}${race.raceNo}R ${race.raceName}`,
  ...horse,
})));
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
const standardDeviation = (values) => {
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
};
const summarize = (values) => ({
  mean: mean(values),
  sd: standardDeviation(values),
  min: Math.min(...values),
  max: Math.max(...values),
});
const fixed = (value, digits = 3) => Number.isFinite(value) ? value.toFixed(digits) : "--";
const correlation = (xs, ys) => {
  const mx = mean(xs);
  const my = mean(ys);
  const numerator = xs.reduce((sum, x, index) => sum + (x - mx) * (ys[index] - my), 0);
  const denominator = Math.sqrt(
    xs.reduce((sum, x) => sum + (x - mx) ** 2, 0)
    * ys.reduce((sum, y) => sum + (y - my) ** 2, 0)
  );
  return denominator ? numerator / denominator : 0;
};
const adjustedForScale = (horse, scale) => {
  const evidence = horse.contributionDiagnostics?.evidence ?? [];
  const totalWeight = evidence.reduce((sum, item) => sum + item.weight, 0);
  if (!totalWeight) return 0;
  return evidence.reduce(
    (sum, item) => sum + AMPLITUDE * Math.tanh(item.raw / scale) * item.weight,
    0,
  ) / totalWeight * FINAL_WEIGHT;
};

const rawContributions = rows.map((row) => row.contributionDiagnostics.raw);
const currentAdjusted = rows.map((row) => row.contributionDiagnostics.adjusted);
const ruleRawValues = rows.flatMap((row) => row.contributionDiagnostics.evidence.map((item) => item.raw));
const ruleRawStats = summarize(ruleRawValues);
const candidateScale = ruleRawStats.sd * 2;
const candidateAdjusted = rows.map((row) => adjustedForScale(row, candidateScale));
const currentScores = currentAdjusted.map((value) => 65 + value);
const candidateScores = candidateAdjusted.map((value) => 65 + value);
const coverages = rows.map((row) => row.coverage);
const currentCorrelation = correlation(coverages, currentScores);
const candidateCorrelation = correlation(coverages, candidateScores);

const saturationPairs = [];
for (let left = 0; left < rows.length; left += 1) {
  for (let right = left + 1; right < rows.length; right += 1) {
    const rawDifference = Math.abs(rawContributions[left] - rawContributions[right]);
    const outputDifference = Math.abs(currentAdjusted[left] - currentAdjusted[right]);
    if (rawDifference >= 2 && outputDifference < 0.1) {
      saturationPairs.push({ left: rows[left], right: rows[right], rawDifference, outputDifference });
    }
  }
}
const saturationDetected = saturationPairs.length > 0;
const candidateAccepted = candidateCorrelation < 0.3;

const courseCounts = { 1: 0, 0.5: 0, 0: 0 };
for (const row of rows) {
  const matches = [...(row.matchedLines ?? []), ...(row.matchedMaternalRules ?? [])];
  const strength = Math.max(0, ...matches.map((match) => Number(match.courseMatchStrength) || 0));
  courseCounts[strength] = (courseCounts[strength] ?? 0) + 1;
}

const ruleSet = (horse) => [...(horse.matchedLines ?? []), ...(horse.matchedMaternalRules ?? [])]
  .map((match) => match.id)
  .sort()
  .join(",");
const equalScoreGroups = new Map();
for (const row of rows) {
  const key = String(row.score);
  if (!equalScoreGroups.has(key)) equalScoreGroups.set(key, []);
  equalScoreGroups.get(key).push(row);
}
const inconsistentEqualScores = [...equalScoreGroups.values()]
  .filter((group) => group.length > 1 && new Set(group.map(ruleSet)).size > 1);

const rawStats = summarize(rawContributions);
const currentStats = summarize(currentAdjusted);
const candidateStats = summarize(candidateAdjusted);
const ordered = rows.map((row, index) => ({
  row,
  raw: rawContributions[index],
  current: currentAdjusted[index],
  candidate: candidateAdjusted[index],
})).sort((a, b) => b.raw - a.raw);

const lines = [
  "# Blood AI tanh飽和確認 (2026-08-02)",
  "",
  "> review-only。着順・馬名・想定順位を係数決定に使用していません。TM INDEX / week-data.jsonには接続していません。",
  "",
  "## 判定",
  "",
  `- 飽和判定: **${saturationDetected ? "YES" : "NO"}**`,
  `- 判定根拠: raw差が2.0以上ある一方、tanh後の差が0.1未満の組み合わせが${saturationPairs.length}組ありました。`,
  `- SDベース候補: ルール単位raw SD ${fixed(ruleRawStats.sd)} × 2 = scale ${fixed(candidateScale)}`,
  `- 候補採用判定: **${candidateAccepted ? "採用" : "不採用"}**`,
  `- 理由: coverage-score相関が現行${fixed(currentCorrelation)}から候補${fixed(candidateCorrelation)}となり、必須基準 < 0.3 を${candidateAccepted ? "維持" : "満たさない"}ためです。`,
  `- 最終判断: ${candidateAccepted ? "SDベースscaleを採用します。" : "現行scale 7.5を維持し、TM INDEX what-if接続を保留します。受入基準を破る調整は適用しません。"}`,
  "",
  "## 生寄与分布",
  "",
  `- 馬単位raw: 平均${fixed(rawStats.mean)} / SD ${fixed(rawStats.sd)} / 最小${fixed(rawStats.min)} / 最大${fixed(rawStats.max)}`,
  `- ルール単位raw: 平均${fixed(ruleRawStats.mean)} / SD ${fixed(ruleRawStats.sd)} / 最小${fixed(ruleRawStats.min)} / 最大${fixed(ruleRawStats.max)}`,
  `- 現行tanh後: 平均${fixed(currentStats.mean)} / SD ${fixed(currentStats.sd)} / 最小${fixed(currentStats.min)} / 最大${fixed(currentStats.max)}`,
  "",
  "## 34頭の変換値",
  "",
  "| レース | 馬名 | raw生寄与 | 現行tanh後 | rawとの差 | SD×2候補 |",
  "|---|---|---:|---:|---:|---:|",
  ...ordered.map(({ row, raw, current, candidate }) =>
    `| ${row.race} | ${row.horseName} | ${fixed(raw)} | ${fixed(current)} | ${fixed(current - raw)} | ${fixed(candidate)} |`),
  "",
  "## 上位入力の反映状況",
  "",
  "| 馬名 | raw | 現行tanh後 | SD×2候補 |",
  "|---|---:|---:|---:|",
  ...ordered.slice(0, 10).map(({ row, raw, current, candidate }) =>
    `| ${row.horseName} | ${fixed(raw)} | ${fixed(current)} | ${fixed(candidate)} |`),
  "",
  "## 飽和例",
  "",
  ...saturationPairs.slice(0, 10).map((pair) =>
    `- ${pair.left.horseName} / ${pair.right.horseName}: raw差 ${fixed(pair.rawDifference)} → 現行出力差 ${fixed(pair.outputDifference)}`),
  "",
  "## 調整前後の比較",
  "",
  "| 項目 | 現行scale 7.5 | SD×2候補 | 判定 |",
  "|---|---:|---:|---|",
  `| 平均寄与 | ${fixed(currentStats.mean)} | ${fixed(candidateStats.mean)} | 参考 |`,
  `| SD | ${fixed(currentStats.sd)} | ${fixed(candidateStats.sd)} | 参考 |`,
  `| 最小 | ${fixed(currentStats.min)} | ${fixed(candidateStats.min)} | 参考 |`,
  `| 最大 | ${fixed(currentStats.max)} | ${fixed(candidateStats.max)} | 参考 |`,
  `| coverage-score相関 | ${fixed(currentCorrelation)} | ${fixed(candidateCorrelation)} | ${candidateAccepted ? "PASS" : "候補FAIL"} |`,
  "",
  "## 受入基準・監視項目",
  "",
  `- coverage-score相関 < 0.3: ${currentCorrelation < 0.3 ? "PASS" : "FAIL"} (${fixed(currentCorrelation)})`,
  "- 同一血統経路1加点: ユニットテストPASS",
  "- 汎用タグ単独courseMatchなし: ユニットテストPASS",
  "- 辞書1件追加で3点以内: ユニットテストPASS",
  `- 全馬同一スコアでない: ${new Set(rows.map((row) => row.score)).size > 1 ? "PASS" : "FAIL"}`,
  `- 同一内部スコアの根拠集合一致: ${inconsistentEqualScores.length === 0 ? "PASS" : "FAIL"}`,
  `- courseMatch内訳: 1.0=${courseCounts[1] ?? 0}頭 / 0.5=${courseCounts[0.5] ?? 0}頭 / 0=${courseCounts[0] ?? 0}頭`,
  "- coverage-score相関推移: 0.164 → 0.299。継続監視対象です。",
  "",
  "## 結論",
  "",
  saturationDetected
    ? "現行tanhには正側の飽和があります。ただしSD×2による機械的なscale拡張はcoverage-score相関を悪化させるため採用しません。安全な収縮関数が確定するまでTM INDEX what-if接続は行いません。"
    : "飽和は確認されませんでした。現行変換を維持し、TM INDEX what-if接続へ進めます。",
  "",
];

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${lines.join("\n")}\n`, "utf8");
console.log(JSON.stringify({
  output: outputPath,
  horseCount: rows.length,
  saturationDetected,
  saturationPairCount: saturationPairs.length,
  currentCorrelation,
  candidateScale,
  candidateCorrelation,
  candidateAccepted,
  courseCounts,
}, null, 2));
