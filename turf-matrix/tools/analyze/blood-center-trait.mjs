import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { BLOODLINE_RULES } from "../intelligence/dictionaries/bloodline-dictionary.mjs";
import { FEMALE_LINE_RULES } from "../intelligence/dictionaries/female-line-dictionary.mjs";

const INPUT_PATH = resolve("tools/jvlink/output/current-graded-blood-review.json");
const OUTPUT_PATH = resolve("docs/analysis/blood-center-trait-2026-08-02.md");
const AMPLITUDE = 7.5;
const EFFECTIVE_SCALE = 18.75;
const UNSCALED_SCALE = 7.5;
const NEUTRAL_SCORE = 65;
const ROLE_WEIGHTS = Object.freeze({
  sire: 0.40,
  broodmareSire: 0.25,
  sireSire: 0.12,
  damDam: 0.10,
  generation3: 0.08,
});

const normalizeKey = (value) => String(value ?? "")
  .normalize("NFKC")
  .toLowerCase()
  .replace(/[^a-z0-9]/g, "");

export const ruleTraitScore = (rule) => {
  const values = Object.values(rule?.traits ?? {}).filter(Number.isFinite);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length * 100 : null;
};

const isParentRule = (candidate, rules) => rules.some((child) => {
  if (child === candidate) return false;
  const parent = normalizeKey(child.parentGroup);
  if (!parent) return false;
  return [candidate.label, ...(candidate.terms ?? [])]
    .map(normalizeKey)
    .filter(Boolean)
    .some((term) => term === parent || term.includes(parent) || parent.includes(term));
});

export const dictionaryLeafRules = (
  bloodlineRules = BLOODLINE_RULES,
  femaleLineRules = FEMALE_LINE_RULES,
) => {
  const rules = [
    ...bloodlineRules.map((rule) => ({ ...rule, source: "bloodline" })),
    ...femaleLineRules.map((rule) => ({ ...rule, source: "femaleLine" })),
  ];
  return rules.filter((rule) => !isParentRule(rule, rules));
};

const weightedMedian = (items) => {
  const sorted = [...items].sort((left, right) => left.value - right.value);
  const totalWeight = sorted.reduce((sum, item) => sum + item.weight, 0);
  let cumulative = 0;
  for (const item of sorted) {
    cumulative += item.weight;
    if (cumulative >= totalWeight / 2) return item.value;
  }
  return null;
};

export const dictionaryLeafTraitCenter = (
  bloodlineRules = BLOODLINE_RULES,
  femaleLineRules = FEMALE_LINE_RULES,
) => {
  const leaves = dictionaryLeafRules(bloodlineRules, femaleLineRules);
  const bloodlineRoleWeight = Object.values(ROLE_WEIGHTS).reduce((sum, value) => sum + value, 0);
  const femaleRoleWeight = ROLE_WEIGHTS.broodmareSire + ROLE_WEIGHTS.damDam + ROLE_WEIGHTS.generation3;
  const population = leaves.map((rule) => ({
    id: rule.id,
    source: rule.source,
    depth: Number(rule.depth) || 1,
    traitScore: ruleTraitScore(rule),
    weight: rule.source === "femaleLine" ? femaleRoleWeight : bloodlineRoleWeight,
  })).filter((item) => Number.isFinite(item.traitScore));
  return {
    center: weightedMedian(population.map((item) => ({ value: item.traitScore, weight: item.weight }))),
    leafRuleCount: population.length,
    totalRuleCount: bloodlineRules.length + femaleLineRules.length,
    totalWeight: population.reduce((sum, item) => sum + item.weight, 0),
    population,
  };
};

const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const standardDeviation = (values) => {
  const average = mean(values);
  return values.length ? Math.sqrt(mean(values.map((value) => (value - average) ** 2))) : 0;
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
const contractedScore = (raw, scale) => NEUTRAL_SCORE + AMPLITUDE * Math.tanh(raw / scale);
const fixed = (value, digits = 3) => Number.isFinite(value) ? value.toFixed(digits) : "--";
const signed = (value) => `${value >= 0 ? "+" : ""}${fixed(value)}`;

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

const summarize = (rows, rawKey, scoreKey, scale) => {
  const rawValues = rows.map((row) => row[rawKey]);
  return {
    coverageScoreCorrelation: correlation(rows.map((row) => row.coverage), rows.map((row) => row[scoreKey])),
    saturationPairs: saturationPairCount(rows, rawKey, scoreKey),
    maxTanhInput: Math.max(0, ...rawValues.map((value) => Math.abs(value / scale))),
    rawMean: mean(rawValues),
    rawSd: standardDeviation(rawValues),
  };
};

const sameRuleSetConsistency = (rows, scoreKey) => {
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.ruleSignature)) groups.set(row.ruleSignature, []);
    groups.get(row.ruleSignature).push(row);
  }
  const comparisons = [...groups.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([signature, group]) => ({
      signature,
      horses: group.map((row) => row.horseName),
      scores: group.map((row) => row[scoreKey]),
      coverages: group.map((row) => row.coverage),
      consistent: Math.max(...group.map((row) => row[scoreKey])) - Math.min(...group.map((row) => row[scoreKey])) < 1e-9,
    }));
  return { comparisons, passed: comparisons.every((item) => item.consistent) };
};

