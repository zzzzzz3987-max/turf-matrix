import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  compatibilityFor,
  dictionaryCompatibilityCenter,
} from "../intelligence/blood-ai.mjs";
import { BLOODLINE_RULES } from "../intelligence/dictionaries/bloodline-dictionary.mjs";
import { FEMALE_LINE_RULES } from "../intelligence/dictionaries/female-line-dictionary.mjs";
import { buildRaceContext } from "../intelligence/race-context.mjs";
import {
  analyzeTraitCenter,
  dictionaryLeafRules,
} from "./blood-center-trait.mjs";

const INPUT_PATH = resolve("tools/jvlink/output/current-graded-blood-review.json");
const OUTPUT_PATH = resolve("docs/analysis/blood-center-compat-leaf-2026-08-02.md");
const AMPLITUDE = 7.5;
const SCALE = 18.75;
const UNSCALED_SCALE = 7.5;
const NEUTRAL_SCORE = 65;
const RAW_MULTIPLIER = 1.5;
const B_RAW_SD = 10.960295524222142;
const MIN_SIGNAL_SD = B_RAW_SD * 0.7;
const ROLE_WEIGHTS = Object.freeze({
  sire: 0.40,
  broodmareSire: 0.25,
  sireSire: 0.12,
  damDam: 0.10,
  generation3: 0.08,
});

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
const fixed = (value, digits = 3) => Number.isFinite(value) ? value.toFixed(digits) : "--";
const signed = (value) => `${value >= 0 ? "+" : ""}${fixed(value)}`;
const contractedScore = (raw, scale = SCALE) => NEUTRAL_SCORE + AMPLITUDE * Math.tanh(raw / scale);

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

const dictionaryRoleWeight = (source) => source === "femaleLine"
  ? ROLE_WEIGHTS.broodmareSire + ROLE_WEIGHTS.damDam + ROLE_WEIGHTS.generation3
  : Object.values(ROLE_WEIGHTS).reduce((sum, value) => sum + value, 0);

export const leafCompatibilityCenter = (context) => {
  const leaves = dictionaryLeafRules(BLOODLINE_RULES, FEMALE_LINE_RULES);
  const population = leaves.map((rule) => ({
    id: rule.id,
    source: rule.source,
    compatibility: compatibilityFor(rule, context) * 100,
    weight: dictionaryRoleWeight(rule.source),
  }));
  return {
    center: weightedMedian(population.map((item) => ({ value: item.compatibility, weight: item.weight }))),
    leafRuleCount: population.length,
    totalWeight: population.reduce((sum, item) => sum + item.weight, 0),
    population,
  };
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

const summarize = (rows, rawKey, scoreKey, scale) => {
  const rawValues = rows.map((row) => row[rawKey]);
  const scores = rows.map((row) => row[scoreKey]);
  return {
    coverageScoreCorrelation: correlation(rows.map((row) => row.coverage), scores),
    saturationPairs: saturationPairCount(rows, rawKey, scoreKey),
    maxTanhInput: Math.max(0, ...rawValues.map((value) => Math.abs(value / scale))),
    rawMean: mean(rawValues),
    rawSd: standardDeviation(rawValues),
    scoreRange: Math.max(...scores) - Math.min(...scores),
  };
};

const sameRuleSetConsistency = (rows) => {
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.raceId}:${row.ruleSignature}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const comparisons = [...groups.values()]
    .filter((group) => group.length > 1)
    .map((group) => ({
      horses: group.map((row) => row.horseName),
      coverages: group.map((row) => row.coverage),
      scores: group.map((row) => row.scoreI),
      consistent: Math.max(...group.map((row) => row.scoreI)) - Math.min(...group.map((row) => row.scoreI)) < 1e-9,
    }));
  return { comparisons, passed: comparisons.every((item) => item.consistent) };
};

