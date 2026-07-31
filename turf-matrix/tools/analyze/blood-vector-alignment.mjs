import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { BLOODLINE_RULES } from "../intelligence/dictionaries/bloodline-dictionary.mjs";
import { FEMALE_LINE_RULES } from "../intelligence/dictionaries/female-line-dictionary.mjs";
import { buildRaceContext } from "../intelligence/race-context.mjs";

const INPUT_PATH = resolve("tools/jvlink/output/current-graded-blood-review.json");
const OUTPUT_PATH = resolve("docs/analysis/blood-vector-alignment-2026-08-02.md");
const TRAITS = Object.freeze(["speed", "power", "stamina", "sustain"]);
const NEUTRAL_TRAIT = 0.5;
const NEUTRAL_SCORE = 65;
const AMPLITUDE = 7.5;

export const signedVectorAlignment = (ruleTraits = {}, raceTraits = {}) => {
  const products = TRAITS.map((trait) => {
    const ruleValue = Number(ruleTraits[trait]);
    const raceValue = Number(raceTraits[trait]);
    if (!Number.isFinite(ruleValue) || !Number.isFinite(raceValue)) return null;
    return 4 * (ruleValue - NEUTRAL_TRAIT) * (raceValue - NEUTRAL_TRAIT);
  }).filter(Number.isFinite);
  return products.length ? products.reduce((sum, value) => sum + value, 0) / products.length : 0;
};

export const vectorBloodScore = (alignment) => NEUTRAL_SCORE + AMPLITUDE * Number(alignment ?? 0);

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

export const vectorConceptCheck = () => {
  const speed = { speed: 0.95, power: 0.70, stamina: 0.35, sustain: 0.65 };
  const stamina = { speed: 0.40, power: 0.70, stamina: 0.95, sustain: 0.90 };
  const sprintNeed = { speed: 0.95, power: 0.70, stamina: 0.35, sustain: 0.65 };
  const stayingNeed = { speed: 0.40, power: 0.70, stamina: 0.95, sustain: 0.90 };
  const result = {
    sprintSpeed: signedVectorAlignment(speed, sprintNeed),
    sprintStamina: signedVectorAlignment(stamina, sprintNeed),
    stayingSpeed: signedVectorAlignment(speed, stayingNeed),
    stayingStamina: signedVectorAlignment(stamina, stayingNeed),
    neutral: signedVectorAlignment(
      { speed: 0.5, power: 0.5, stamina: 0.5, sustain: 0.5 },
      sprintNeed,
    ),
  };
  return {
    ...result,
    passed: result.sprintSpeed > result.sprintStamina
      && result.stayingStamina > result.stayingSpeed
      && result.neutral === 0,
  };
};

export const analyzeVectorAlignment = (payload) => {
  const ruleMap = new Map([...BLOODLINE_RULES, ...FEMALE_LINE_RULES].map((rule) => [rule.id, rule]));
  const rows = payload.races.flatMap((race) => {
    const context = buildRaceContext(race);
    return race.horses.map((horse) => {
      const evidence = horse.contributionDiagnostics?.evidence ?? [];
      const weighted = evidence.map((item) => ({
        ...item,
        alignment: signedVectorAlignment(ruleMap.get(item.ruleId)?.traits, context.traits),
      }));
      const totalWeight = weighted.reduce((sum, item) => sum + Number(item.weight ?? 0), 0);
      const alignment = totalWeight > 0
        ? weighted.reduce((sum, item) => sum + item.alignment * Number(item.weight ?? 0), 0) / totalWeight
        : 0;
      const currentRaw = totalWeight > 0
        ? evidence.reduce((sum, item) => sum + Number(item.raw ?? 0) * Number(item.weight ?? 0), 0) / totalWeight
        : 0;
      const currentScore = NEUTRAL_SCORE + AMPLITUDE * Math.tanh(currentRaw / 18.75);
      return {
        race: `${race.course}${race.raceNo}R ${race.raceName}`,
        horseName: horse.horseName,
        coverage: Number(horse.coverage ?? 0),
        rules: weighted.map((item) => item.ruleId).sort(),
        alignment,
        scoreJ: vectorBloodScore(alignment),
        currentScore,
      };
    });
  });
  const alignments = rows.map((row) => row.alignment);
  const scores = rows.map((row) => row.scoreJ);
  const concept = vectorConceptCheck();
  const summary = {
    coverageScoreCorrelation: correlation(rows.map((row) => row.coverage), scores),
    alignmentMean: mean(alignments),
    alignmentSd: standardDeviation(alignments),
    scoreMean: mean(scores),
    scoreSd: standardDeviation(scores),
    scoreMin: Math.min(...scores),
    scoreMax: Math.max(...scores),
    scoreRange: Math.max(...scores) - Math.min(...scores),
  };
  return { rows, concept, summary };
};