export const analyzeTraitCenter = (payload) => {
  const centerResult = dictionaryLeafTraitCenter();
  const ruleMap = new Map([
    ...BLOODLINE_RULES,
    ...FEMALE_LINE_RULES,
  ].map((rule) => [rule.id, rule]));
  const rows = payload.races.flatMap((race) => race.horses.map((horse) => {
    const evidence = horse.contributionDiagnostics?.evidence ?? [];
    const totalWeight = evidence.reduce((sum, item) => sum + Number(item.weight ?? 0), 0);
    const rawE = totalWeight > 0
      ? evidence.reduce((sum, item) => sum + Number(item.raw ?? 0) * Number(item.weight ?? 0), 0) / totalWeight
      : 0;
    // Current behavior: tanh((rawE * 0.4) / 7.5) === tanh(rawE / 18.75).
    const rawB = rawE;
    const traitEvidence = evidence.map((item) => ({
      ...item,
      traitScore: ruleTraitScore(ruleMap.get(item.ruleId)),
    })).filter((item) => Number.isFinite(item.traitScore));
    const traitWeight = traitEvidence.reduce((sum, item) => sum + Number(item.weight ?? 0), 0);
    const rawG = traitWeight > 0
      ? traitEvidence.reduce((sum, item) => sum + (item.traitScore - centerResult.center) * Number(item.weight ?? 0), 0) / traitWeight
      : 0;
    return {
      race: `${race.course}${race.raceNo}R ${race.raceName}`,
      horseName: horse.horseName,
      coverage: Number(horse.coverage ?? 0),
      rules: traitEvidence.map((item) => item.ruleId).sort(),
      ruleSignature: traitEvidence
        .map((item) => `${item.ruleId}:${item.branch}:${Number(item.weight ?? 0)}`)
        .sort().join(","),
      rawB,
      rawE,
      rawG,
      scoreB: contractedScore(rawB, EFFECTIVE_SCALE),
      scoreE: contractedScore(rawE, UNSCALED_SCALE),
      scoreG: contractedScore(rawG, EFFECTIVE_SCALE),
    };
  }));
  const scenarioB = summarize(rows, "rawB", "scoreB", EFFECTIVE_SCALE);
  const scenarioE = summarize(rows, "rawE", "scoreE", UNSCALED_SCALE);
  const scenarioG = summarize(rows, "rawG", "scoreG", EFFECTIVE_SCALE);
  const sameRules = sameRuleSetConsistency(rows, "scoreG");
  const raceCenters = [...new Set(payload.races.map(() => centerResult.center))];
  const accepted = (
    scenarioG.coverageScoreCorrelation < 0.3
    && scenarioG.saturationPairs === 0
    && scenarioG.maxTanhInput < 1.5
    && raceCenters.length === 1
    && sameRules.passed
  );
  return { centerResult, rows, scenarioB, scenarioE, scenarioG, sameRules, raceCenters, accepted };
};