export const conceptCompatibilityCheck = () => {
  const speedRule = { id: "speed-probe", traits: { speed: 0.95, power: 0.70, stamina: 0.35, sustain: 0.65 }, fit: [] };
  const staminaRule = { id: "stamina-probe", traits: { speed: 0.40, power: 0.70, stamina: 0.95, sustain: 0.90 }, fit: [] };
  const sprintContext = { traits: { speed: 0.95, power: 0.70, stamina: 0.35, sustain: 0.65 }, bloodBiasIds: [], bloodMajorTags: [] };
  const stayingContext = { traits: { speed: 0.40, power: 0.70, stamina: 0.95, sustain: 0.90 }, bloodBiasIds: [], bloodMajorTags: [] };
  const results = {
    sprintSpeed: compatibilityFor(speedRule, sprintContext),
    sprintStamina: compatibilityFor(staminaRule, sprintContext),
    stayingSpeed: compatibilityFor(speedRule, stayingContext),
    stayingStamina: compatibilityFor(staminaRule, stayingContext),
  };
  return {
    ...results,
    passed: results.sprintSpeed > results.sprintStamina && results.stayingStamina > results.stayingSpeed,
  };
};

export const analyzeCompatibilityLeafCenter = (payload) => {
  const traitResult = analyzeTraitCenter(payload);
  const allRules = [...BLOODLINE_RULES, ...FEMALE_LINE_RULES];
  const ruleMap = new Map(allRules.map((rule) => [rule.id, rule]));
  const raceCenters = new Map();
  const rows = [];

  for (const race of payload.races) {
    const context = buildRaceContext(race);
    const leafCenter = leafCompatibilityCenter(context);
    const fullCenter = dictionaryCompatibilityCenter(context);
    raceCenters.set(race.id, {
      race: `${race.course}${race.raceNo}R ${race.raceName}`,
      leafCenter: leafCenter.center,
      fullCenter: fullCenter.center,
      leafRuleCount: leafCenter.leafRuleCount,
      totalWeight: leafCenter.totalWeight,
    });

    for (const horse of race.horses) {
      const evidence = horse.contributionDiagnostics?.evidence ?? [];
      const totalWeight = evidence.reduce((sum, item) => sum + Number(item.weight ?? 0), 0);
      const compatibilityEvidence = evidence.map((item) => ({
        ...item,
        compatibility: compatibilityFor(ruleMap.get(item.ruleId), context) * 100,
      })).filter((item) => Number.isFinite(item.compatibility));
      const compatibilityWeight = compatibilityEvidence.reduce((sum, item) => sum + Number(item.weight ?? 0), 0);
      const rawB = totalWeight > 0
        ? evidence.reduce((sum, item) => sum + Number(item.raw ?? 0) * Number(item.weight ?? 0), 0) / totalWeight
        : 0;
      const rawD = compatibilityWeight > 0
        ? compatibilityEvidence.reduce((sum, item) => sum + (item.compatibility - fullCenter.center) * RAW_MULTIPLIER * Number(item.weight ?? 0), 0) / compatibilityWeight
        : 0;
      const rawI = compatibilityWeight > 0
        ? compatibilityEvidence.reduce((sum, item) => sum + (item.compatibility - leafCenter.center) * RAW_MULTIPLIER * Number(item.weight ?? 0), 0) / compatibilityWeight
        : 0;
      const traitRow = traitResult.rows.find((item) => item.race === `${race.course}${race.raceNo}R ${race.raceName}` && item.horseName === horse.horseName);
      rows.push({
        raceId: race.id,
        race: `${race.course}${race.raceNo}R ${race.raceName}`,
        horseName: horse.horseName,
        coverage: Number(horse.coverage ?? 0),
        rules: compatibilityEvidence.map((item) => item.ruleId).sort(),
        ruleSignature: compatibilityEvidence
          .map((item) => `${item.ruleId}:${item.branch}:${Number(item.weight ?? 0)}`)
          .sort().join(","),
        centerI: leafCenter.center,
        rawB,
        rawD,
        rawG: traitRow?.rawG ?? 0,
        rawI,
        scoreB: contractedScore(rawB),
        scoreD: contractedScore(rawD),
        scoreG: traitRow?.scoreG ?? NEUTRAL_SCORE,
        scoreI: contractedScore(rawI),
      });
    }
  }

  const scenarioB = summarize(rows, "rawB", "scoreB", SCALE);
  const scenarioD = summarize(rows, "rawD", "scoreD", SCALE);
  const scenarioG = summarize(rows, "rawG", "scoreG", SCALE);
  const scenarioI = summarize(rows, "rawI", "scoreI", SCALE);
  const sameRules = sameRuleSetConsistency(rows);
  const concept = conceptCompatibilityCheck();
  const accepted = (
    scenarioI.coverageScoreCorrelation < 0.3
    && scenarioI.saturationPairs === 0
    && scenarioI.maxTanhInput < 1.5
    && scenarioI.rawSd >= MIN_SIGNAL_SD
    && scenarioI.scoreRange >= 8
    && sameRules.passed
    && concept.passed
  );
  return { rows, raceCenters, scenarioB, scenarioD, scenarioG, scenarioI, sameRules, concept, accepted };
};

