#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  calculateOpponentRaceLevel,
  combineRaceLevelRelation,
  normalizeDate,
} from "../intelligence/opponent-race-level.mjs";
import { calculateTmIndex } from "../intelligence/tm-index-engine.mjs";

const TOOLS_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const REPO_ROOT = join(TOOLS_DIR, "..");
const ARCHIVE_DIR = join(REPO_ROOT, "data", "archive");
const JV_OUTPUT_DIR = join(TOOLS_DIR, "jvlink", "output");
const STABLE_HISTORY_DIR = join(JV_OUTPUT_DIR, "stable-history");
const OUTPUT_DATE = "2026-08-28";
const OUTPUT_PATH = join(REPO_ROOT, "docs", "analysis", `opponent-race-level-whatif-${OUTPUT_DATE}.md`);

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const finite = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
const number = (value) => finite(value) ? Number(value) : null;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const percent = (hits, total) => total ? `${(hits / total * 100).toFixed(1)}%` : "—";
const signed = (value) => `${value > 0 ? "+" : ""}${value}`;
const normalizeName = (value) => String(value ?? "").normalize("NFKC").replace(/[\s\u3000]/g, "").replace(/^[*＊$＄]+/, "");

const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const averageRanks = (values) => {
  const sorted = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
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
const correlation = (records, selector) => {
  const pairs = records.map((record) => [selector(record), record.finishPosition]).filter(([score, finish]) => finite(score) && finite(finish));
  return { count: pairs.length, value: spearman(pairs) };
};
const formatCorrelation = (item) => item.value == null ? "—" : `${item.value.toFixed(3)} (n=${item.count})`;

const resolveArchivePairs = () => readdirSync(ARCHIVE_DIR)
  .map((fileName) => fileName.match(/^(\d{4}-\d{2}-\d{2})-preodds\.json$/)?.[1])
  .filter(Boolean)
  .sort()
  .map((date) => ({
    date,
    snapshotPath: join(ARCHIVE_DIR, `${date}-preodds.json`),
    resultsPath: join(ARCHIVE_DIR, `${date}-results.json`),
  }))
  .filter((pair) => existsSync(pair.resultsPath));

const loadHistory = () => {
  const deduped = new Map();
  for (const fileName of readdirSync(STABLE_HISTORY_DIR).filter((name) => name.endsWith(".json")).sort()) {
    const payload = readJson(join(STABLE_HISTORY_DIR, fileName));
    for (const run of payload.results ?? []) {
      const key = `${run.raceKey}|${run.bloodRegistrationNumber}`;
      deduped.set(key, run);
    }
  }
  return [...deduped.values()];
};

const buildUniverse = () => {
  const summaryPath = join(JV_OUTPUT_DIR, "intelligence-summary.json");
  if (!existsSync(summaryPath)) throw new Error(`JV-Link summary missing: ${summaryPath}`);
  const summary = readJson(summaryPath);
  const history = loadHistory();
  const raceByKey = new Map((summary.pastRaces ?? []).map((race) => [race.raceKey, race]));
  const fieldsByRace = new Map();
  const runsByHorse = new Map();
  for (const run of history) {
    if (!fieldsByRace.has(run.raceKey)) fieldsByRace.set(run.raceKey, []);
    fieldsByRace.get(run.raceKey).push(run);
    if (!runsByHorse.has(run.bloodRegistrationNumber)) runsByHorse.set(run.bloodRegistrationNumber, []);
    runsByHorse.get(run.bloodRegistrationNumber).push(run);
  }
  for (const runs of runsByHorse.values()) runs.sort((a, b) => normalizeDate(a.raceDate).localeCompare(normalizeDate(b.raceDate)));
  return { history, raceByKey, fieldsByRace, runsByHorse };
};

const resultHorseFor = (snapshotHorse, resultRace) => {
  const expectedNumber = Number(snapshotHorse.number ?? snapshotHorse.horseNumber);
  const expectedName = normalizeName(snapshotHorse.name ?? snapshotHorse.horseName);
  const result = (resultRace?.horses ?? []).find((horse) => Number(horse.horseNumber) === expectedNumber);
  return result && normalizeName(result.horseName) === expectedName ? result : null;
};

const componentScore = (horse, key) => number(
  horse.analysis?.factorsDetail?.ability?.components?.find((component) => component.key === key)?.score,
);

const abilityRelationInfluence = (horse) => {
  const source = horse.analysis?.factorsDetail?.ability?.inputs?.baseAbility?.source;
  const hasZi = source === "TARGET ZI";
  const runs = horse.pastRuns ?? [];
  const baseAbility = componentScore(horse, "baseAbility");
  const relation = componentScore(horse, "class");
  const margin = componentScore(horse, "margin");
  const closing = componentScore(horse, "lap");
  const weights = hasZi
    ? { base: 0.38, recent: 0.27, relation: 0.18, trend: 0.07, margin: 0.05, closing: 0.05 }
    : { recent: 0.46, relation: 0.27, trend: 0.12, margin: 0.08, closing: 0.07 };
  let total = 0;
  if (hasZi) total += weights.base;
  if (finite(baseAbility)) total += weights.recent;
  if (finite(relation)) total += weights.relation;
  if (runs.filter((run) => finite(run.finishPosition)).length >= 2) total += weights.trend;
  if (finite(margin)) total += weights.margin;
  if (finite(closing)) total += weights.closing;
  return total ? weights.relation / total : 0;
};

const experienceFactor = (horse) => {
  const runCount = horse.pastRuns?.length ?? 0;
  return runCount <= 0 ? 0.3 : runCount === 1 ? 0.5 : runCount === 2 ? 0.7 : 1;
};

const scoreSetFor = (horse, ability) => ({
  ability,
  form: number(horse.analysis?.factorsDetail?.form?.score),
  distance: number(horse.analysis?.factors?.distance),
  course: number(horse.analysis?.factorsDetail?.course?.score ?? horse.analysis?.factors?.course),
  training: number(horse.analysis?.factorsDetail?.training?.score ?? horse.analysis?.factors?.training),
  blood: number(horse.analysis?.factorsDetail?.blood?.score),
  pace: number(horse.analysis?.factorsDetail?.pace?.score ?? horse.analysis?.factors?.pace),
});

const addRunMetadata = (run, snapshotHorse, raceByKey) => {
  const date = normalizeDate(run.raceDate);
  const detail = (snapshotHorse.pastRuns ?? []).find((pastRun) => normalizeDate(pastRun.date) === date);
  const known = raceByKey.get(run.raceKey) ?? {};
  raceByKey.set(run.raceKey, {
    ...known,
    raceKey: run.raceKey,
    raceDate: known.raceDate ?? run.raceDate,
    raceName: known.raceName || detail?.raceName || null,
    fieldSize: known.fieldSize ?? detail?.fieldSize ?? null,
    grade: known.grade ?? detail?.grade ?? null,
  });
  return {
    ...run,
    margin: detail?.margin ?? null,
    fieldSize: known.fieldSize ?? detail?.fieldSize ?? null,
    raceName: known.raceName || detail?.raceName || null,
  };
};

const collect = (pairs, universe) => {
  const races = [];
  const records = [];
  let resultJoinMisses = 0;
  for (const pair of pairs) {
    const snapshot = readJson(pair.snapshotPath);
    const results = readJson(pair.resultsPath);
    for (const snapshotRace of snapshot.races ?? []) {
      const resultRace = (results.races ?? []).find((race) => race.bundleId === snapshotRace.bundleId);
      if (!resultRace) continue;
      const raceRecords = [];
      for (const horse of snapshotRace.horses ?? []) {
        const resultHorse = resultHorseFor(horse, resultRace);
        if (!resultHorse || !finite(resultHorse.finishPosition)) {
          resultJoinMisses += 1;
          continue;
        }
        const horseId = String(horse.currentRace?.horseId ?? horse.pedigree?.bloodRegistrationNumber ?? "");
        const oldAbility = number(horse.analysis?.factorsDetail?.ability?.score);
        const oldRelation = componentScore(horse, "class");
        const targetRuns = (universe.runsByHorse.get(horseId) ?? [])
          .filter((run) => normalizeDate(run.raceDate) < normalizeDate(pair.date))
          .map((run) => addRunMetadata(run, horse, universe.raceByKey));
        const level = horseId ? calculateOpponentRaceLevel({
          horseId,
          targetRuns,
          fieldsByRace: universe.fieldsByRace,
          runsByHorse: universe.runsByHorse,
          raceByKey: universe.raceByKey,
          evaluationDate: pair.date,
        }) : { status: "missing", score: null };
        const relationV2 = combineRaceLevelRelation(oldRelation, level.score);
        const influence = abilityRelationInfluence(horse);
        const abilityV2 = finite(oldAbility) && finite(oldRelation) && finite(relationV2)
          ? clamp(Math.round(oldAbility + (relationV2 - oldRelation) * influence), 35, 96)
          : oldAbility;
        const context = snapshotRace.raceContext ?? {
          category: snapshotRace.category,
          surface: snapshotRace.surface,
        };
        const rawOld = calculateTmIndex(scoreSetFor(horse, oldAbility), context);
        const rawV2 = calculateTmIndex(scoreSetFor(horse, abilityV2), context);
        const oldTm = number(horse.tmIndex);
        const indexDelta = finite(rawOld) && finite(rawV2)
          ? Math.round((rawV2 - rawOld) * experienceFactor(horse))
          : 0;
        const tmV2 = finite(oldTm) ? clamp(oldTm + indexDelta, 45, 92) : oldTm;
        const record = {
          date: pair.date,
          bundleId: snapshotRace.bundleId,
          raceName: snapshotRace.name,
          horseNumber: Number(horse.number),
          horseName: horse.name,
          finishPosition: Number(resultHorse.finishPosition),
          oldRelation,
          raceLevel: level.score,
          relationV2,
          oldAbility,
          abilityV2,
          oldTm,
          tmV2,
          levelStatus: level.status,
          encounterCount: level.encounterCount ?? 0,
          profiledPeerCount: level.profiledPeerCount ?? 0,
        };
        raceRecords.push(record);
        records.push(record);
      }
      if (raceRecords.length) races.push({
        date: pair.date,
        bundleId: snapshotRace.bundleId,
        raceName: snapshotRace.name,
        records: raceRecords,
      });
    }
  }
  return { races, records, resultJoinMisses };
};

const rankRaces = (races, scoreKey, rankKey) => races.map((race) => {
  const sorted = [...race.records].sort((left, right) => (
    (right[scoreKey] ?? -Infinity) - (left[scoreKey] ?? -Infinity) || left.horseNumber - right.horseNumber
  ));
  sorted.forEach((record, index) => { record[rankKey] = index + 1; });
  return race;
});

const rankStats = (races, rankKey) => [1, 2, 3].map((rank) => {
  const selected = races.map((race) => race.records.find((record) => record[rankKey] === rank)).filter(Boolean);
  return {
    rank,
    count: selected.length,
    wins: selected.filter((record) => record.finishPosition === 1).length,
    places: selected.filter((record) => record.finishPosition <= 3).length,
  };
});

const aggregateTop3 = (stats) => ({
  count: stats.reduce((sum, item) => sum + item.count, 0),
  wins: stats.reduce((sum, item) => sum + item.wins, 0),
  places: stats.reduce((sum, item) => sum + item.places, 0),
});

const pairs = resolveArchivePairs();
const universe = buildUniverse();
const collected = collect(pairs, universe);
rankRaces(collected.races, "oldTm", "oldRank");
rankRaces(collected.races, "tmV2", "v2Rank");

const covered = collected.records.filter((record) => finite(record.raceLevel) && finite(record.oldRelation));
const changed = collected.records.filter((record) => record.oldTm !== record.tmV2);
const rankChanged = collected.records.filter((record) => record.oldRank !== record.v2Rank);
const maxTmDelta = Math.max(0, ...collected.records.map((record) => Math.abs((record.tmV2 ?? 0) - (record.oldTm ?? 0))));
const currentRanks = rankStats(collected.races, "oldRank");
const v2Ranks = rankStats(collected.races, "v2Rank");
const currentTop3 = aggregateTop3(currentRanks);
const v2Top3 = aggregateTop3(v2Ranks);
const correlations = {
  oldRelation: correlation(covered, (record) => record.oldRelation),
  raceLevel: correlation(covered, (record) => record.raceLevel),
  relationV2: correlation(covered, (record) => record.relationV2),
  oldAbility: correlation(covered, (record) => record.oldAbility),
  abilityV2: correlation(covered, (record) => record.abilityV2),
  oldTm: correlation(covered, (record) => record.oldTm),
  tmV2: correlation(covered, (record) => record.tmV2),
};

const acceptance = [
  ["評価可能300頭以上", covered.length >= 300, `${covered.length}頭`],
  ["Race Levelと着順が期待方向（負相関）", correlations.raceLevel.value < 0, formatCorrelation(correlations.raceLevel)],
  ["統合後の相手関係相関が現行以上", correlations.relationV2.value <= correlations.oldRelation.value, `${formatCorrelation(correlations.oldRelation)} → ${formatCorrelation(correlations.relationV2)}`],
  ["指数1位の複勝率を維持", v2Ranks[0].places / v2Ranks[0].count >= currentRanks[0].places / currentRanks[0].count, `${percent(currentRanks[0].places, currentRanks[0].count)} → ${percent(v2Ranks[0].places, v2Ranks[0].count)}`],
  ["指数1位の勝率を維持", v2Ranks[0].wins / v2Ranks[0].count >= currentRanks[0].wins / currentRanks[0].count, `${percent(currentRanks[0].wins, currentRanks[0].count)} → ${percent(v2Ranks[0].wins, v2Ranks[0].count)}`],
  ["指数1〜3位の複勝率を維持", v2Top3.places / v2Top3.count >= currentTop3.places / currentTop3.count, `${percent(currentTop3.places, currentTop3.count)} → ${percent(v2Top3.places, v2Top3.count)}`],
  ["5%以上で指数が変化", changed.length / collected.records.length >= 0.05, `${changed.length}/${collected.records.length}`],
  ["指数変動は最大3pt以内", maxTmDelta <= 3, `${maxTmDelta}pt`],
];
const accepted = acceptance.every(([, pass]) => pass);

const rankRows = [0, 1, 2].map((index) => {
  const before = currentRanks[index];
  const after = v2Ranks[index];
  return `| ${index + 1}位 | ${percent(before.wins, before.count)} | ${percent(after.wins, after.count)} | ${percent(before.places, before.count)} | ${percent(after.places, after.count)} |`;
}).join("\n");
const acceptanceRows = acceptance.map(([label, pass, result]) => `| ${label} | ${pass ? "PASS" : "FAIL"} | ${result} |`).join("\n");
const changeRows = [...changed]
  .sort((left, right) => Math.abs(right.tmV2 - right.oldTm) - Math.abs(left.tmV2 - left.oldTm) || left.date.localeCompare(right.date))
  .slice(0, 30)
  .map((record) => `| ${record.date} | ${record.raceName} | ${record.horseName} | ${record.oldRelation ?? "—"} | ${record.raceLevel ?? "—"} | ${record.oldAbility} → ${record.abilityV2} | ${record.oldTm} → ${record.tmV2} (${signed(record.tmV2 - record.oldTm)}) | ${record.oldRank} → ${record.v2Rank} | ${record.finishPosition}着 |`)
  .join("\n");

const report = `# 相手関係 / Race Level what-if (${OUTPUT_DATE})

## 結論

**本番接続判定: ${accepted ? "PASS（接続候補）" : "FAIL（本番接続しない）"}**

公開時スナップショットと確定着順を使い、レース格、同走馬の評価日以前の後続成績、対象馬の着順・着差を統合したRace Levelを検証した。人気・オッズは一切使用していない。評価日当日以降の結果は除外している。

## 対象

- 公開時スナップショット / 結果ペア: ${pairs.length}日
- レース: ${collected.races.length}レース
- 出走行: ${collected.records.length}頭
- Race Level評価可能: ${covered.length}頭
- JV-Link履歴行（重複排除後）: ${universe.history.length}件
- 結果JOIN失敗: ${collected.resultJoinMisses}件
- 注記: 現段階でも限定された開催期間の標本であり、継続蓄積が必要。

## 事前固定した算式

1. レース格を基準値（G1 88 / G2 82 / G3 76 / Listed・OP 70 / 特別 60 / 一般 54）へ変換。
2. 同走馬の後続成績を、対象レース後かつ評価日前に限定して評価。
3. 少数の後続走は50点へ収縮し、同走馬カバレッジも50点へ収縮。
4. 対象馬の着順百分位と着差を最大±10点で加減。
5. 直近8戦を時系列加重してRace Levelを作る。
6. Race Level単独で旧相手関係を置換せず、現行相手関係70% + Race Level 30%の補助信号として統合。Ability全体の既存重みは変更しない。

## 相関（Spearman、スコア高→着順小が正しいため負が期待方向）

| 指標 | 着順相関 |
|---|---:|
| 旧 相手関係 | ${formatCorrelation(correlations.oldRelation)} |
| Race Level | ${formatCorrelation(correlations.raceLevel)} |
| 相手関係 v2（旧70% + Race Level 30%） | ${formatCorrelation(correlations.relationV2)} |
| Ability 現行 | ${formatCorrelation(correlations.oldAbility)} |
| Ability v2 | ${formatCorrelation(correlations.abilityV2)} |
| TM INDEX 現行 | ${formatCorrelation(correlations.oldTm)} |
| TM INDEX v2 | ${formatCorrelation(correlations.tmV2)} |

## 指数順位別成績

| 指数順位 | 現行 勝率 | v2 勝率 | 現行 複勝率 | v2 複勝率 |
|---:|---:|---:|---:|---:|
${rankRows}

- 指数1〜3位合算複勝率: ${percent(currentTop3.places, currentTop3.count)} → ${percent(v2Top3.places, v2Top3.count)}
- TM INDEX変化: ${changed.length}/${collected.records.length}頭
- 順位変化: ${rankChanged.length}/${collected.records.length}頭
- 最大TM INDEX変化: ${maxTmDelta}pt

## 採用基準

| 基準 | 判定 | 実測 |
|---|---|---|
${acceptanceRows}

## 主な差分

| 日付 | レース | 馬 | 旧相手 | Race Level | Ability | TM INDEX | 順位 | 着順 |
|---|---|---|---:|---:|---:|---:|---:|---:|
${changeRows || "| — | — | 変化なし | — | — | — | — | — | — |"}

## 判定ルール

8基準を全て満たした場合だけ本番Abilityへ接続する。一つでもFAILなら、評価器とレポートは残すが公開指数の算出経路は変更しない。着順を見た係数の再調整は行わない。
`;

mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
writeFileSync(OUTPUT_PATH, report);
console.log(JSON.stringify({
  output: OUTPUT_PATH,
  archivePairs: pairs.length,
  races: collected.races.length,
  records: collected.records.length,
  covered: covered.length,
  changed: changed.length,
  rankChanged: rankChanged.length,
  maxTmDelta,
  correlations: Object.fromEntries(Object.entries(correlations).map(([key, item]) => [key, item.value])),
  accepted,
  failedCriteria: acceptance.filter(([, pass]) => !pass).map(([label]) => label),
}, null, 2));
