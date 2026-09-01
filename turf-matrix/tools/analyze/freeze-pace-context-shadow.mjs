#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveTrackBias } from "../intelligence/track-bias-ai.mjs";
import { buildRacePaceContextPrediction } from "./lib/pace-context-shadow.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ARCHIVE_DIR = join(ROOT, "data", "archive");
const SHADOW_DIR = join(ROOT, "data", "shadow", "pace-context-v1");
const HISTORY_PATH = join(ROOT, "data", "master", "race-shape-history.json");
const BIAS_PATH = join(ROOT, "tools", "track-bias.current.json");
const DEFAULT_INPUT = join(ROOT, "tools", "week-data.batch-candidate.json");
const MODEL_VERSION = "pace-course-track-context-shadow-v1";
const args = process.argv.slice(2);
const valueAfter = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const flag = (name) => args.includes(name);
const inputPath = valueAfter("--input", DEFAULT_INPUT);
const bundleId = valueAfter("--bundle-id", null);
const dryRun = flag("--dry-run");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
const stableJson = (value) => `${JSON.stringify(value, null, 2)}\n`;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

if (!existsSync(inputPath)) throw new Error(`Pace context input is missing: ${inputPath}`);
if (!existsSync(HISTORY_PATH)) throw new Error(`Race shape history is missing: ${HISTORY_PATH}`);
const candidate = readJson(inputPath);
const history = readJson(HISTORY_PATH);
const biasSnapshot = existsSync(BIAS_PATH) ? readJson(BIAS_PATH) : null;
const raceDate = candidate.meta?.date ?? candidate.races?.[0]?.id?.slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(raceDate ?? "")) throw new Error("Pace context race date is missing");
if (existsSync(join(ARCHIVE_DIR, `${raceDate}-results.json`)) && !flag("--reconstruct")) {
  throw new Error(`Results already exist for ${raceDate}; pre-race Pace context freeze refused`);
}

const selectedRaces = bundleId ? (candidate.races ?? []).filter((race) => race.bundleId === bundleId) : (candidate.races ?? []);
if (bundleId && selectedRaces.length !== 1) throw new Error(`Pace context bundle was not found: ${bundleId}`);
const predictions = selectedRaces.map((race) => {
  const bias = biasSnapshot ? resolveTrackBias(biasSnapshot, {
    raceDate,
    course: race.track,
    surface: race.surface,
    raceNo: race.number,
  }) : null;
  return buildRacePaceContextPrediction(race, history, bias);
});
if (!predictions.length || predictions.some((race) => race.horseCount < 2)) throw new Error("Pace context candidate has an incomplete race");
const specPaths = [
  "tools/intelligence/course-geometry.mjs",
  "tools/intelligence/track-bias-ai.mjs",
  "tools/intelligence/pace-context-shadow.mjs",
  "tools/analyze/lib/pace-context-shadow.mjs",
].map((path) => join(ROOT, path));
const modelSpecSha256 = sha256(specPaths.map((path) => readFileSync(path)).join("\0"));
const payload = { modelVersion: MODEL_VERSION, modelSpecSha256, raceDate, bundleId, predictions };
const predictionSha256 = sha256(stableJson(payload));
const artifact = {
  schemaVersion: 1,
  status: flag("--reconstruct") ? "reconstructed-pre-race-shadow" : "frozen-pre-race-shadow",
  modelVersion: MODEL_VERSION,
  frozenAt: new Date().toISOString(),
  raceDate,
  bundleId,
  productionConnected: false,
  policy: {
    currentRaceResultRead: false,
    targetRaceBiasResultAllowed: false,
    sourceRaceNumberMustBeBelowTarget: true,
    currentHorsePopularityOddsValueUsed: false,
    observedLanePathUsed: false,
    frameZoneIsNotLanePath: true,
    maxPaceAdjustment: 2,
  },
  source: {
    input: relative(ROOT, inputPath).replaceAll("\\", "/"),
    inputSha256: sha256(readFileSync(inputPath)),
    history: relative(ROOT, HISTORY_PATH).replaceAll("\\", "/"),
    historySha256: sha256(readFileSync(HISTORY_PATH)),
    trackBias: existsSync(BIAS_PATH) ? relative(ROOT, BIAS_PATH).replaceAll("\\", "/") : null,
    trackBiasSha256: existsSync(BIAS_PATH) ? sha256(readFileSync(BIAS_PATH)) : null,
    modelSpecSha256,
  },
  summary: {
    raceCount: predictions.length,
    horseCount: predictions.reduce((sum, race) => sum + race.horseCount, 0),
    adjustedHorseCount: predictions.reduce((sum, race) => sum + race.horses.filter((horse) => horse.paceAdjustment !== 0).length, 0),
    liveBiasRaceCount: predictions.filter((race) => race.sourceBiasRaceCount > 0).length,
    exactCourseProfileRaceCount: predictions.filter((race) => race.courseShapeSource === "course-profile").length,
    genericCourseGeometryRaceCount: predictions.filter((race) => race.courseShapeSource && race.courseShapeSource !== "course-profile").length,
    missingCourseGeometryRaceCount: predictions.filter((race) => !race.courseShapeSource).length,
    paceLeaderChangedRaceCount: predictions.filter((race) => race.paceLeaderChanged).length,
    tmLeaderChangedRaceCount: predictions.filter((race) => race.tmLeaderChanged).length,
    maxAbsAdjustment: Math.max(0, ...predictions.flatMap((race) => race.horses.map((horse) => Math.abs(horse.paceAdjustment)))),
  },
  predictionSha256,
  predictions,
};