const renderReport = (result) => {
  const { rows, raceCenters, scenarioB, scenarioD, scenarioG, scenarioI, sameRules, concept, accepted } = result;
  const lines = [
    "# Blood AI leaf compatibility center what-if (2026-08-02)",
    "",
    "> review-only。本番Blood AI、TM INDEX、week-data.jsonには接続していません。centerは辞書leafルールとrace contextだけから算出し、出走馬・着順・人気・オッズを参照していません。",
    "",
    "## 式と単位",
    "",
    "現行rule rawと同じ信号単位を維持するため、`raw = weightedAverage((compatibilityFor×100 - center) × 1.5)` としました。Bの `×0.4 / scale7.5` は `scale18.75` と数学的に等価です。leaf世代重みは現行の近似であり、Bloodline=0.95、Female line=0.43を各辞書ルールへ付与しています。",
    "",
    "## レース別center",
    "",
    "| レース | 全27ルールmedian(D) | leaf加重median(I) | leaf件数 | 母集団重み |",
    "|---|---:|---:|---:|---:|",
    ...[...raceCenters.values()].map((item) => `| ${item.race} | ${fixed(item.fullCenter)} | ${fixed(item.leafCenter)} | ${item.leafRuleCount} | ${fixed(item.totalWeight)} |`),
    "",
    "## B / D / G / I 比較",
    "",
    "| セル | 定義 | 相関 | 飽和 | 最大|x| | raw平均 | raw SD | Bloodレンジ |",
    "|---|---|---:|---:|---:|---:|---:|---:|",
    `| B | center82 compatibility / scale18.75 | ${fixed(scenarioB.coverageScoreCorrelation)} | ${scenarioB.saturationPairs} | ${fixed(scenarioB.maxTanhInput)} | ${fixed(scenarioB.rawMean)} | ${fixed(scenarioB.rawSd)} | ${fixed(scenarioB.scoreRange)} |`,
    `| D | 全27ルールmedian compatibility / scale18.75 | ${fixed(scenarioD.coverageScoreCorrelation)} | ${scenarioD.saturationPairs} | ${fixed(scenarioD.maxTanhInput)} | ${fixed(scenarioD.rawMean)} | ${fixed(scenarioD.rawSd)} | ${fixed(scenarioD.scoreRange)} |`,
    `| G | leaf trait平均 center73 / scale18.75 | ${fixed(scenarioG.coverageScoreCorrelation)} | ${scenarioG.saturationPairs} | ${fixed(scenarioG.maxTanhInput)} | ${fixed(scenarioG.rawMean)} | ${fixed(scenarioG.rawSd)} | ${fixed(scenarioG.scoreRange)} |`,
    `| I | leaf加重median compatibility / scale18.75 | ${fixed(scenarioI.coverageScoreCorrelation)} | ${scenarioI.saturationPairs} | ${fixed(scenarioI.maxTanhInput)} | ${fixed(scenarioI.rawMean)} | ${fixed(scenarioI.rawSd)} | ${fixed(scenarioI.scoreRange)} |`,
    "",
    `## I採用判定: **${accepted ? "PASS" : "FAIL"}**`,
    "",
    `- 相関 < 0.3 かつ飽和0: ${scenarioI.coverageScoreCorrelation < 0.3 && scenarioI.saturationPairs === 0 ? "PASS" : "FAIL"} (${fixed(scenarioI.coverageScoreCorrelation)}, ${scenarioI.saturationPairs}組)`,
    `- 最大|raw/scale| < 1.5: ${scenarioI.maxTanhInput < 1.5 ? "PASS" : "FAIL"} (${fixed(scenarioI.maxTanhInput)})`,
    `- raw SD >= Bの70% (${fixed(MIN_SIGNAL_SD)}): ${scenarioI.rawSd >= MIN_SIGNAL_SD ? "PASS" : "FAIL"} (${fixed(scenarioI.rawSd)})`,
    `- Blood実効レンジ >= 8: ${scenarioI.scoreRange >= 8 ? "PASS" : "FAIL"} (${fixed(scenarioI.scoreRange)})`,
    `- 同一レース・同一ルール集合なら同一スコア: ${sameRules.passed ? "PASS" : "FAIL"}`,
    `- 短距離speed型 / 長距離stamina型の概念検証: ${concept.passed ? "PASS" : "FAIL"}`,
    "- 辞書追加感度、経路重複排除、汎用タグ、未照合馬は既存回帰テストで継続確認します。",
    "",
    "## 概念検証",
    "",
    `- 短距離: speed型 ${fixed(concept.sprintSpeed)} / stamina型 ${fixed(concept.sprintStamina)}`,
    `- 長距離: speed型 ${fixed(concept.stayingSpeed)} / stamina型 ${fixed(concept.stayingStamina)}`,
    "",
    "## 34頭一覧",
    "",
    "| レース | 馬名 | coverage | 採用ルール | center(I) | B | D | G | I | I-B差 | I raw |",
    "|---|---|---:|---|---:|---:|---:|---:|---:|---:|---:|",
    ...rows.map((row) => `| ${row.race} | ${row.horseName} | ${fixed(row.coverage)} | ${row.rules.join(", ") || "未照合"} | ${fixed(row.centerI)} | ${fixed(row.scoreB)} | ${fixed(row.scoreD)} | ${fixed(row.scoreG)} | ${fixed(row.scoreI)} | ${signed(row.scoreI - row.scoreB)} | ${fixed(row.rawI)} |`),
    "",
    "## 結論",
    "",
    accepted
      ? "Iは数値・信号量・概念の受入基準を満たしました。ただし本番接続は行わず、次工程の血統ベクトル×レース要求ベクトル設計と比較してから採否を決めます。"
      : "Iは受入基準を満たしませんでした。本番接続は行いません。centerやscaleを結果へ合わせず、血統ベクトル×レース要求ベクトルの構造検討へ進みます。",
    "",
  ];
  return `${lines.join("\n")}\n`;
};

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  const payload = JSON.parse(readFileSync(INPUT_PATH, "utf8").replace(/^\uFEFF/, ""));
  const result = analyzeCompatibilityLeafCenter(payload);
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, renderReport(result), "utf8");
  console.log(JSON.stringify({
    output: OUTPUT_PATH,
    horseCount: result.rows.length,
    centers: [...result.raceCenters.values()],
    scenarioB: result.scenarioB,
    scenarioD: result.scenarioD,
    scenarioG: result.scenarioG,
    scenarioI: result.scenarioI,
    concept: result.concept,
    sameRuleSetPassed: result.sameRules.passed,
    accepted: result.accepted,
  }, null, 2));
}
