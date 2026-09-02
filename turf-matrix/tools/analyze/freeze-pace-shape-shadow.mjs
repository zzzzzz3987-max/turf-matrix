#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRacePaceShapePrediction } from "./lib/pace-shape-shadow.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ARCHIVE_DIR = join(ROOT, "data", "archive");
const SHADOW_DIR = join(ROOT, "data", "shadow", "pace-shape-v2");
const HISTORY_PATH = join(ROOT, "data", "master", "race-shape-history.json");
const DEFAULT_INPUT = join(ROOT, "tools", "week-data.batch-candidate.json");
const MODEL_VERSION = "pace-race-shape-shadow-v2";
const args = process.argv.slice(2);
const valueAfter = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const flag = (name) => args.includes(name);
const inputPath = valueAfter("--input", DEFAULT_INPUT);
const dryRun = flag("--dry-run");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
const stableJson = (value) => `${JSON.stringify(value, null, 2)}\n`;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const hashFiles = (paths) => {
  const hash = createHash("sha256");
  for (const path of paths.sort()) {
    hash.update(relative(ROOT, path).replaceAll("\\", "/"));
    hash.update("\0");
    hash.update(readFileSync(path));
    hash.update("\0");
  }
  return hash.digest("hex");
};

if (!existsSync(inputPath)) throw new Error(`Pace shadow input is missing: ${inputPath}`);
if (!existsSync(HISTORY_PATH)) throw new Error(`Race shape history is missing: ${HISTORY_PATH}`);
const candidate = readJson(inputPath);
const history = readJson(HISTORY_PATH);
const raceDate = candidate.meta?.date ?? candidate.races?.[0]?.horses?.[0]?.currentRace?.raceDate;
if (!/^\d{4}-\d{2}-\d{2}$/.test(raceDate ?? "")) throw new Error("Pace shadow race date is missing");
if (existsSync(join(ARCHIVE_DIR, `${raceDate}-results.json`)) && !flag("--reconstruct")) {
  throw new Error(`Results already exist for ${raceDate}; pre-race Pace freeze refused`);
}
const latestHistoryDate = history.races.reduce((latest, race) => race.date > latest ? race.date : latest, "");
if (latestHistoryDate >= raceDate) {
  // The model still filters every joined run by runDate < targetDate. Recording
  // this condition makes the protection auditable when a cumulative master is used.
}

const predictions = (candidate.races ?? []).map((race) => buildRacePaceShapePrediction(race, history));
if (!predictions.length || predictions.some((race) => race.horseCount < 2)) throw new Error("Pace shadow candidate has an incomplete race");
const modelSpecSha256 = hashFiles([
  join(ROOT, "tools", "intelligence", "race-shape-history.mjs"),
  join(ROOT, "tools", "intelligence", "pace-shape-shadow.mjs"),
  join(ROOT, "tools", "analyze", "lib", "pace-shape-shadow.mjs"),
]);
const historySha256 = sha256(readFileSync(HISTORY_PATH));
const payload = { modelVersion: MODEL_VERSION, modelSpecSha256, historySha256, raceDate, predictions };
const predictionSha256 = sha256(stableJson(payload));
const artifact = {
  schemaVersion: 1,
  status: flag("--reconstruct") ? "reconstructed-pre-race-shadow" : "frozen-pre-race-shadow",
  modelVersion: MODEL_VERSION,
  frozenAt: new Date().toISOString(),
  raceDate,
  productionConnected: false,
  policy: {
    purpose: "過去走の公式ラップ・隊列結果による展開利不利の事前影評価",
    currentRaceResultRead: false,
    futureRaceShapeJoinAllowed: false,
    popularityOddsValueUsed: false,
    observedRaceLapUsed: history.policy?.actualRaceLapsAvailable === true,
    currentRacePaceScenarioChanged: false,
    maxPaceAdjustment: 2,
  },
  source: {
    input: relative(ROOT, inputPath).replaceAll("\\", "/"),
    inputSha256: sha256(readFileSync(inputPath)),
    history: relative(ROOT, HISTORY_PATH).replaceAll("\\", "/"),
    historySha256,
    historyRaceCount: history.summary.raceCount,
    modelSpecSha256,
  },
  summary: {
    raceCount: predictions.length,
    horseCount: predictions.reduce((sum, race) => sum + race.horseCount, 0),
    matchedHorseCount: predictions.reduce((sum, race) => sum + race.horses.filter((horse) => horse.matchedRunCount > 0).length, 0),
    adjustedHorseCount: predictions.reduce((sum, race) => sum + race.horses.filter((horse) => horse.paceAdjustment !== 0).length, 0),
    paceLeaderChangedRaceCount: predictions.filter((race) => race.paceLeaderChanged).length,
    tmLeaderChangedRaceCount: predictions.filter((race) => race.tmLeaderChanged).length,
    maxAbsAdjustment: Math.max(0, ...predictions.flatMap((race) => race.horses.map((horse) => Math.abs(horse.paceAdjustment)))),
  },
  predictionSha256,
  predictions,
};

mkdirSync(SHADOW_DIR, { recursive: true });
const output = join(SHADOW_DIR, `${raceDate}-pre-race.json`);
if (!dryRun && existsSync(output)) {
  const previous = readJson(output);
  if (previous.predictionSha256 !== predictionSha256) throw new Error(`Frozen Pace shadow differs: ${output}`);
} else if (!dryRun) writeFileSync(output, stableJson(artifact));

const reportPath = join(ROOT, "docs", "analysis", `pace-shape-shadow-${raceDate}.md`);
const rows = predictions.map((race) => `| ${race.track}${race.raceNumber}R | ${race.raceName} | ${race.currentPaceLeader?.name ?? "-"} | ${race.shadowPaceLeader?.name ?? "-"} | ${race.horses.filter((horse) => horse.paceAdjustment !== 0).length} |`).join("\n");
const report = `# Pace Race Shape 事前影評価 (${raceDate})

- 本番Pace・TM INDEXへの接続: **なし**
- 対象: ${artifact.summary.raceCount}レース / ${artifact.summary.horseCount}頭
- 過去形状照合: ${artifact.summary.matchedHorseCount}頭
- Pace補正発火: ${artifact.summary.adjustedHorseCount}頭
- Pace首位変更: ${artifact.summary.paceLeaderChangedRaceCount}レース
- TM首位変更: ${artifact.summary.tmLeaderChangedRaceCount}レース
- 最大Pace補正: ${artifact.summary.maxAbsAdjustment}点
- 公式ラップの前傾・後傾と、前残り・差し決着を分離して評価
- 予測SHA256: \`${predictionSha256}\`

| レース | レース名 | 現Pace首位 | 影Pace首位 | 補正頭数 |
|---|---|---|---|---:|
${rows}
`;
if (!dryRun) writeFileSync(reportPath, report, "utf8");
console.log(JSON.stringify({ output, reportPath, dryRun, raceDate, predictionSha256, ...artifact.summary }, null, 2));
