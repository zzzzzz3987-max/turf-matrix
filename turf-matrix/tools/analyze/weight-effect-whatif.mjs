#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TOOLS_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const REPO_ROOT = join(TOOLS_DIR, "..");
const ARCHIVE_DIR = join(REPO_ROOT, "data", "archive");
const SNAPSHOT_DATE = "2026-07-26";
const SNAPSHOT_PATH = join(ARCHIVE_DIR, `${SNAPSHOT_DATE}-preodds.json`);
const RESULTS_PATH = join(ARCHIVE_DIR, `${SNAPSHOT_DATE}-results.json`);
const JVLINK_SUMMARY_PATH = join(REPO_ROOT, "tools", "jvlink", "output", "intelligence-summary.json");
const OUTPUT_PATH = join(REPO_ROOT, "docs", "analysis", `weight-effect-${SNAPSHOT_DATE}.md`);

const BAND_ORDER = ["-3kg以上減", "-2〜-1kg減", "増減なし", "+1〜+2kg増", "+3kg以上増"];
const CONDITION_ORDER = ["全体", "ハンデ戦", "別定戦", "馬齢戦", "定量戦", "不明"];
const WEIGHT_RULES = Object.freeze({ "1": "ハンデ", "2": "別定", "3": "馬齢", "4": "定量" });
const COURSE_CODES = Object.freeze({
  札幌: "01", 函館: "02", 福島: "03", 新潟: "04", 東京: "05",
  中山: "06", 中京: "07", 京都: "08", 阪神: "09", 小倉: "10",
});

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const finite = (value) => Number.isFinite(Number(value));
const numberOrNull = (value) => finite(value) ? Number(value) : null;
const mean = (values) => values.length
  ? values.reduce((sum, value) => sum + value, 0) / values.length
  : null;
const format = (value, digits = 3) => value == null ? "—" : Number(value).toFixed(digits);
const signed = (value, digits = 2) => value == null ? "—" : `${value > 0 ? "+" : ""}${Number(value).toFixed(digits)}`;
const percent = (hits, total) => total ? `${(hits / total * 100).toFixed(1)}%` : "—";

const normalizeHorseName = (value) => String(value ?? "")
  .normalize("NFKC")
  .replace(/[\s\u3000]/g, "")
  .replace(/^[*＊$]+/, "");

const averageRanks = (values) => {
  const sorted = values.map((value, index) => ({ value, index })).sort((left, right) => left.value - right.value);
  const ranks = Array(values.length);
  for (let start = 0; start < sorted.length;) {
    let end = start + 1;
    while (end < sorted.length && sorted[end].value === sorted[start].value) end += 1;
    const rank = (start + 1 + end) / 2;
    for (let index = start; index < end; index += 1) ranks[sorted[index].index] = rank;
    start = end;
  }
  return ranks;
};

const pearson = (left, right) => {
  if (left.length < 3 || left.length !== right.length) return null;
  const leftMean = mean(left);
  const rightMean = mean(right);
  let numerator = 0;
  let leftSquares = 0;
  let rightSquares = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftDelta = left[index] - leftMean;
    const rightDelta = right[index] - rightMean;
    numerator += leftDelta * rightDelta;
    leftSquares += leftDelta ** 2;
    rightSquares += rightDelta ** 2;
  }
  const denominator = Math.sqrt(leftSquares * rightSquares);
  return denominator ? numerator / denominator : null;
};

const spearman = (pairs) => pearson(
  averageRanks(pairs.map(([left]) => left)),
  averageRanks(pairs.map(([, right]) => right)),
);

const regressionSlope = (pairs) => {
  if (pairs.length < 2) return null;
  const xMean = mean(pairs.map(([x]) => x));
  const yMean = mean(pairs.map(([, y]) => y));
  const numerator = pairs.reduce((sum, [x, y]) => sum + (x - xMean) * (y - yMean), 0);
  const denominator = pairs.reduce((sum, [x]) => sum + (x - xMean) ** 2, 0);
  return denominator ? numerator / denominator : null;
};

const weightBand = (delta) => {
  if (delta <= -3) return "-3kg以上減";
  if (delta < 0) return "-2〜-1kg減";
  if (delta === 0) return "増減なし";
  if (delta < 3) return "+1〜+2kg増";
  return "+3kg以上増";
};

