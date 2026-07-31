import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { dictionaryCompatibilityCenter } from "../intelligence/blood-ai.mjs";
import { BLOODLINE_RULES } from "../intelligence/dictionaries/bloodline-dictionary.mjs";
import { FEMALE_LINE_RULES } from "../intelligence/dictionaries/female-line-dictionary.mjs";
import { buildRaceContext } from "../intelligence/race-context.mjs";

const inputPath = resolve("tools/jvlink/output/current-graded-blood-review.json");
const outputPath = resolve("docs/analysis/blood-center-2x2-2026-08-02.md");
const payload = JSON.parse(readFileSync(inputPath, "utf8").replace(/^\uFEFF/, ""));
const AMPLITUDE = 7.5;
const SCALE = 7.5;
const LEGACY_CENTER = 82;
const FINAL_WEIGHT = 0.4;
const ALL_RULES = [...BLOODLINE_RULES, ...FEMALE_LINE_RULES];

const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
const standardDeviation = (values) => {
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
};
const stats = (values) => ({
  mean: mean(values),
  sd: standardDeviation(values),
  min: Math.min(...values),
  max: Math.max(...values),
  range: Math.max(...values) - Math.min(...values),
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
const saturationPairCount = (rows, rawKey, outputKey) => {
  let count = 0;
  for (let left = 0; left < rows.length; left += 1) {
    for (let right = left + 1; right < rows.length; right += 1) {
      if (
        Math.abs(rows[left][rawKey] - rows[right][rawKey]) >= 2
        && Math.abs(rows[left][outputKey] - rows[right][outputKey]) < 0.1
      ) count += 1;
    }
  }
  return count;
};
const weightedAverage = (evidence, selector) => {
  const totalWeight = evidence.reduce((sum, item) => sum + item.weight, 0);
  return totalWeight
    ? evidence.reduce((sum, item) => sum + selector(item) * item.weight, 0) / totalWeight
    : 0;
};
const recoverCompatibility = (rawAt82) => LEGACY_CENTER + rawAt82 / 1.5;
const rawAtCenter = (item, center) => (recoverCompatibility(item.raw) - center) * 1.5;
const ruleTanh = (raw) => AMPLITUDE * Math.tanh(raw / SCALE);
const horseTanh = (rawHorse) => AMPLITUDE * Math.tanh(rawHorse / SCALE) * FINAL_WEIGHT;

const raceCenters = new Map();
const rows = [];
for (const race of payload.races) {
  const context = buildRaceContext(race);
  const centerResult = dictionaryCompatibilityCenter(context);
  const lowProbe = { id: "low-probe", traits: { speed: 0, power: 0, stamina: 0, sustain: 0 }, fit: [] };
  const highProbe = { id: "high-probe", traits: { speed: 1, power: 1, stamina: 1, sustain: 1 }, fit: [] };
  const lowCenter = dictionaryCompatibilityCenter(context, [...ALL_RULES, lowProbe]).center;
  const highCenter = dictionaryCompatibilityCenter(context, [...ALL_RULES, highProbe]).center;
  raceCenters.set(race.id, {
    race: `${race.course}${race.raceNo}R ${race.raceName}`,
    center: centerResult.center,
    ruleCount: centerResult.ruleCount,
    lowProbeDelta: lowCenter - centerResult.center,
    highProbeDelta: highCenter - centerResult.center,
  });

  for (const horse of race.horses) {
    const evidence = horse.contributionDiagnostics?.evidence ?? [];
    const center = centerResult.center;
    const rawA = weightedAverage(evidence, (item) => item.raw) * FINAL_WEIGHT;
    const outputA = weightedAverage(evidence, (item) => ruleTanh(item.raw)) * FINAL_WEIGHT;
    const outputB = horseTanh(rawA);
    const rawMedianRules = evidence.map((item) => ({ ...item, medianRaw: rawAtCenter(item, center) }));
    const rawC = weightedAverage(rawMedianRules, (item) => item.medianRaw) * FINAL_WEIGHT;
    const outputC = weightedAverage(rawMedianRules, (item) => ruleTanh(item.medianRaw)) * FINAL_WEIGHT;
    const outputD = horseTanh(rawC);
    rows.push({
      raceId: race.id,
      race: `${race.course}${race.raceNo}R ${race.raceName}`,
      horseName: horse.horseName,
      coverage: horse.coverage,
      ruleSet: [...(horse.matchedLines ?? []), ...(horse.matchedMaternalRules ?? [])]
        .map((match) => match.id).sort().join(","),
      center,
      evidence,
      rawA,
      rawC,
      outputA,
      outputB,
      outputC,
      outputD,
      scoreA: 65 + outputA,
      scoreB: 65 + outputB,
      scoreC: 65 + outputC,
      scoreD: 65 + outputD,
    });
  }
}

const allRuleRawLegacy = rows.flatMap((row) => row.evidence.map((item) => item.raw));
const allRuleRawMedian = rows.flatMap((row) => row.evidence.map((item) => rawAtCenter(item, row.center)));
const coverages = rows.map((row) => row.coverage);
const scenarios = {
  A: { label: "ルールtanh × center 82", rawKey: "rawA", outputKey: "outputA", scoreKey: "scoreA", ruleRaw: allRuleRawLegacy, tanhInputs: rows.flatMap((row) => row.evidence.map((item) => item.raw / SCALE)) },
  B: { label: "枝統合後tanh × center 82", rawKey: "rawA", outputKey: "outputB", scoreKey: "scoreB", ruleRaw: allRuleRawLegacy, tanhInputs: rows.map((row) => row.rawA / SCALE) },
  C: { label: "ルールtanh × center median", rawKey: "rawC", outputKey: "outputC", scoreKey: "scoreC", ruleRaw: allRuleRawMedian, tanhInputs: rows.flatMap((row) => row.evidence.map((item) => rawAtCenter(item, row.center) / SCALE)) },
  D: { label: "枝統合後tanh × center median", rawKey: "rawC", outputKey: "outputD", scoreKey: "scoreD", ruleRaw: allRuleRawMedian, tanhInputs: rows.map((row) => row.rawC / SCALE) },
};
for (const scenario of Object.values(scenarios)) {
  scenario.saturationPairs = saturationPairCount(rows, scenario.rawKey, scenario.outputKey);
  scenario.maxTanhInput = Math.max(...scenario.tanhInputs.map(Math.abs));
  scenario.coverageCorrelation = correlation(coverages, rows.map((row) => row[scenario.scoreKey]));
  scenario.ruleRawMean = mean(scenario.ruleRaw);
}

const equalScoreRuleSetsAreConsistent = (scoreKey) => {
  const groups = new Map();
  for (const row of rows) {
    const key = String(row[scoreKey]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row.ruleSet);
  }
  return [...groups.values()].every((group) => group.length === 1 || new Set(group).size === 1);
};
const dAccepted = (
  scenarios.D.coverageCorrelation < 0.3
  && scenarios.D.saturationPairs === 0
  && Math.abs(scenarios.D.ruleRawMean) <= 1
  && new Set(rows.map((row) => row.scoreD)).size > 1
  && equalScoreRuleSetsAreConsistent("scoreD")
);

const raceScenarioStats = (raceId, scoreKey) => stats(rows.filter((row) => row.raceId === raceId).map((row) => row[scoreKey]));
const lines = [
  "# Blood AI center × tanh位置 2×2 what-if (2026-08-02)",
  "",
  "> review-only。centerは各レースコンテキストに対する全27辞書ルールの互換度medianです。出走馬・着順・人気・オッズをcenter算出に使用していません。TM INDEX / week-data.jsonには接続していません。",
  "",
  "## 辞書center",
  "",
  "| レース | center | ルール数 | 低互換ルール1件追加時 | 高互換ルール1件追加時 |",
  "|---|---:|---:|---:|---:|",
  ...[...raceCenters.values()].map((item) => `| ${item.race} | ${fixed(item.center)} | ${item.ruleCount} | ${fixed(item.lowProbeDelta)} | ${fixed(item.highProbeDelta)} |`),
  "",
  "## 2×2結果",
  "",
  "| セル | 条件 | 飽和ペア | 最大|raw/scale| | coverage-score相関 | ルールraw平均 |",
  "|---|---|---:|---:|---:|---:|",
  ...Object.entries(scenarios).map(([key, item]) => `| ${key} | ${item.label} | ${item.saturationPairs} | ${fixed(item.maxTanhInput)} | ${fixed(item.coverageCorrelation)} | ${fixed(item.ruleRawMean)} |`),
  "",
  `## D採用判定: **${dAccepted ? "PASS" : "FAIL"}**`,
  "",
  `- coverage-score相関 < 0.3: ${scenarios.D.coverageCorrelation < 0.3 ? "PASS" : "FAIL"} (${fixed(scenarios.D.coverageCorrelation)})`,
  `- 飽和ペア0組: ${scenarios.D.saturationPairs === 0 ? "PASS" : "FAIL"} (${scenarios.D.saturationPairs})`,
  `- ルールraw平均 0±1.0: ${Math.abs(scenarios.D.ruleRawMean) <= 1 ? "PASS" : "FAIL"} (${fixed(scenarios.D.ruleRawMean)})`,
  `- 全馬同一スコアでない: ${new Set(rows.map((row) => row.scoreD)).size > 1 ? "PASS" : "FAIL"}`,
  `- 同一内部スコアの根拠集合一致: ${equalScoreRuleSetsAreConsistent("scoreD") ? "PASS" : "FAIL"}`,
  "- 辞書1件追加で3点以内、重複排除、汎用タグ、未照合、5代目は既存ユニットテストで確認します。",
  "",
  "## 34頭スコア",
  "",
  "| レース | 馬名 | A | B | C | D | coverage | center |",
  "|---|---|---:|---:|---:|---:|---:|---:|",
  ...rows.map((row) => `| ${row.race} | ${row.horseName} | ${fixed(row.scoreA)} | ${fixed(row.scoreB)} | ${fixed(row.scoreC)} | ${fixed(row.scoreD)} | ${fixed(row.coverage)} | ${fixed(row.center)} |`),
  "",
  "## レース別分布（参考）",
  "",
  "| レース | セル | 平均 | SD | レンジ |",
  "|---|---|---:|---:|---:|",
];
for (const race of payload.races) {
  for (const [key, scenario] of Object.entries(scenarios)) {
    const item = raceScenarioStats(race.id, scenario.scoreKey);
    lines.push(`| ${race.course}${race.raceNo}R ${race.raceName} | ${key} | ${fixed(item.mean)} | ${fixed(item.sd)} | ${fixed(item.range)} |`);
  }
}
lines.push(
  "",
  "## コードレビュー項目",
  "",
  "- center関数の入力はrace contextと辞書ルール配列だけです。week-data、着順、人気、オッズを参照しません。",
  "- medianは外れ値に強い一方、meanを0にする演算ではありません。したがってraw平均条件は実測で独立判定しています。",
  "- centerは固定値ではなく辞書から毎回再計算します。辞書追加時の変動幅は上表に記録しました。",
  "",
  "## 次工程",
  "",
  dAccepted
    ? "Dは全受入基準を満たしました。別工程でTM INDEX what-if接続を検討できます。"
    : "Dは受入基準を満たしません。本番Blood AIおよびTM INDEXへ接続せず、center定義またはcompatibility定義を再検討します。",
  "",
);

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${lines.join("\n")}\n`, "utf8");
console.log(JSON.stringify({
  output: outputPath,
  horseCount: rows.length,
  centers: [...raceCenters.values()],
  scenarios: Object.fromEntries(Object.entries(scenarios).map(([key, item]) => [key, {
    saturationPairs: item.saturationPairs,
    maxTanhInput: item.maxTanhInput,
    coverageCorrelation: item.coverageCorrelation,
    ruleRawMean: item.ruleRawMean,
  }])),
  dAccepted,
}, null, 2));
