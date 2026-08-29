#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { indexRanking } from "../race-signal-selection.mjs";
import {
  INDEX_LEADER_COMPARATOR_CONFIG,
  INDEX_LEADER_FACTORS,
  applyIndexLeaderComparator,
  buildComparisonInput,
  buildStandardizer,
  trainIndexLeaderComparator,
} from "./lib/index-leader-comparator.mjs";
import { collectHistoricalComparisons, resolveArchivePairs } from "./lib/index-leader-history.mjs";

const ANALYZE_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(ANALYZE_DIR, "..", "..");
const ARCHIVE_DIR = join(ROOT, "data", "archive");
const SHADOW_DIR = join(ROOT, "data", "shadow", "index-leader");
const RUNTIME_DIR = join(ROOT, "tools", "pad-runtime");
const FULL_CANDIDATE = join(RUNTIME_DIR, "index-leader-shadow-candidate.json");
const SIGNALS_TEMP = join(RUNTIME_DIR, "index-leader-shadow-signals.json");
const RUNTIME_CONFIG = join(ROOT, "tools", "jvlink", "output", "all-races-data-config.json");

const readJson = (path) => JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const stableJson = (value) => `${JSON.stringify(value, null, 2)}\n`;
const round = (value, digits = 6) => value === null ? null : Number(value.toFixed(digits));
const factorLabels = {
  ability: "能力",
  form: "近走",
  training: "調教",
  course: "コース",
  pace: "展開",
  blood: "血統",
  stable: "厩舎",
  gap: "指数差",
};

const hashFiles = (paths) => {
  const hash = createHash("sha256");
  for (const path of [...paths].sort()) {
    hash.update(relative(ROOT, path).replaceAll("\\", "/"));
    hash.update("\0");
    hash.update(readFileSync(path));
    hash.update("\0");
  }
  return hash.digest("hex");
};