const explicitCondition = (run) => {
  const code = String(run.weightRuleCode ?? "").trim();
  if (code === "1") return "ハンデ戦";
  if (code === "2") return "別定戦";
  if (code === "3") return "馬齢戦";
  if (code === "4") return "定量戦";
  const raw = [run.weightRule, run.weightType, run.raceCondition, run.raceName]
    .filter(Boolean)
    .join(" ")
    .normalize("NFKC");
  if (/ハンデ/.test(raw)) return "ハンデ戦";
  if (/別定/.test(raw)) return "別定戦";
  if (/馬齢/.test(raw)) return "馬齢戦";
  if (/定量/.test(raw)) return "定量戦";
  return "不明";
};

const raceLookupKey = ({ date, course, raceNumber }) => {
  const compactDate = String(date ?? "").replaceAll("-", "");
  const courseCode = COURSE_CODES[String(course ?? "").trim()] ?? "";
  const raceNo = Number(raceNumber);
  return compactDate && courseCode && Number.isFinite(raceNo)
    ? `${compactDate}-${courseCode}-${String(raceNo).padStart(2, "0")}`
    : null;
};

const buildWeightRuleLookup = (summary) => new Map((summary?.pastRaces ?? [])
  .map((race) => {
    const key = raceLookupKey({ date: race.raceDate, course: Object.entries(COURSE_CODES).find(([, code]) => code === race.courseCode)?.[0], raceNumber: race.raceNo });
    return key && race.weightRuleCode ? [key, { weightRuleCode: race.weightRuleCode, weightRule: WEIGHT_RULES[race.weightRuleCode] ?? null }] : null;
  })
  .filter(Boolean));

const backfillWeightRules = (snapshot, summary) => {
  const lookup = buildWeightRuleLookup(summary);
  const counters = { availableRaceRules: lookup.size, alreadyPresent: 0, backfilled: 0, unmatched: 0 };
  for (const race of snapshot.races ?? []) {
    for (const horse of race.horses ?? []) {
      for (const run of horse.pastRuns ?? []) {
        if (run.weightRuleCode || run.weightRule) {
          counters.alreadyPresent += 1;
          continue;
        }
        const rule = lookup.get(raceLookupKey(run));
        if (!rule) {
          counters.unmatched += 1;
          continue;
        }
        Object.assign(run, rule);
        counters.backfilled += 1;
      }
    }
  }
  return counters;
};

const validFinish = (run) => {
  const value = numberOrNull(run.confirmedFinishPosition ?? run.finishPosition);
  return value != null && value > 0 ? value : null;
};

const collectPairs = (snapshot) => {
  const counters = {
    horses: 0,
    pastRuns: 0,
    possiblePairs: 0,
    acceptedPairs: 0,
    skippedMissingWeight: 0,
    skippedMissingFinish: 0,
    skippedMissingMargin: 0,
    skippedInvalidDate: 0,
  };
  const pairs = [];
  for (const race of snapshot.races ?? []) {
    for (const horse of race.horses ?? []) {
      counters.horses += 1;
      const runs = [...(horse.pastRuns ?? [])];
      counters.pastRuns += runs.length;
      runs.sort((left, right) => String(left.date ?? "").localeCompare(String(right.date ?? "")));
      for (let index = 1; index < runs.length; index += 1) {
        counters.possiblePairs += 1;
        const previous = runs[index - 1];
        const current = runs[index];
        if (!previous.date || !current.date) {
          counters.skippedInvalidDate += 1;
          continue;
        }
        if (!finite(previous.carriedWeight) || !finite(current.carriedWeight)) {
          counters.skippedMissingWeight += 1;
          continue;
        }
        const previousFinish = validFinish(previous);
        const currentFinish = validFinish(current);
        if (previousFinish == null || currentFinish == null) {
          counters.skippedMissingFinish += 1;
          continue;
        }
        if (!finite(previous.margin) || !finite(current.margin)) {
          counters.skippedMissingMargin += 1;
          continue;
        }
        const weightDelta = Number(current.carriedWeight) - Number(previous.carriedWeight);
        pairs.push({
          horseName: horse.name ?? horse.horseName,
          previousDate: previous.date,
          currentDate: current.date,
          weightDelta,
          finish: currentFinish,
          finishDelta: currentFinish - previousFinish,
          margin: Number(current.margin),
          marginDelta: Number(current.margin) - Number(previous.margin),
          placed: currentFinish <= 3,
          band: weightBand(weightDelta),
          condition: explicitCondition(current),
        });
        counters.acceptedPairs += 1;
      }
    }
  }
  return { pairs, counters };
};

