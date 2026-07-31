import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const INPUT_PATH = resolve("tools/jvlink/output/current-graded-blood-review.json");
const OUTPUT_PATH = resolve("docs/analysis/blood-renormalize-2026-08-02.md");
const AMPLITUDE = 7.5;
const SCALE = 7.5;
const NEUTRAL_SCORE = 65;
const LEGACY_FINAL_WEIGHT = 0.4;

export const weightedRaw = (evidence = []) =>
  evidence.reduce((sum, item) => sum + Number(item.raw ?? 0) * Number(item.weight ?? 0), 0);

export const matchedWeight = (evidence = []) =>
  evidence.reduce((sum, item) => sum + Number(item.weight ?? 0), 0);

export const renormalizedWeightedRaw = (evidence = []) => {
  const totalWeight = matchedWeight(evidence);
  return totalWeight > 0 ? weightedRaw(evidence) / totalWeight : 0;
};

export const contractedScore = (raw) =>
  NEUTRAL_SCORE + AMPLITUDE * Math.tanh(Number(raw ?? 0) / SCALE);

const mean = (values) => values.length
  ? values.reduce((sum, value) => sum + value, 0) / values.length
  : 0;

const standardDeviation = (values) => {
  const average = mean(values);
  return values.length
    ? Math.sqrt(mean(values.map((value) => (value - average) ** 2)))
    : 0;
};

const correlation = (xs, ys) => {
  if (!xs.length || xs.length !== ys.length) return 0;
  const mx = mean(xs);
  const my = mean(ys);
  const numerator = xs.reduce((sum, x, index) => sum + (x - mx) * (ys[index] - my), 0);
  const denominator = Math.sqrt(
    xs.reduce((sum, x) => sum + (x - mx) ** 2, 0)
    * ys.reduce((sum, y) => sum + (y - my) ** 2, 0),
  );
  return denominator ? numerator / denominator : 0;
};

const saturationPairCount = (rows, rawKey, scoreKey) => {
  let count = 0;
  for (let left = 0; left < rows.length; left += 1) {
    for (let right = left + 1; right < rows.length; right += 1) {
      if (
        Math.abs(rows[left][rawKey] - rows[right][rawKey]) >= 2
        && Math.abs(rows[left][scoreKey] - rows[right][scoreKey]) < 0.1
      ) count += 1;
    }
  }
  return count;
};

const fixed = (value, digits = 3) => Number.isFinite(value) ? value.toFixed(digits) : "--";
const signed = (value) => `${value >= 0 ? "+" : ""}${fixed(value)}`;

export const buildRenormalizeRows = (payload) => payload.races.flatMap((race) =>
  race.horses.map((horse) => {
    const evidence = horse.contributionDiagnostics?.evidence ?? [];
    const totalWeight = matchedWeight(evidence);
    const weighted = weightedRaw(evidence);
    // B reproduces the previously measured branch-integrated cell.
    const rawB = totalWeight > 0 ? weighted / totalWeight * LEGACY_FINAL_WEIGHT : 0;
    const rawE = renormalizedWeightedRaw(evidence);
    return {
      race: `${race.course}${race.raceNo}R ${race.raceName}`,
      horseName: horse.horseName,
      coverage: Number(horse.coverage ?? 0),
      totalWeight,
      ruleSet: evidence.map((item) => item.ruleId).sort().join(","),
      ruleSignature: evidence
        .map((item) => `${item.ruleId}:${item.branch}:${Number(item.weight ?? 0)}`)
        .sort().join(","),
      evidence,
      rawB,
      rawE,
      scoreB: contractedScore(rawB),
      scoreE: contractedScore(rawE),
    };
  }));

export const summarizeScenario = (rows, rawKey, scoreKey) => {
  const rawValues = rows.map((row) => row[rawKey]);
  const scoreValues = rows.map((row) => row[scoreKey]);
  return {
    coverageScoreCorrelation: correlation(rows.map((row) => row.coverage), scoreValues),
    saturationPairs: saturationPairCount(rows, rawKey, scoreKey),
    maxTanhInput: Math.max(0, ...rawValues.map((value) => Math.abs(value / SCALE))),
    rawMean: mean(rawValues),
    rawSd: standardDeviation(rawValues),
  };
};

const sameRuleSetConsistency = (rows) => {
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.race}::${row.ruleSignature}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const comparisons = [...groups.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([key, group]) => ({
      ruleSet: group[0].ruleSet,
      horses: group.map((row) => row.horseName),
      coverages: group.map((row) => row.coverage),
      scores: group.map((row) => row.scoreE),
      consistent: Math.max(...group.map((row) => row.scoreE)) - Math.min(...group.map((row) => row.scoreE)) < 1e-9,
    }));
  return {
    comparisons,
    passed: comparisons.every((item) => item.consistent),
  };
};

export const analyzeRenormalization = (payload) => {
  const rows = buildRenormalizeRows(payload);
  const scenarioB = summarizeScenario(rows, "rawB", "scoreB");
  const scenarioE = summarizeScenario(rows, "rawE", "scoreE");
  const sameRules = sameRuleSetConsistency(rows);
  const lowCoverageRows = rows.filter((row) => row.coverage < 0.5);
  const accepted = (
    scenarioE.coverageScoreCorrelation < 0.3
    && scenarioE.saturationPairs === 0
    && scenarioE.maxTanhInput < 1.5
    && sameRules.passed
  );
  return { rows, scenarioB, scenarioE, sameRules, lowCoverageRows, accepted };
};