const renderReport = ({ rows, concept, summary }) => {
  const lines = [
    "# Blood AI vector alignment what-if / Cell J (2026-08-02)",
    "",
    "> review-only。本番Blood AI、TM INDEX、week-data.jsonには接続していません。center、着順、人気、オッズ、coverage補正を使用していません。",
    "",
    "## 式",
    "",
    "各traitを0.5中心の符号付きベクトルへ変換し、血統とレース要求の方向一致を直接測定します。",
    "",
    "```text",
    "axisAlignment = 4 × (bloodTrait - 0.5) × (raceNeed - 0.5)",
    "ruleAlignment = mean(axisAlignment[4 traits])       # -1..+1",
    "horseAlignment = weightedAverage(adopted rules)",
    "Blood score J = 65 + 7.5 × horseAlignment",
    "```",
    "",
    "高いtrait総量ではなく方向一致を評価します。0.5の中立ベクトルは必ず寄与0です。courseMatchの追加加点は行っていません。",
    "",
    "## 結果",
    "",
    `- coverage-score相関: ${fixed(summary.coverageScoreCorrelation)}`,
    `- alignment平均 / SD: ${fixed(summary.alignmentMean)} / ${fixed(summary.alignmentSd)}`,
    `- Blood平均 / SD: ${fixed(summary.scoreMean)} / ${fixed(summary.scoreSd)}`,
    `- Blood最小 / 最大 / レンジ: ${fixed(summary.scoreMin)} / ${fixed(summary.scoreMax)} / ${fixed(summary.scoreRange)}`,
    `- 概念検証: ${concept.passed ? "PASS" : "FAIL"}`,
    "",
    "相関0.3未満・実効レンジ8点以上を満たしていないため、本番候補にはしません。centerを除いても、compatibility最大で採用ルールを選ぶ前段が類似ルールへ収束させている可能性があります。",
    "",
    "## 概念検証",
    "",
    `- 短距離: speed型 ${fixed(concept.sprintSpeed)} / stamina型 ${fixed(concept.sprintStamina)}`,
    `- 長距離: speed型 ${fixed(concept.stayingSpeed)} / stamina型 ${fixed(concept.stayingStamina)}`,
    `- 中立ベクトル: ${fixed(concept.neutral)}`,
    "",
    "## 34頭一覧",
    "",
    "| レース | 馬名 | coverage | 採用ルール | 現行相当B | J | 差分 | alignment |",
    "|---|---|---:|---|---:|---:|---:|---:|",
    ...rows.map((row) => `| ${row.race} | ${row.horseName} | ${fixed(row.coverage)} | ${row.rules.join(", ") || "未照合"} | ${fixed(row.currentScore)} | ${fixed(row.scoreJ)} | ${signed(row.scoreJ - row.currentScore)} | ${fixed(row.alignment)} |`),
    "",
    "## 結論",
    "",
    "ベクトル一致度の概念自体は正しく動きましたが、現在の採用済みルール集合では分散が不足し、coverage相関も残りました。次はスコア式を調整せず、`resolveRuleMatches`のbranch最大選択を外したwhat-ifで、各血統経路を独立に集約した場合の情報量を測定します。",
    "",
  ];
  return `${lines.join("\n")}\n`;
};

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  const payload = JSON.parse(readFileSync(INPUT_PATH, "utf8").replace(/^\uFEFF/, ""));
  const result = analyzeVectorAlignment(payload);
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, renderReport(result), "utf8");
  console.log(JSON.stringify({ output: OUTPUT_PATH, horseCount: result.rows.length, ...result.summary, concept: result.concept }, null, 2));
}