const summarize = (pairs) => ({
  n: pairs.length,
  places: pairs.filter((pair) => pair.placed).length,
  placeRate: pairs.length ? pairs.filter((pair) => pair.placed).length / pairs.length : null,
  averageFinish: mean(pairs.map((pair) => pair.finish)),
  averageMargin: mean(pairs.map((pair) => pair.margin)),
  averageFinishDelta: mean(pairs.map((pair) => pair.finishDelta)),
  averageMarginDelta: mean(pairs.map((pair) => pair.marginDelta)),
  spearman: spearman(pairs.map((pair) => [pair.weightDelta, pair.finishDelta])),
  slope: regressionSlope(pairs.map((pair) => [pair.weightDelta, pair.finishDelta])),
});

const summarizeBands = (pairs) => BAND_ORDER.map((band) => ({
  band,
  ...summarize(pairs.filter((pair) => pair.band === band)),
}));

const monotonicExpected = (rows) => {
  const available = rows.filter((row) => row.n > 0 && row.averageFinishDelta != null);
  return available.length >= 3 && available.every((row, index) => (
    index === 0 || row.averageFinishDelta >= available[index - 1].averageFinishDelta
  ));
};

const conditionDifference = (conditionSummaries) => {
  const handicap = conditionSummaries.get("ハンデ戦");
  const fixedPairs = ["別定戦", "馬齢戦", "定量戦"]
    .flatMap((condition) => conditionSummaries.get(condition)?.pairs ?? []);
  const fixed = summarize(fixedPairs);
  if (!handicap?.n || !fixed.n || handicap.spearman == null || fixed.spearman == null) return "判定不能（明示区分データ不足）";
  const opposite = Math.sign(handicap.spearman) !== 0
    && Math.sign(fixed.spearman) !== 0
    && Math.sign(handicap.spearman) !== Math.sign(fixed.spearman);
  return opposite
    ? `符号が逆（ハンデ ${format(handicap.spearman)} / 非ハンデ ${format(fixed.spearman)}）`
    : `符号は同じ（ハンデ ${format(handicap.spearman)} / 非ハンデ ${format(fixed.spearman)}）`;
};

const resultPosition = (result) => {
  const value = numberOrNull(result?.finishPosition);
  return value != null && value > 0 ? value : null;
};

const currentRaceExtremes = (snapshot, results) => (snapshot.races ?? []).map((race) => {
  const resultRace = (results.races ?? []).find((item) => item.bundleId === race.bundleId);
  const runners = (race.horses ?? []).filter((horse) => finite(horse.carriedWeight));
  if (!runners.length) return { race, light: [], heavy: [] };
  const minimum = Math.min(...runners.map((horse) => Number(horse.carriedWeight)));
  const maximum = Math.max(...runners.map((horse) => Number(horse.carriedWeight)));
  const enrich = (horse) => {
    const result = (resultRace?.horses ?? []).find((item) => (
      Number(item.horseNumber) === Number(horse.number ?? horse.horseNumber)
      && normalizeHorseName(item.horseName) === normalizeHorseName(horse.name ?? horse.horseName)
    ));
    return { name: horse.name ?? horse.horseName, weight: Number(horse.carriedWeight), finish: resultPosition(result) };
  };
  return {
    race,
    light: runners.filter((horse) => Number(horse.carriedWeight) === minimum).map(enrich),
    heavy: runners.filter((horse) => Number(horse.carriedWeight) === maximum).map(enrich),
  };
});

const renderRunnerList = (runners) => runners.length
  ? runners.map((runner) => `${runner.name} ${format(runner.weight, 1)}kg / ${runner.finish ?? "着順なし"}${runner.finish ? "着" : ""}`).join("、")
  : "未取得";

