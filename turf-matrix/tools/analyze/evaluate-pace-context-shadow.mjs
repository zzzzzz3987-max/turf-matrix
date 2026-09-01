#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { aggregatePaceContextEvaluation, evaluateRacePaceContextPrediction } from "./lib/pace-context-shadow.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ARCHIVE_DIR = join(ROOT, "data", "archive");
const SHADOW_DIR = join(ROOT, "data", "shadow", "pace-context-v1");
const TODAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const OUTPUT = join(ROOT, "docs", "analysis", `pace-context-shadow-evaluation-${TODAY}.md`);
const readJson = (path) => JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const stableJson = (value) => `${JSON.stringify(value, null, 2)}\n`;
const pct = (value) => Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : "-";
const artifacts = existsSync(SHADOW_DIR)
  ? readdirSync(SHADOW_DIR)
      .filter((name) => /^\d{4}-\d{2}-\d{2}(?:-[a-z]+-\d{2}R)?-pre-race\.json$/.test(name))
      .sort()
      .map((name) => readJson(join(SHADOW_DIR, name)))
  : [];
const races = [];
const pendingDates = [];
const frozenPredictions = new Map();
for (const artifact of artifacts) {
  if (artifact.status !== "frozen-pre-race-shadow") continue;
  const expected = sha256(stableJson({
    modelVersion: artifact.modelVersion,
    modelSpecSha256: artifact.source.modelSpecSha256,
    raceDate: artifact.raceDate,
    bundleId: artifact.bundleId ?? null,
    predictions: artifact.predictions,
  }));
  if (expected !== artifact.predictionSha256) throw new Error(`Frozen Pace context hash mismatch: ${artifact.raceDate}`);
  if (artifact.productionConnected !== false
    || artifact.policy.currentRaceResultRead !== false
    || artifact.policy.targetRaceBiasResultAllowed !== false
    || artifact.policy.currentHorsePopularityOddsValueUsed !== false
    || artifact.policy.observedLanePathUsed !== false) {
    throw new Error(`Invalid Pace context pre-race policy: ${artifact.raceDate}`);
  }
  for (const prediction of artifact.predictions) {
    const key = `${artifact.raceDate}|${prediction.bundleId}`;
    const previous = frozenPredictions.get(key);
    if (!previous || new Date(artifact.frozenAt).getTime() >= new Date(previous.frozenAt).getTime()) {
      frozenPredictions.set(key, { prediction, raceDate: artifact.raceDate, frozenAt: artifact.frozenAt });
    }
  }
}
for (const { prediction, raceDate } of frozenPredictions.values()) {
  const resultPath = join(ARCHIVE_DIR, `${raceDate}-results.json`);
  if (!existsSync(resultPath)) { pendingDates.push(raceDate); continue; }
  const results = readJson(resultPath);
  const resultRace = (results.races ?? []).find((race) => race.bundleId === prediction.bundleId);
  const evaluated = evaluateRacePaceContextPrediction(prediction, resultRace);
  if (evaluated) races.push({ ...evaluated, date: raceDate });
}
const aggregate = aggregatePaceContextEvaluation(races);
const criteria = [
  ["評価30レース以上", aggregate.raceCount >= 30, `${aggregate.raceCount}レース`],
  ["補正発火10レース以上", aggregate.adjustedRaceCount >= 10, `${aggregate.adjustedRaceCount}レース`],
  ["同日バイアス利用30レース以上", aggregate.liveBiasRaceCount >= 30, `${aggregate.liveBiasRaceCount}レース`],
  ["Pace首位変更5レース以上", aggregate.paceLeaderChangedRaceCount >= 5, `${aggregate.paceLeaderChangedRaceCount}レース`],
  ["Pace pairwiseを維持", (aggregate.shadowPacePairwiseRate ?? 0) >= (aggregate.currentPacePairwiseRate ?? 0), `${pct(aggregate.currentPacePairwiseRate)}→${pct(aggregate.shadowPacePairwiseRate)}`],
  ["Pace首位勝数を維持", aggregate.shadowPaceWins >= aggregate.currentPaceWins, `${aggregate.currentPaceWins}→${aggregate.shadowPaceWins}`],
  ["Pace首位複勝数を維持", aggregate.shadowPacePlaces >= aggregate.currentPacePlaces, `${aggregate.currentPacePlaces}→${aggregate.shadowPacePlaces}`],
  ["勝数または複勝数を改善", aggregate.shadowPaceWins > aggregate.currentPaceWins || aggregate.shadowPacePlaces > aggregate.currentPacePlaces, `勝${aggregate.shadowPaceWins - aggregate.currentPaceWins >= 0 ? "+" : ""}${aggregate.shadowPaceWins - aggregate.currentPaceWins} / 複${aggregate.shadowPacePlaces - aggregate.currentPacePlaces >= 0 ? "+" : ""}${aggregate.shadowPacePlaces - aggregate.currentPacePlaces}`],
  ["最大補正2点以内", aggregate.maxAbsAdjustment <= 2, `${aggregate.maxAbsAdjustment}点`],
];
const accepted = criteria.every(([, pass]) => pass);
const status = accepted ? "PASS（Pace接続候補）" : aggregate.raceCount >= 30 ? "FAIL（現行維持）" : "COLLECTING（標本蓄積中）";
const report = `# Pace × Course × Track Bias 影評価 (${TODAY})

## 判定

**${status}**

- 評価済み: ${aggregate.raceCount}レース / ${aggregate.horseCount}頭
- 補正発火: ${aggregate.adjustedRaceCount}レース / ${aggregate.adjustedHorseCount}頭
- コース形態: 固有${aggregate.exactCourseProfileRaceCount}レース / 汎用${aggregate.genericCourseGeometryRaceCount}レース / 未取得${aggregate.missingCourseGeometryRaceCount}レース
- 同日バイアス利用: ${aggregate.liveBiasRaceCount}レース
- Pace首位変更: ${aggregate.paceLeaderChangedRaceCount}レース
- 結果待ち: ${pendingDates.length ? [...new Set(pendingDates)].sort().join("、") : "なし"}
- 本番Pace・TM INDEX: 未接続

| 指標 | 現行 | 統合影評価 |
|---|---:|---:|
| Pace首位勝数 | ${aggregate.currentPaceWins} | ${aggregate.shadowPaceWins} |
| Pace首位複勝数 | ${aggregate.currentPacePlaces} | ${aggregate.shadowPacePlaces} |
| Pace pairwise | ${pct(aggregate.currentPacePairwiseRate)} | ${pct(aggregate.shadowPacePairwiseRate)} |
| TM首位勝数 | ${aggregate.currentTmWins} | ${aggregate.shadowTmWins} |
| TM首位複勝数 | ${aggregate.currentTmPlaces} | ${aggregate.shadowTmPlaces} |

## 採用ゲート

| 条件 | 判定 | 実測 |
|---|---|---|
${criteria.map(([label, pass, actual]) => `| ${label} | ${pass ? "PASS" : "WAIT/FAIL"} | ${actual} |`).join("\n")}
`;
mkdirSync(dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, report, "utf8");
console.log(JSON.stringify({ output: OUTPUT, status, pendingDates, ...aggregate }, null, 2));