const runAllRaceGeneration = () => {
  mkdirSync(RUNTIME_DIR, { recursive: true });
  const result = spawnSync(process.execPath, ["tools/generate-all-race-signals.mjs"], {
    cwd: ROOT,
    env: {
      ...process.env,
      TURF_MATRIX_ALL_RACE_RUNTIME: RUNTIME_CONFIG,
      TURF_MATRIX_ALL_RACE_SIGNALS_OUT: SIGNALS_TEMP,
      TURF_MATRIX_ALL_RACE_CANDIDATE_OUT: FULL_CANDIDATE,
    },
    encoding: "utf8",
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) throw new Error(`All-race candidate generation failed with exit code ${result.status}`);
  return readJson(FULL_CANDIDATE);
};

const modelContributionRows = (row, model, standardizer) => [
  ...INDEX_LEADER_FACTORS.map((key, index) => ({
    key,
    value: ((row.featureDeltas[key] - standardizer[key].mean) / standardizer[key].sd) * model.weights[index],
  })),
  {
    key: "gap",
    value: ((row.gap - standardizer.gap.mean) / standardizer.gap.sd) * model.weights.at(-1),
  },
].sort((left, right) => Math.abs(right.value) - Math.abs(left.value));

const compactHorse = (horse) => ({
  number: horse.number,
  name: horse.name,
  tmIndex: horse.tmIndex,
});

if (!existsSync(RUNTIME_CONFIG)) throw new Error(`Full-card runtime config is missing: ${RUNTIME_CONFIG}`);

let candidate;
try {
  candidate = runAllRaceGeneration();
} finally {
  rmSync(SIGNALS_TEMP, { force: true });
}

const raceDate = candidate.meta?.date;
if (!/^\d{4}-\d{2}-\d{2}$/.test(raceDate ?? "")) throw new Error("Current race date is missing");
if ((candidate.races?.length ?? 0) < 30) throw new Error(`Full-card candidate is incomplete: ${candidate.races?.length ?? 0} races`);

const archivePairs = resolveArchivePairs(ARCHIVE_DIR).filter((pair) => pair.date < raceDate);
const history = collectHistoricalComparisons(archivePairs);
const trainingRows = history.rows.filter((row) =>
  row.complete
  && row.gap <= INDEX_LEADER_COMPARATOR_CONFIG.maxGapToReview
  && row.leader.finish !== row.second.finish);
const standardizer = buildStandardizer(trainingRows);
const model = trainIndexLeaderComparator(trainingRows, standardizer);

const currentRows = candidate.races.map((race) => {
  const ranked = indexRanking(race);
  const leader = ranked[0];
  const second = ranked[1];
  if (!leader || !second) return { race, leader, second, complete: false, gap: null, featureDeltas: {} };
  return { race, leader, second, ...buildComparisonInput(leader, second) };
});
const modeled = applyIndexLeaderComparator(currentRows, model, standardizer);

const predictions = modeled.map((row) => {
  const eligible = row.complete && row.gap <= INDEX_LEADER_COMPARATOR_CONFIG.maxGapToReview;
  const contributions = eligible ? modelContributionRows(row, model, standardizer) : [];
  return {
    raceId: row.race.id,
    bundleId: row.race.bundleId,
    track: row.race.track,
    raceNumber: row.race.number,
    raceName: row.race.name,
    scheduledTime: row.race.time ?? null,
    currentLeader: row.leader ? compactHorse(row.leader) : null,
    currentSecond: row.second ? compactHorse(row.second) : null,
    indexGap: Number.isFinite(row.gap) ? row.gap : null,
    eligible,
    eligibilityReason: !row.leader || !row.second
      ? "top_two_missing"
      : !row.complete
        ? "factor_missing"
        : row.gap > INDEX_LEADER_COMPARATOR_CONFIG.maxGapToReview
          ? "index_gap_protected"
          : "reviewed",
    secondAheadProbability: round(row.probability),
    shadowSwap: row.swap,
    shadowLeader: row.selected ? compactHorse(row.selected) : null,
    featureDeltas: Object.fromEntries(INDEX_LEADER_FACTORS.map((key) => [
      key,
      Number.isFinite(row.featureDeltas?.[key]) ? round(row.featureDeltas[key], 3) : null,
    ])),
    strongestSignals: contributions.slice(0, 3).map(({ key, value }) => ({
      factor: key,
      label: factorLabels[key],
      direction: value > 0 ? "second" : "leader",
      contribution: round(value),
    })),
  };
});

const archiveInputPaths = archivePairs.flatMap((pair) => [pair.snapshotPath, pair.resultsPath]);
const sourceCandidateText = stableJson(candidate);
const modelPayload = {
  version: INDEX_LEADER_COMPARATOR_CONFIG.modelVersion,
  config: INDEX_LEADER_COMPARATOR_CONFIG,
  factors: INDEX_LEADER_FACTORS,
  intercept: round(model.intercept, 12),
  coefficients: Object.fromEntries([
    ...INDEX_LEADER_FACTORS.map((key, index) => [key, round(model.weights[index], 12)]),
    ["gap", round(model.weights.at(-1), 12)],
  ]),
  standardizer,
};
const predictionPayload = {
  raceDate,
  model: modelPayload,
  predictions,
};

const artifact = {
  schemaVersion: 1,
  status: "frozen-pre-race-shadow",
  frozenAt: new Date().toISOString(),
  raceDate,
  productionConnected: false,
  policy: {
    purpose: "TM INDEX 1位と影比較器の事前固定比較",
    publicationRule: "公開順位は変更しない",
    resultLeakage: false,
    popularityOddsValueUsed: false,
  },
  training: {
    through: archivePairs.at(-1)?.date ?? null,
    archiveDates: archivePairs.map((pair) => pair.date),
    raceCount: history.rows.length,
    eligibleRaceCount: trainingRows.length,
    skippedRaceCount: history.skipped,
  },
  source: {
    currentRaceCount: candidate.races.length,
    currentRunnerCount: candidate.races.reduce((sum, race) => sum + (race.horses?.length ?? 0), 0),
    historySha256: hashFiles(archiveInputPaths),
    currentCandidateSha256: sha256(sourceCandidateText),
    modelSpecSha256: sha256(stableJson({ config: INDEX_LEADER_COMPARATOR_CONFIG, factors: INDEX_LEADER_FACTORS })),
  },
  model: modelPayload,
  summary: {
    raceCount: predictions.length,
    eligibleRaceCount: predictions.filter((prediction) => prediction.eligible).length,
    shadowSwapCount: predictions.filter((prediction) => prediction.shadowSwap).length,
    protectedGapCount: predictions.filter((prediction) => prediction.eligibilityReason === "index_gap_protected").length,
    incompleteCount: predictions.filter((prediction) => prediction.eligibilityReason === "factor_missing").length,
  },
  predictionSha256: sha256(stableJson(predictionPayload)),
  predictions,
};

const output = join(SHADOW_DIR, `${raceDate}-pre-race.json`);
const reportOutput = join(ROOT, "docs", "analysis", `index-leader-shadow-${raceDate}.md`);
mkdirSync(SHADOW_DIR, { recursive: true });
if (existsSync(output)) {
  const previous = readJson(output);
  if (previous.predictionSha256 !== artifact.predictionSha256) {
    throw new Error(`Frozen shadow already exists with different predictions: ${output}`);
  }
  console.log(`Frozen shadow already exists and matches: ${output}`);
} else {
  writeFileSync(output, stableJson(artifact));
}

const predictionRows = predictions.map((prediction) => {
  const probability = prediction.secondAheadProbability === null
    ? "—"
    : `${(prediction.secondAheadProbability * 100).toFixed(1)}%`;
  const recommendation = prediction.shadowSwap ? `2位 ${prediction.shadowLeader.name}` : `1位 ${prediction.shadowLeader?.name ?? "—"}`;
  return `| ${prediction.track}${prediction.raceNumber}R | ${prediction.raceName} | ${prediction.currentLeader?.name ?? "—"} | ${prediction.currentSecond?.name ?? "—"} | ${prediction.indexGap ?? "—"} | ${probability} | ${recommendation} |`;
}).join("\n");
const report = `# TM INDEX 首位・事前影比較 (${raceDate})

## 固定状態

- 公開順位への接続: **なし**
- 対象: ${artifact.summary.raceCount}レース / ${artifact.source.currentRunnerCount}頭
- 比較対象: 指数差${INDEX_LEADER_COMPARATOR_CONFIG.maxGapToReview}点以内 ${artifact.summary.eligibleRaceCount}レース
- 影で2位へ入替: ${artifact.summary.shadowSwapCount}レース
- 学習: ${artifact.training.through}までの${artifact.training.raceCount}レース（比較器対象${artifact.training.eligibleRaceCount}レース）
- 入力: ${INDEX_LEADER_FACTORS.join(" / ")}
- 人気・オッズ・Value: 使用していない
- 予測SHA256: \`${artifact.predictionSha256}\`

## 事前予測

| レース | レース名 | 現行1位 | 現行2位 | 指数差 | 2位先着確率 | 影首位 |
|---|---|---|---|---:|---:|---|
${predictionRows}

## レース後の採用確認

固定済みの予測だけで、現行1位と影首位の勝率・複勝率・1位2位間の先着選択率を比較する。最低5件の入替、入替率40%以下、3指標を悪化させず、勝数または複勝数が1件以上改善した場合のみ次の接続判断へ進む。結果を見て閾値や係数を変更しない。
`;
mkdirSync(dirname(reportOutput), { recursive: true });
writeFileSync(reportOutput, report);

rmSync(FULL_CANDIDATE, { force: true });
console.log(JSON.stringify({
  output,
  reportOutput,
  raceDate,
  trainingRaces: history.rows.length,
  eligibleTrainingRaces: trainingRows.length,
  races: predictions.length,
  eligibleRaces: artifact.summary.eligibleRaceCount,
  shadowSwaps: artifact.summary.shadowSwapCount,
  predictionSha256: artifact.predictionSha256,
}, null, 2));