const buildReport = ({ snapshot, pairs, counters, results, backfill }) => {
  const overall = summarize(pairs);
  const bandRows = summarizeBands(pairs);
  const conditionSummaries = new Map(CONDITION_ORDER.slice(1).map((condition) => {
    const conditionPairs = pairs.filter((pair) => pair.condition === condition);
    return [condition, { ...summarize(conditionPairs), pairs: conditionPairs }];
  }));
  const conditionBandRows = CONDITION_ORDER.slice(1).flatMap((condition) => (
    summarizeBands(pairs.filter((pair) => pair.condition === condition)).map((row) => ({ condition, ...row }))
  ));
  const expectedDirection = overall.spearman > 0 && overall.slope > 0;
  const monotonic = monotonicExpected(bandRows);
  const explicitPairs = CONDITION_ORDER.slice(1, -1)
    .reduce((sum, condition) => sum + (conditionSummaries.get(condition)?.n ?? 0), 0);
  const promising = expectedDirection && monotonic && explicitPairs >= 30;
  const extremes = currentRaceExtremes(snapshot, results);

  const bandTable = bandRows.map((row) => (
    `| ${row.band} | ${row.n} | ${percent(row.places, row.n)} | ${format(row.averageFinish, 2)} | ${format(row.averageMargin, 2)} | ${signed(row.averageFinishDelta)} | ${signed(row.averageMarginDelta)} |`
  )).join("\n");
  const conditionSummaryTable = CONDITION_ORDER.slice(1).map((condition) => {
    const row = conditionSummaries.get(condition);
    return `| ${condition} | ${row.n} | ${format(row.spearman)} | ${signed(row.slope, 3)} | ${percent(row.places, row.n)} | ${format(row.averageFinish, 2)} | ${format(row.averageMargin, 2)} |`;
  }).join("\n");
  const conditionBandTable = conditionBandRows.map((row) => (
    `| ${row.condition} | ${row.band} | ${row.n} | ${percent(row.places, row.n)} | ${format(row.averageFinish, 2)} | ${format(row.averageMargin, 2)} | ${signed(row.averageFinishDelta)} | ${signed(row.averageMarginDelta)} |`
  )).join("\n");
  const extremeRows = extremes.map(({ race, light, heavy }) => (
    `| ${race.track}${race.number}R ${race.name} | ${renderRunnerList(light)} | ${renderRunnerList(heavy)} |`
  )).join("\n");

  return `# 斤量効果 What-if ${SNAPSHOT_DATE}

> **二重計上に関する重要事項**  過去走の「絶対」斤量はZIに織り込み済みの可能性があるため、本番の斤量補正では使用しません。将来使用を検討する対象は、今回斤量と前走比増減のみです。本what-ifでは効果測定のために過去走間の斤量増減を観測しますが、斤量の絶対値を本番ロジックへ投入するものではありません。

## 結論

- 斤量増減と着順変化に期待方向（軽くなるほど着順改善）の相関があるか: **${expectedDirection ? "YES" : "NO"}**
- 帯別の平均着順変化に単調傾向があるか: **${monotonic ? "YES" : "NO"}**
- ハンデ戦と定量・別定戦で傾向が異なるか: **${conditionDifference(conditionSummaries)}**
- 判定: **${promising ? "斤量評価は有望。ただし本番採用不可。複数週で再検証が必要。" : "現データでは本番補正を支持できる効果を検出できない。"}**

この判定は効果測定のみです。TM INDEX、各エンジン、重み、UI、week-data.jsonは変更していません。

## 対象データ

- 公開時スナップショット: \`data/archive/${SNAPSHOT_DATE}-preodds.json\`
- 確定結果: \`data/archive/${SNAPSHOT_DATE}-results.json\`
- レース: ${snapshot.races?.length ?? 0}
- 出走馬: ${counters.horses}
- 過去走: ${counters.pastRuns}
- 構築可能な連続走候補: ${counters.possiblePairs}
- 採用ペア: ${counters.acceptedPairs}
- 斤量欠損でスキップ: ${counters.skippedMissingWeight}
- 着順欠損でスキップ: ${counters.skippedMissingFinish}
- 着差欠損でスキップ: ${counters.skippedMissingMargin}
- 日付欠損でスキップ: ${counters.skippedInvalidDate}
- JV-Link RA重量種別を持つ過去レース: ${backfill.availableRaceRules}
- アーカイブへ非破壊バックフィルできた過去走: ${backfill.backfilled}
- 既に重量種別を保持していた過去走: ${backfill.alreadyPresent}
- RA重量種別と照合できなかった過去走: ${backfill.unmatched}

### 増減の定義

- 斤量増減 = 今走斤量 − 前走斤量
- 着順変化 = 今走着順 − 前走着順（マイナスが改善）
- 着差変化 = 今走着差 − 前走着差（マイナスが改善）
- 0.5kg刻みは値を丸めず、\`-3 < 差 < 0\` を減量中間帯、\`0 < 差 < 3\` を増量中間帯へ分類
- レース条件はJV-Link RAの公式重量種別コード（1:ハンデ / 2:別定 / 3:馬齢 / 4:定量）を優先。それ以外は推測せず「不明」

## 全体

- Spearman（斤量増減 vs 着順変化）: **${format(overall.spearman)}**
- 単回帰（斤量1kg増あたりの平均着順変化）: **${signed(overall.slope, 3)}着/kg**
- 複勝率: ${percent(overall.places, overall.n)}
- 平均着順: ${format(overall.averageFinish, 2)}
- 平均着差: ${format(overall.averageMargin, 2)}秒

## 斤量増減帯

| 帯 | n | 複勝率 | 平均着順 | 平均着差 | 平均着順変化 | 平均着差変化 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
${bandTable}

## レース条件別

| 条件 | n | Spearman | 回帰傾き（着/kg） | 複勝率 | 平均着順 | 平均着差 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
${conditionSummaryTable}

| 条件 | 帯 | n | 複勝率 | 平均着順 | 平均着差 | 平均着順変化 | 平均着差変化 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
${conditionBandTable}

## 今回9レースの絶対斤量（参考）

絶対斤量は本番補正へ使用しません。同一レース内の最軽量・最重量馬の実着順を参考表示するだけです。

| レース | 最軽量馬 | 最重量馬 |
| --- | --- | --- |
${extremeRows}

## 解釈上の制約

- JV-Link RAと照合できない過去走のみ「不明」です。照合は日付・競馬場・レース番号の一致を必須とします。
- 着順変化には相手関係、距離、馬場、展開、クラス変更が混在します。この単回帰は因果効果ではなく参考値です。
- 人気・オッズは一切使用していません。
- 効果が見えても、本番採用にはハンデ／定量分離と複数週での再現確認が必要です。
`;
};

