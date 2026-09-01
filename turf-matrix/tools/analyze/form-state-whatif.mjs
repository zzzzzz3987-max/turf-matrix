#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildFormStateShadow } from "../intelligence/form-state-shadow.mjs";
import { calculateTmIndex } from "../intelligence/tm-index-engine.mjs";

const ANALYZE_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(ANALYZE_DIR, "..", "..");
const ARCHIVE_DIR = join(ROOT, "data", "archive");
const OUTPUT = join(ROOT, "docs", "analysis", "form-state-whatif-2026-09-02.md");

const readJson = (path) => JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
const finite = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
const number = (value) => finite(value) ? Number(value) : null;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const normalizeName = (value) => String(value ?? "").normalize("NFKC").replace(/[\s\u3000]/g, "");
const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

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

const spearman = (rows, scoreKey) => {
  const pairs = rows.filter((row) => finite(row[scoreKey]) && finite(row.finish));
  return pearson(
    averageRanks(pairs.map((row) => Number(row[scoreKey]))),
    averageRanks(pairs.map((row) => Number(row.finish))),
  );
};

const archivePairs = () => readdirSync(ARCHIVE_DIR)
  .map((name) => name.match(/^(\d{4}-\d{2}-\d{2})-preodds\.json$/)?.[1])
  .filter(Boolean)
  .sort()
  .map((date) => ({
    date,
    snapshot: join(ARCHIVE_DIR, `${date}-preodds.json`),
    results: join(ARCHIVE_DIR, `${date}-results.json`),
  }))
  .filter((pair) => existsSync(pair.results));

const resultHorseFor = (horse, race) => {
  const horseNumber = Number(horse.number ?? horse.horseNumber);
  const horseName = normalizeName(horse.name ?? horse.horseName);
  const result = (race?.horses ?? []).find((item) => Number(item.horseNumber ?? item.number) === horseNumber);
  return result && normalizeName(result.horseName ?? result.name) === horseName ? result : null;
};

const detailScore = (horse, key) => number(horse.analysis?.factorsDetail?.[key]?.score);
const scoreSet = (horse, form) => ({
  ability: detailScore(horse, "ability"),
  form,
  distance: number(horse.analysis?.factors?.distance),
  course: detailScore(horse, "course") ?? number(horse.analysis?.factors?.course),
  training: detailScore(horse, "training") ?? number(horse.analysis?.factors?.training),
  blood: detailScore(horse, "blood"),
  pace: detailScore(horse, "pace") ?? number(horse.analysis?.factors?.pace),
});
const experienceFactor = (horse) => {
  const count = horse.pastRuns?.length ?? 0;
  return count <= 0 ? 0.3 : count === 1 ? 0.5 : count === 2 ? 0.7 : 1;
};
const leader = (rows, key) => [...rows].sort((left, right) => Number(right[key]) - Number(left[key]) || left.number - right.number)[0] ?? null;
const wins = (leaders) => leaders.filter((row) => row?.finish === 1).length;
const places = (leaders) => leaders.filter((row) => row?.finish <= 3).length;

const races = [];
let joinMisses = 0;
for (const pair of archivePairs()) {
  const snapshot = readJson(pair.snapshot);
  const results = readJson(pair.results);
  const byBundle = new Map((results.races ?? []).map((race) => [race.bundleId, race]));
  for (const race of snapshot.races ?? []) {
    const resultRace = byBundle.get(race.bundleId);
    if (!resultRace) continue;
    const rows = [];
    for (const horse of race.horses ?? []) {
      const result = resultHorseFor(horse, resultRace);
      const currentForm = detailScore(horse, "form");
      const currentTm = number(horse.tmIndex);
      if (!result || !finite(result.finishPosition ?? result.finish) || currentForm == null || currentTm == null) {
        joinMisses += 1;
        continue;
      }
      const shadow = buildFormStateShadow(horse, currentForm);
      const context = race.raceContext ?? { category: race.category, surface: race.surface };
      const currentRaw = calculateTmIndex(scoreSet(horse, currentForm), context);
      const shadowRaw = calculateTmIndex(scoreSet(horse, shadow.shadowScore), context);
      const tmDelta = finite(currentRaw) && finite(shadowRaw)
        ? Math.round((shadowRaw - currentRaw) * experienceFactor(horse))
        : 0;
      rows.push({
        date: pair.date,
        track: race.track,
        raceNumber: Number(race.number),
        raceName: race.name,
        number: Number(horse.number),
        name: horse.name,
        finish: Number(result.finishPosition ?? result.finish),
        currentForm,
        shadowForm: shadow.shadowScore,
        formAdjustment: shadow.adjustment,
        candidateForm: shadow.candidateScore,
        recentQuality: shadow.recentQuality,
        momentumScore: shadow.momentumScore,
        trendDelta: shadow.trendDelta,
        currentTm,
        shadowTm: clamp(currentTm + tmDelta, 45, 92),
        tmDelta,
      });
    }
    if (rows.length >= 2) races.push({ date: pair.date, track: race.track, raceNumber: race.number, raceName: race.name, rows });
  }
}