mkdirSync(SHADOW_DIR, { recursive: true });
const artifactName = bundleId ?? raceDate;
const output = join(SHADOW_DIR, `${artifactName}-pre-race.json`);
if (!dryRun && existsSync(output)) {
  const previous = readJson(output);
  if (previous.predictionSha256 !== predictionSha256) throw new Error(`Frozen Pace context differs: ${output}`);
} else if (!dryRun) writeFileSync(output, stableJson(artifact));

const reportPath = join(ROOT, "docs", "analysis", `pace-context-shadow-${artifactName}.md`);
const rows = predictions.map((race) => `| ${race.track}${race.raceNumber}R | ${race.currentPaceLeader?.name ?? "-"} | ${race.shadowPaceLeader?.name ?? "-"} | ${race.sourceBiasRaceCount} | ${race.horses.filter((horse) => horse.paceAdjustment !== 0).length} |`).join("\n");
const report = `# Pace × Course × Track Bias 事前影評価 (${raceDate})

- 本番Pace・TM INDEXへの接続: **なし**
- 対象: ${artifact.summary.raceCount}レース / ${artifact.summary.horseCount}頭
- 補正発火: ${artifact.summary.adjustedHorseCount}頭
- 同日以前バイアス利用: ${artifact.summary.liveBiasRaceCount}レース
- コース形態: 固有${artifact.summary.exactCourseProfileRaceCount}R / 汎用${artifact.summary.genericCourseGeometryRaceCount}R / 未取得${artifact.summary.missingCourseGeometryRaceCount}R
- Pace首位変更: ${artifact.summary.paceLeaderChangedRaceCount}レース
- 最大補正: ${artifact.summary.maxAbsAdjustment}点
- 枠ゾーンは評価するが、実走進路の内伸び・外伸びとは扱わない
- 予測SHA256: \`${predictionSha256}\`

| レース | 現Pace首位 | 影Pace首位 | 参照済みR | 補正頭数 |
|---|---|---|---:|---:|
${rows}
`;
if (!dryRun) writeFileSync(reportPath, report, "utf8");
console.log(JSON.stringify({ output, reportPath, dryRun, raceDate, predictionSha256, ...artifact.summary }, null, 2));