const main = () => {
  if (!existsSync(SNAPSHOT_PATH)) throw new Error(`Snapshot not found: ${SNAPSHOT_PATH}`);
  if (!existsSync(RESULTS_PATH)) throw new Error(`Results not found: ${RESULTS_PATH}`);
  const snapshot = readJson(SNAPSHOT_PATH);
  const results = readJson(RESULTS_PATH);
  const summary = existsSync(JVLINK_SUMMARY_PATH) ? readJson(JVLINK_SUMMARY_PATH) : null;
  const backfill = backfillWeightRules(snapshot, summary);
  const { pairs, counters } = collectPairs(snapshot);
  if (!pairs.length) throw new Error("No valid consecutive-run pairs found");
  const report = buildReport({ snapshot, results, pairs, counters, backfill });
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, report, "utf8");
  console.log(`[analyze:weight] past runs: ${counters.pastRuns}`);
  console.log(`[analyze:weight] accepted pairs: ${counters.acceptedPairs}/${counters.possiblePairs}`);
  console.log(`[analyze:weight] skipped weight/finish/margin/date: ${counters.skippedMissingWeight}/${counters.skippedMissingFinish}/${counters.skippedMissingMargin}/${counters.skippedInvalidDate}`);
  console.log(`[analyze:weight] weight rules backfilled/unmatched: ${backfill.backfilled}/${backfill.unmatched}`);
  console.log(`[analyze:weight] report: ${OUTPUT_PATH}`);
};

try {
  main();
} catch (error) {
  console.error(`[analyze:weight] ${error.stack ?? error.message}`);
  process.exit(1);
}
