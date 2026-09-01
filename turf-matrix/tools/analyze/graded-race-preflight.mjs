#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateGradedRaceReadiness } from "../intelligence/graded-race-readiness.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const valueFor = (name, fallback) => {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const stage = valueFor("--stage", "analysis");
if (!new Set(["analysis", "publish"]).has(stage)) throw new Error(`Unknown stage: ${stage}`);
const input = resolve(valueFor("--input", join(ROOT, "tools", "week-data.json")));
const reportDate = new Date().toISOString().slice(0, 10);
const output = resolve(valueFor("--out", join(ROOT, "docs", "analysis", `graded-race-preflight-${reportDate}.md`)));
const weekData = JSON.parse(readFileSync(input, "utf8").replace(/^\uFEFF/, ""));
const result = evaluateGradedRaceReadiness(weekData, { stage });
const ratio = (value, total) => `${value}/${total}`;
const yesNo = (value) => value ? "済" : "未";
const stageLabel = stage === "publish" ? "公開" : "分析";
const lines = [
  `# 重賞事前監査 (${reportDate})`,
  "",
  `- 監査段階: ${stageLabel}`,
  `- 対象: ${result.raceCount}レース`,
  `- 総合状態: ${result.status}`,
  `- 停止条件: ${result.blockers} / 警告: ${result.warnings}`,
  "",
];

if (!result.races.length) {
  lines.push("重賞レースデータはまだありません。出走データ生成後に再実行します。", "");
} else {
  lines.push(
    "## レース別",
    "",
    "| レース | 状態 | 血統4代 | Blood有効 | 血統統計 | 調教 | 好走時比較 | 映像確認 | 斤量 | 展開 | オッズ | 天候 | 馬場 | Bias |",
    "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...result.races.map((race) => {
      const m = race.metrics;
      return `| ${race.track}${race.number}R ${race.name} ${race.grade} | ${race.status} | ${ratio(m.pedigree30, race.horseCount)} | ${ratio(m.bloodActive, race.horseCount)} | ${ratio(m.bloodStatEvidence, race.horseCount)} | ${ratio(m.trainingActive, race.horseCount)} | ${ratio(m.goodRunCompared, race.horseCount)} | ${ratio(m.videoReviewed, race.horseCount)} | ${ratio(m.loadActive, race.horseCount)} | ${ratio(m.paceActive, race.horseCount)} | ${ratio(m.oddsActive, race.horseCount)} | ${yesNo(m.weatherReady)} | ${yesNo(m.goingReady)} | ${yesNo(m.trackBiasActive)} |`;
    }),
    "",
    "## 要確認",
    ""
  );
  for (const race of result.races) {
    lines.push(`### ${race.track}${race.number}R ${race.name}`);
    if (!race.issues.length) lines.push("- 問題なし");
    for (const item of race.issues) {
      const names = item.horses.length ? `: ${item.horses.join("、")}` : "";
      lines.push(`- ${item.severity === "blocker" ? "停止" : "警告"} [${item.key}] ${item.message}${names}`);
    }
    lines.push("");
  }
}

lines.push(
  "## 判定方針",
  "",
  "- 4代30祖先に届かない血統は警告し、3代相当14祖先にも届かない場合は停止する。",
  "- 公式映像の公開有無はweek-dataだけでは判定できないため、映像確認件数を監視し、未確認だけで自動停止しない。",
  "- 分析段階ではオッズ・天候・馬場の欠損を警告、公開段階では停止条件にする。",
  "- Track Biasは当日序盤の確定結果が必要なため、未確定は警告に留める。",
  ""
);
writeFileSync(output, lines.join("\n"));
console.log(JSON.stringify({ output, ...result }, null, 2));
if (stage === "publish" && result.blockers) process.exitCode = 1;
