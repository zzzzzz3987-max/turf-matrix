import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const beforePath = path.join(root, "tools/jvlink/output/current-graded-blood-review.before-refactor.json");
const afterPath = path.join(root, "tools/jvlink/output/current-graded-blood-review.json");
const outputPath = path.join(root, "docs/analysis/blood-refactor-diff-2026-08-02.md");

const readJson = (target) => JSON.parse(fs.readFileSync(target, "utf8"));
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
const standardDeviation = (values) => {
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
};
const correlation = (left, right) => {
  const leftMean = mean(left);
  const rightMean = mean(right);
  const numerator = left.reduce((sum, value, index) => sum + (value - leftMean) * (right[index] - rightMean), 0);
  const denominator = Math.sqrt(
    left.reduce((sum, value) => sum + (value - leftMean) ** 2, 0) *
    right.reduce((sum, value) => sum + (value - rightMean) ** 2, 0)
  );
  return denominator ? numerator / denominator : 0;
};
const signed = (value) => value > 0 ? `+${value}` : String(value);
const raceKey = (race) => `${race.course}|${race.raceNo}|${race.raceName}`;
const horseMap = (race) => new Map(race.horses.map((horse) => [horse.horseName, horse]));
const scoreStats = (horses) => {
  const scores = horses.map((horse) => horse.score);
  const counts = scores.reduce((result, score) => ({ ...result, [score]: (result[score] ?? 0) + 1 }), {});
  return {
    mean: mean(scores),
    sd: standardDeviation(scores),
    min: Math.min(...scores),
    max: Math.max(...scores),
    range: Math.max(...scores) - Math.min(...scores),
    hasTripleTie: Object.values(counts).some((count) => count >= 3),
  };
};

const before = readJson(beforePath);
const after = readJson(afterPath);
const beforeRaces = new Map(before.races.map((race) => [raceKey(race), race]));
const sections = [];
const allCoverage = [];
const allScores = [];

for (const race of after.races) {
  const previous = beforeRaces.get(raceKey(race));
  if (!previous) throw new Error(`修正前レースが見つかりません: ${raceKey(race)}`);
  const previousHorses = horseMap(previous);
  const beforeStats = scoreStats(previous.horses);
  const afterStats = scoreStats(race.horses);
  race.horses.forEach((horse) => {
    allCoverage.push(horse.coverage);
    allScores.push(horse.score);
  });

  const rows = [...race.horses]
    .sort((left, right) => left.horseName.localeCompare(right.horseName, "ja"))
    .map((horse) => {
      const old = previousHorses.get(horse.horseName);
      if (!old) throw new Error(`修正前の馬が見つかりません: ${horse.horseName}`);
      const rules = horse.matchedLines.map((rule) => rule.label).join(" / ") || "辞書未照合";
      return `| ${horse.horseName} | ${old.score} | ${horse.score} | ${signed(horse.score - old.score)} | ${horse.coverage.toFixed(3)} | ${horse.confidence} | ${rules} |`;
    });

  const checks = [
    ["標準偏差 4.0〜7.0", afterStats.sd >= 4 && afterStats.sd <= 7],
    ["レンジ 15以上", afterStats.range >= 15],
    ["同一スコア3頭以上なし", !afterStats.hasTripleTie],
  ];
  sections.push([
    `## ${race.course}${race.raceNo}R ${race.raceName}`,
    "",
    "| 指標 | 修正前 | 修正後 | 受入基準 |",
    "|---|---:|---:|---|",
    `| 平均 | ${beforeStats.mean.toFixed(2)} | ${afterStats.mean.toFixed(2)} | 参考 |`,
    `| 標準偏差 | ${beforeStats.sd.toFixed(2)} | ${afterStats.sd.toFixed(2)} | 4.0〜7.0 ${checks[0][1] ? "PASS" : "FAIL"} |`,
    `| 最小 | ${beforeStats.min} | ${afterStats.min} | 参考 |`,
    `| 最大 | ${beforeStats.max} | ${afterStats.max} | 参考 |`,
    `| レンジ | ${beforeStats.range} | ${afterStats.range} | 15以上 ${checks[1][1] ? "PASS" : "FAIL"} |`,
    `| 同一スコア3頭以上 | ${beforeStats.hasTripleTie ? "あり" : "なし"} | ${afterStats.hasTripleTie ? "あり" : "なし"} | なし ${checks[2][1] ? "PASS" : "FAIL"} |`,
    "",
    "| 馬名 | 修正前 | 修正後 | 差分 | coverage | confidence | 発火ルール |",
    "|---|---:|---:|---:|---:|---|---|",
    ...rows,
  ].join("\n"));
}

const coverageCorrelation = correlation(allCoverage, allScores);
const coveragePass = Math.abs(coverageCorrelation) < 0.5;
const report = [
  "# Blood AI カバレッジ・世代重み分離 差分レポート",
  "",
  "- 対象日: 2026-08-02",
  `- 対象: ${after.raceCount}レース / ${after.horseCount}頭`,
  "- 対象変更: 修正A（coverageとscoreの分離）、修正B（世代別重み）",
  "- 本番TM INDEX / week-data.json: 未変更",
  "- 4〜5代祖先: signalsには保持、score加算は0",
  "",
  "## 全体判定",
  "",
  `- coverageとscoreのPearson相関: ${coverageCorrelation.toFixed(3)}（基準 |r| < 0.5: ${coveragePass ? "PASS" : "FAIL"}）`,
  "- 未照合経路はscoreへ加減点せず、coverageとconfidenceにのみ反映します。",
  "- 分布基準を満たさない項目は、着順や馬名に合わせて人工的に拡張せずFAILとして残します。",
  "",
  ...sections,
  "",
  "## 結論",
  "",
  "coverageとscoreの分離、および4〜5代祖先の非加点化は完了しました。",
  "一方、原因A/Bだけでは指定された分散・レンジ・同点基準を満たしていません。",
  "この候補値は本番へ反映せず、重複系統の集約とコース適合規則を次の独立した検証対象とします。",
  "",
].join("\n");

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, report, "utf8");
console.log(JSON.stringify({ outputPath, raceCount: after.raceCount, horseCount: after.horseCount, coverageCorrelation }, null, 2));
