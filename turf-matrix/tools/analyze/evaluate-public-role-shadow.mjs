#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { summarizePublicRoleRecords } from "./lib/public-role-performance.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ARCHIVE_DIR = join(ROOT, "data", "archive");
const SHADOW_DIR = join(ROOT, "data", "shadow", "public-roles");
const OUTPUT_DATE = new Date().toISOString().slice(0, 10);
const OUTPUT = join(ROOT, "docs", "analysis", `public-role-shadow-evaluation-${OUTPUT_DATE}.md`);
const MIN_VALUE_SAMPLES = 20;
const MIN_CHANGED_SELECTIONS = 5;
const readJson = (path) => JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
const stableJson = (value) => `${JSON.stringify(value, null, 2)}\n`;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const normalizeName = (value) => String(value ?? "").normalize("NFKC").replace(/[\s\u3000]/g, "");

const resultFor = (selection, race) => {
  if (!selection || !race) return null;
  const result = (race.horses ?? []).find((horse) => Number(horse.horseNumber) === Number(selection.number));
  return result && normalizeName(result.horseName) === normalizeName(selection.name) ? result : null;
};

const recordFor = (selection, result, extra = {}) => {
  if (!selection || !finite(result?.finishPosition)) return null;
  const payoutAvailable = finite(result.winPayout) && finite(result.placePayout);
  return {
    ...extra,
    horseName: selection.name,
    finishPosition: result.finishPosition,
    payoutAvailable,
    winPayout: payoutAvailable ? result.winPayout : null,
    placePayout: payoutAvailable ? result.placePayout : null,
  };
};

const artifactPaths = existsSync(SHADOW_DIR)
  ? readdirSync(SHADOW_DIR)
      .filter((name) => /^\d{4}-\d{2}-\d{2}-pre-race\.json$/.test(name))
      .sort()
      .map((name) => join(SHADOW_DIR, name))
  : [];
const baselineRecords = [];
const evidenceRecords = [];
const dangerRecords = [];
const pendingDates = [];
let changedSelections = 0;

for (const artifactPath of artifactPaths) {
  const artifact = readJson(artifactPath);
  const expectedHash = sha256(stableJson({
    raceDate: artifact.raceDate,
    ruleVersion: "public-role-v2",
    valueCandidate: "index-rank-3-to-5-evidence-weighted",
    dangerRule: "top-four-popularity-with-index-gap-three",
    predictions: artifact.predictions,
  }));
  if (expectedHash !== artifact.predictionSha256) throw new Error(`Frozen prediction hash mismatch: ${artifactPath}`);
  const resultPath = join(ARCHIVE_DIR, `${artifact.raceDate}-results.json`);
  if (!existsSync(resultPath)) {
    pendingDates.push(artifact.raceDate);
    continue;
  }
  const resultsByRace = new Map((readJson(resultPath).races ?? []).map((race) => [race.bundleId, race]));
  for (const prediction of artifact.predictions ?? []) {
    const race = resultsByRace.get(prediction.bundleId);
    const baselineResult = resultFor(prediction.productionValue, race);
    const evidenceResult = resultFor(prediction.evidenceValue, race);
    if (baselineResult && evidenceResult) {
      const extra = { date: artifact.raceDate, raceId: prediction.bundleId };
      baselineRecords.push(recordFor(prediction.productionValue, baselineResult, extra));
      evidenceRecords.push(recordFor(prediction.evidenceValue, evidenceResult, extra));
      if (prediction.productionValue.number !== prediction.evidenceValue.number) changedSelections += 1;
    }
    const dangerResult = resultFor(prediction.productionDanger, race);
    const dangerRecord = recordFor(prediction.productionDanger, dangerResult, {
      date: artifact.raceDate,
      raceId: prediction.bundleId,
    });
    if (dangerRecord) dangerRecords.push(dangerRecord);
  }
}

const baseline = summarizePublicRoleRecords(baselineRecords);
const evidence = summarizePublicRoleRecords(evidenceRecords);
const danger = summarizePublicRoleRecords(dangerRecords);
const gate = {
  enoughSamples: evidence.sampleSize >= MIN_VALUE_SAMPLES,
  enoughChanges: changedSelections >= MIN_CHANGED_SELECTIONS,
  topThreeImproved: finite(evidence.topThreeRate) && finite(baseline.topThreeRate) && evidence.topThreeRate > baseline.topThreeRate,
  placeReturnMaintained: finite(evidence.placeReturnRate) && finite(baseline.placeReturnRate) && evidence.placeReturnRate >= baseline.placeReturnRate,
};
const accepted = Object.values(gate).every(Boolean);
const status = accepted ? "PASS（注目穴v2を接続候補へ）" : evidence.sampleSize >= MIN_VALUE_SAMPLES ? "FAIL（現行維持）" : "COLLECTING（事前予測を蓄積中）";
const pct = (value) => finite(value) ? `${value.toFixed(1)}%` : "—";
const gateRows = [
  ["同一レース比較20件以上", gate.enoughSamples, `${evidence.sampleSize}件`],
  ["選択変更5件以上", gate.enoughChanges, `${changedSelections}件`],
  ["3着内率を改善", gate.topThreeImproved, `${pct(baseline.topThreeRate)} → ${pct(evidence.topThreeRate)}`],
  ["複勝回収率を維持", gate.placeReturnMaintained, `${pct(baseline.placeReturnRate)} → ${pct(evidence.placeReturnRate)}`],
].map(([label, pass, value]) => `| ${label} | ${pass ? "PASS" : "WAIT/FAIL"} | ${value} |`).join("\n");
const report = `# 公開ロール・事前影評価 (${OUTPUT_DATE})

## 判定

**${status}**

- 注目穴v2は、指数3〜5位から能力・近走・調教・展開を中心に選ぶ
- 結果取得後にだけ集計し、固定済み予測は変更しない
- 結果待ち: ${pendingDates.length ? pendingDates.join("、") : "なし"}

## 注目穴

| 方式 | 対象 | 1着 | 3着内率 | 単勝回収率 | 複勝回収率 |
|---|---:|---:|---:|---:|---:|
| 現行 | ${baseline.sampleSize} | ${baseline.wins} | ${pct(baseline.topThreeRate)} | ${pct(baseline.winReturnRate)} | ${pct(baseline.placeReturnRate)} |
| Evidence v2 | ${evidence.sampleSize} | ${evidence.wins} | ${pct(evidence.topThreeRate)} | ${pct(evidence.winReturnRate)} | ${pct(evidence.placeReturnRate)} |

## 採用ゲート

| 基準 | 判定 | 実測 |
|---|---|---|
${gateRows}

## 危険な人気馬 v2

- 検証数: ${danger.sampleSize}
- 馬券外率: ${pct(danger.missedTopThreeRate)}
- 1着率: ${pct(danger.winRate)}
`;

mkdirSync(dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, report);
console.log(JSON.stringify({ output: OUTPUT, status, pendingDates, changedSelections, baseline, evidence, danger }, null, 2));