const renderReport = (result) => {
  const { centerResult, rows, scenarioB, scenarioE, scenarioG, sameRules, raceCenters, accepted } = result;
  const lines = [
    "# Blood AI レース非依存trait center what-if (2026-08-02)",
    "",
    "> review-only。本番Blood AI、TM INDEX、week-data.jsonには接続していません。着順・人気・オッズ・出走馬からcenterを決めていません。",
    "",
    "## center定義",
    "",
    "現辞書には単一のtraitScoreがないため、各leafルールの `speed / power / stamina / sustain` の算術平均×100をレース非依存traitScoreと定義しました。系統ツリーdepthと血統表上の世代は混同していません。Bloodlineルールは父・母父・父父・母母・3代の適用可能重み合計0.95、Female lineルールは母父・母母・3代の合計0.43をweighted medianの母集団重みに使用しました。",
    "",
    `- center_trait: **${fixed(centerResult.center)}**`,
    `- leafルール: ${centerResult.leafRuleCount} / 全${centerResult.totalRuleCount}件`,
    `- 母集団総重み: ${fixed(centerResult.totalWeight)}`,
    `- 全レース共通center: ${raceCenters.length === 1 ? "PASS" : "FAIL"}`,
    "- 予測値約95とは大きく異なります。trait平均と旧compatibilityForは同一尺度ではないため、数値を調整していません。",
    "",
    "## leaf母集団",
    "",
    "| rule | source | depth | traitScore | weight |",
    "|---|---|---:|---:|---:|",
    ...centerResult.population.map((item) => `| ${item.id} | ${item.source} | ${item.depth} | ${fixed(item.traitScore)} | ${fixed(item.weight)} |`),
    "",
    "## B / E / G 比較",
    "",
    "`B adjusted = 7.5 × tanh(horse_raw / 18.75)` と明示し、従来の `×0.4` と数学的に等価なscaleとして扱っています。",
    "",
    "| セル | center / scale | coverage-score相関 | 飽和ペア | 最大|raw/scale| | raw平均 | raw SD |",
    "|---|---|---:|---:|---:|---:|---:|",
    `| B | center82 / 18.75 | ${fixed(scenarioB.coverageScoreCorrelation)} | ${scenarioB.saturationPairs} | ${fixed(scenarioB.maxTanhInput)} | ${fixed(scenarioB.rawMean)} | ${fixed(scenarioB.rawSd)} |`,
    `| E | center82 / 7.5 | ${fixed(scenarioE.coverageScoreCorrelation)} | ${scenarioE.saturationPairs} | ${fixed(scenarioE.maxTanhInput)} | ${fixed(scenarioE.rawMean)} | ${fixed(scenarioE.rawSd)} |`,
    `| G | leaf trait center ${fixed(centerResult.center)} / 18.75 | ${fixed(scenarioG.coverageScoreCorrelation)} | ${scenarioG.saturationPairs} | ${fixed(scenarioG.maxTanhInput)} | ${fixed(scenarioG.rawMean)} | ${fixed(scenarioG.rawSd)} |`,
    "",
    `## G採用判定: **${accepted ? "PASS" : "FAIL"}**`,
    "",
    `- coverage-score相関 < 0.3（飽和0と同時成立）: ${scenarioG.coverageScoreCorrelation < 0.3 && scenarioG.saturationPairs === 0 ? "PASS" : "FAIL"} (${fixed(scenarioG.coverageScoreCorrelation)}, 飽和${scenarioG.saturationPairs}組)`,
    `- 飽和ペア0組: ${scenarioG.saturationPairs === 0 ? "PASS" : "FAIL"}`,
    `- 最大|raw/scale| < 1.5: ${scenarioG.maxTanhInput < 1.5 ? "PASS" : "FAIL"} (${fixed(scenarioG.maxTanhInput)})`,
    `- centerが全レース同一: ${raceCenters.length === 1 ? "PASS" : "FAIL"} (${raceCenters.map((value) => fixed(value)).join(", ")})`,
    `- 同一ルール集合なら同一スコア: ${sameRules.passed ? "PASS" : "FAIL"}`,
    "- 辞書追加感度、経路重複排除、汎用タグ、未照合馬は既存Blood AI回帰テストで継続確認します。",
    "",
    "## 34頭スコア",
    "",
    "| レース | 馬名 | coverage | 採用ルール | B | E | G | G-B差 | G raw |",
    "|---|---|---:|---|---:|---:|---:|---:|---:|",
    ...rows.map((row) => `| ${row.race} | ${row.horseName} | ${fixed(row.coverage)} | ${row.rules.join(", ") || "未照合"} | ${fixed(row.scoreB)} | ${fixed(row.scoreE)} | ${fixed(row.scoreG)} | ${signed(row.scoreG - row.scoreB)} | ${fixed(row.rawG)} |`),
    "",
    "## 結論",
    "",
    accepted
      ? "Gは指定した受入基準を満たしました。ただしtraitScoreの暫定定義を含むため、本番接続前にtrait/courseFitの完全分離設計を確認する必要があります。"
      : "Gは受入基準を満たしませんでした。本番接続は行いません。予測値との乖離は、辞書traitの強さとレース互換度が現行データ構造で別尺度になっていることを示します。次工程は定数調整ではなく、traitScoreとcourseFitの完全分離です。",
    "",
  ];
  return `${lines.join("\n")}\n`;
};

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  const payload = JSON.parse(readFileSync(INPUT_PATH, "utf8").replace(/^\uFEFF/, ""));
  const result = analyzeTraitCenter(payload);
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, renderReport(result), "utf8");
  console.log(JSON.stringify({
    output: OUTPUT_PATH,
    horseCount: result.rows.length,
    center: result.centerResult.center,
    leafRuleCount: result.centerResult.leafRuleCount,
    scenarioB: result.scenarioB,
    scenarioE: result.scenarioE,
    scenarioG: result.scenarioG,
    sameRuleSetPassed: result.sameRules.passed,
    accepted: result.accepted,
  }, null, 2));
}