const rows = races.flatMap((race) => race.rows);
const currentFormLeaders = races.map((race) => leader(race.rows, "currentForm"));
const shadowFormLeaders = races.map((race) => leader(race.rows, "shadowForm"));
const currentTmLeaders = races.map((race) => leader(race.rows, "currentTm"));
const shadowTmLeaders = races.map((race) => leader(race.rows, "shadowTm"));
const formChanged = races.filter((race, index) => currentFormLeaders[index]?.name !== shadowFormLeaders[index]?.name);
const tmChanged = races.filter((race, index) => currentTmLeaders[index]?.name !== shadowTmLeaders[index]?.name);
const adjustedRows = rows.filter((row) => row.formAdjustment !== 0);
const maxAbsAdjustment = Math.max(0, ...rows.map((row) => Math.abs(row.formAdjustment)));
const correlation = (key) => spearman(rows, key);

const criteria = [
  ["評価100レース以上", races.length >= 100, `${races.length}レース`],
  ["Form着順相関を維持", (correlation("shadowForm") ?? 1) <= (correlation("currentForm") ?? 1), `${correlation("currentForm")?.toFixed(3)}→${correlation("shadowForm")?.toFixed(3)}`],
  ["TM INDEX着順相関を維持", (correlation("shadowTm") ?? 1) <= (correlation("currentTm") ?? 1), `${correlation("currentTm")?.toFixed(3)}→${correlation("shadowTm")?.toFixed(3)}`],
  ["Form首位勝数を維持", wins(shadowFormLeaders) >= wins(currentFormLeaders), `${wins(currentFormLeaders)}→${wins(shadowFormLeaders)}`],
  ["Form首位複勝数を維持", places(shadowFormLeaders) >= places(currentFormLeaders), `${places(currentFormLeaders)}→${places(shadowFormLeaders)}`],
  ["TM首位勝数を維持", wins(shadowTmLeaders) >= wins(currentTmLeaders), `${wins(currentTmLeaders)}→${wins(shadowTmLeaders)}`],
  ["TM首位複勝数を維持", places(shadowTmLeaders) >= places(currentTmLeaders), `${places(currentTmLeaders)}→${places(shadowTmLeaders)}`],
  ["最大Form補正3点以内", maxAbsAdjustment <= 3, `${maxAbsAdjustment}点`],
];
const retrospectivePass = criteria.every(([, pass]) => pass);
const dayRows = [...new Set(races.map((race) => race.date))].map((date) => {
  const indexes = races.map((race, index) => ({ race, index })).filter((item) => item.race.date === date).map((item) => item.index);
  const current = indexes.map((index) => currentTmLeaders[index]);
  const shadow = indexes.map((index) => shadowTmLeaders[index]);
  return `| ${date} | ${indexes.length} | ${indexes.filter((index) => currentTmLeaders[index]?.name !== shadowTmLeaders[index]?.name).length} | ${wins(current)}→${wins(shadow)} | ${places(current)}→${places(shadow)} |`;
}).join("\n");
const changedRows = tmChanged.map((race) => {
  const current = leader(race.rows, "currentTm");
  const shadow = leader(race.rows, "shadowTm");
  return `| ${race.date} | ${race.track}${race.raceNumber}R ${race.raceName} | ${current.name} (${current.finish}着・${current.currentTm}) | ${shadow.name} (${shadow.finish}着・${shadow.currentTm}) | ${shadow.formAdjustment > 0 ? "+" : ""}${shadow.formAdjustment} |`;
}).join("\n");