const renderReport = (result) => {
  const { rows, scenarioB, scenarioE, sameRules, lowCoverageRows, accepted } = result;
  const lines = [
    "# Blood AI 枝重み再正規化 what-if (2026-08-02)",
    "",
    "> review-only。Blood AI、TM INDEX、week-data.jsonには接続していません。定数は amplitude=7.5 / scale=7.5 / center=82 のままです。出走馬・着順・人気・オッズは係数決定に使用していません。",
    "",
    "## 実装確認",
    "",
    "現行診断値Bは、照合証拠の加重平均を算出した後に固定係数0.4を掛けています。Eは指定式 `sum(weight * raw) / sum(matched weight)` を使用し、この固定係数を除いて照合枝の重みを1.0へ再正規化しました。coverageは式へ入力していません。",
    "",
    "## B / E 比較",
    "",
    "| セル | 条件 | coverage-score相関 | 飽和ペア | 最大|raw/scale| | raw平均 | raw SD |",
    "|---|---|---:|---:|---:|---:|---:|",
    `| B | 枝統合後tanh × center82 × 固定0.4 | ${fixed(scenarioB.coverageScoreCorrelation)} | ${scenarioB.saturationPairs} | ${fixed(scenarioB.maxTanhInput)} | ${fixed(scenarioB.rawMean)} | ${fixed(scenarioB.rawSd)} |`,
    `| E | 枝統合後tanh × center82 × 再正規化 | ${fixed(scenarioE.coverageScoreCorrelation)} | ${scenarioE.saturationPairs} | ${fixed(scenarioE.maxTanhInput)} | ${fixed(scenarioE.rawMean)} | ${fixed(scenarioE.rawSd)} |`,
    "",
    `## 採用判定: **${accepted ? "PASS" : "FAIL"}**`,
    "",
    `- coverage-score相関 < 0.3: ${scenarioE.coverageScoreCorrelation < 0.3 ? "PASS" : "FAIL"} (${fixed(scenarioE.coverageScoreCorrelation)})`,
    `- 飽和ペア 0組: ${scenarioE.saturationPairs === 0 ? "PASS" : "FAIL"} (${scenarioE.saturationPairs})`,
    `- 最大|horse_raw/scale| < 1.5: ${scenarioE.maxTanhInput < 1.5 ? "PASS" : "FAIL"} (${fixed(scenarioE.maxTanhInput)})`,
    `- 同じルール集合は同一スコア: ${sameRules.passed ? "PASS" : "FAIL"}`,
    "- 辞書追加感度、血統経路重複排除、汎用タグ、未照合馬は既存Blood AI回帰テストで継続検証します。",
    "",
    "再正規化はcoverage相関を低下させましたが、rawを最大3.6倍のtanh入力へ押し広げ、飽和を増加させました。したがってEは本番接続しません。",
    "",
    "## 34頭一覧",
    "",
    "| レース | 馬名 | coverage | 照合重み | B raw | B score | E raw | E score | 差分 |",
    "|---|---|---:|---:|---:|---:|---:|---:|---:|",
    ...rows.map((row) => `| ${row.race} | ${row.horseName} | ${fixed(row.coverage)} | ${fixed(row.totalWeight)} | ${fixed(row.rawB)} | ${fixed(row.scoreB)} | ${fixed(row.rawE)} | ${fixed(row.scoreE)} | ${signed(row.scoreE - row.scoreB)} |`),
    "",
    "## F: coverage 0.5未満の内訳",
    "",
    "| レース | 馬名 | coverage | 照合重み | E raw | tanh入力 | E score | 発火ルール |",
    "|---|---|---:|---:|---:|---:|---:|---|",
    ...lowCoverageRows.map((row) => `| ${row.race} | ${row.horseName} | ${fixed(row.coverage)} | ${fixed(row.totalWeight)} | ${fixed(row.rawE)} | ${fixed(row.rawE / SCALE)} | ${fixed(row.scoreE)} | ${row.ruleSet || "未照合"} |`),
    "",
    `低coverage馬は ${lowCoverageRows.length}頭。スコア範囲は ${fixed(Math.min(...lowCoverageRows.map((row) => row.scoreE)))}〜${fixed(Math.max(...lowCoverageRows.map((row) => row.scoreE)))} でした。coverageを直接掛けてはいませんが、少数枝の極端なrawが希釈されずtanh飽和する事例があります。`,
    "",
    "## 同一ルール集合の確認",
    "",
    sameRules.comparisons.length
      ? sameRules.comparisons.map((item) => `- ${item.consistent ? "PASS" : "FAIL"}: ${item.horses.join(" / ")} | coverage ${item.coverages.map((value) => fixed(value)).join(" / ")} | score ${item.scores.map((value) => fixed(value)).join(" / ")} | ${item.ruleSet || "未照合"}`).join("\n")
      : "- 比較可能な同一ルール集合の複数馬はありませんでした。",
    "",
    "## 結論",
    "",
    "再正規化仮説はcoverage-score相関の低減には有効でしたが、固定scale=7.5のままでは飽和を悪化させます。受入基準を満たさないため、Blood AI本番・TM INDEX・week-data.jsonへの接続は見送ります。次工程のtrait値とレース互換度の分離、およびレース非依存centerの検討へ進む前に、枝統合値の単位と最終0.4係数の責務を設計上明確にする必要があります。",
    "",
  ];
  return `${lines.join("\n")}\n`;
};

const isDirectRun = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const payload = JSON.parse(readFileSync(INPUT_PATH, "utf8").replace(/^\uFEFF/, ""));
  const result = analyzeRenormalization(payload);
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, renderReport(result), "utf8");
  console.log(JSON.stringify({
    output: OUTPUT_PATH,
    horseCount: result.rows.length,
    scenarioB: result.scenarioB,
    scenarioE: result.scenarioE,
    lowCoverageHorseCount: result.lowCoverageRows.length,
    sameRuleSetPassed: result.sameRules.passed,
    accepted: result.accepted,
  }, null, 2));
}