const report = `# Form State what-if (2026-09-02)

## 結論

**過去診断: ${retrospectivePass ? "PASS" : "FAIL"} / 本番接続: HOLD**

既存結果を使うのは診断だけとし、採用判定には使用しない。今回固定した算式を次回以降の公開前データで凍結し、独立影評価が採用ゲートを満たした場合だけFormへの接続を検討する。

## 現行監査

- 現行Formは着順42%、着差28%、生の上がり3F 15%、固定中立15%にクラス・今回距離補正を加える。
- 着順・着差・クラスはAbilityと重複し、生上がり3Fは距離・芝ダート・馬場差をまたいで比較される。
- 人気差はFormスコア本体ではなく説明材料にだけ使用されるが、Formの責務から外す。

## 候補設計

- 直近3走の着順百分位58%・着差42%から「直近内容」を作る。
- 過去4〜8走の中央値をその馬自身の基準とし、「状態推移」は監視Evidenceとして記録する。馬同士の得点比較には使わない。
- Ability、ZI、相手関係、人気、オッズ、Value、生上がり3F、今回距離・芝ダート・コース、斤量は不使用。
- 地方走は中立60へ60%縮小。1〜2走馬も中立へ縮小する。
- 現行Formを事前分布として残し、独立状態推定との差の35%だけを反映する。最大±3点で、TM INDEXの既存weightは変更しない。
- 通過順の進出度はEvidenceとして記録するが、展開全体が取れないため点数には使わない。

## 対象

- ${races.length}レース / ${rows.length}頭
- Form補正発火: ${adjustedRows.length}頭
- Form首位変更: ${formChanged.length}レース
- TM INDEX首位変更: ${tmChanged.length}レース
- 結果JOIN失敗: ${joinMisses}件

## 成績

| 指標 | 現行 | Form影 |
|---|---:|---:|
| Form着順相関 | ${correlation("currentForm")?.toFixed(3)} | ${correlation("shadowForm")?.toFixed(3)} |
| Form首位勝数 | ${wins(currentFormLeaders)} | ${wins(shadowFormLeaders)} |
| Form首位複勝数 | ${places(currentFormLeaders)} | ${places(shadowFormLeaders)} |
| TM INDEX着順相関 | ${correlation("currentTm")?.toFixed(3)} | ${correlation("shadowTm")?.toFixed(3)} |
| TM INDEX首位勝数 | ${wins(currentTmLeaders)} | ${wins(shadowTmLeaders)} |
| TM INDEX首位複勝数 | ${places(currentTmLeaders)} | ${places(shadowTmLeaders)} |
| 直近内容着順相関 | - | ${correlation("recentQuality")?.toFixed(3)} |
| 状態推移着順相関 | - | ${correlation("momentumScore")?.toFixed(3)} |

## 日別

| 日付 | レース | TM首位変更 | 勝数 | 複勝数 |
|---|---:|---:|---:|---:|
${dayRows}

## TM首位変更

| 日付 | レース | 現行首位 | 影首位 | Form補正 |
|---|---|---|---|---:|
${changedRows || "| - | - | - | - | 0 |"}

## 診断ゲート

| 条件 | 判定 | 実測 |
|---|---|---|
${criteria.map(([label, pass, actual]) => `| ${label} | ${pass ? "PASS" : "FAIL"} | ${actual} |`).join("\n")}

過去診断がPASSでも本番接続は行わない。次回公開前に同じ算式で予測を凍結し、結果取得後だけ評価する。
`;

mkdirSync(dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, report, "utf8");
console.log(JSON.stringify({
  output: OUTPUT,
  retrospectivePass,
  raceCount: races.length,
  horseCount: rows.length,
  adjustedHorseCount: adjustedRows.length,
  formLeaderChanges: formChanged.length,
  tmLeaderChanges: tmChanged.length,
  currentFormCorrelation: correlation("currentForm"),
  shadowFormCorrelation: correlation("shadowForm"),
  recentQualityCorrelation: correlation("recentQuality"),
  momentumCorrelation: correlation("momentumScore"),
  currentTmCorrelation: correlation("currentTm"),
  shadowTmCorrelation: correlation("shadowTm"),
  currentTmWins: wins(currentTmLeaders),
  shadowTmWins: wins(shadowTmLeaders),
  currentTmPlaces: places(currentTmLeaders),
  shadowTmPlaces: places(shadowTmLeaders),
  joinMisses,
}, null, 2));
