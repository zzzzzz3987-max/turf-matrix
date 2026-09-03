#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { summarizePublicRoleRecords } from "./lib/public-role-performance.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ARCHIVE_DIR = join(ROOT, "data", "archive");
const SHADOW_DIR = join(ROOT, "data", "shadow", "public-role-evidence-v4");
const TODAY = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const OUTPUT = join(ROOT, "docs", "analysis", `public-role-evidence-shadow-evaluation-${TODAY}.md`);
const readJson = (path) => JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
const stableJson = (value) => `${JSON.stringify(value, null, 2)}\n`;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const normalizeName = (value) => String(value ?? "").normalize("NFKC").replace(/[\s\u3000]/g, "");
const pct = (value) => finite(value) ? `${value.toFixed(1)}%` : "-";

const resultFor = (selection, race) => {
  if (!selection || !race) return null;
  const result = (race.horses ?? []).find((horse) => Number(horse.horseNumber) === Number(selection.number));
  return result && normalizeName(result.horseName) === normalizeName(selection.name) ? result : null;
};
const recordFor = (selection, result, date, raceId) => {
  if (!selection || !finite(result?.finishPosition)) return null;
  const payoutAvailable = finite(result.winPayout) && finite(result.placePayout);
  return {
    date, raceId, horseName: selection.name, finishPosition: result.finishPosition, payoutAvailable,
    winPayout: payoutAvailable ? result.winPayout : null,
    placePayout: payoutAvailable ? result.placePayout : null,
  };
};

const records = { productionValue: [], paceValue: [], evidenceValue: [], productionDanger: [], paceDanger: [], evidenceDanger: [] };
const paired = { paceValue: [], evidenceValue: [], paceDanger: [], evidenceDanger: [] };
let valueChanged = 0;
let dangerChanged = 0;
let valueEligibleRaces = 0;
let dangerEligibleRaces = 0;
const pendingDates = [];
const artifacts = existsSync(SHADOW_DIR)
  ? readdirSync(SHADOW_DIR).filter((name) => /^\d{4}-\d{2}-\d{2}-pre-race\.json$/.test(name)).sort()
  : [];

for (const name of artifacts) {
  const artifact = readJson(join(SHADOW_DIR, name));
  const expected = sha256(stableJson({
    modelVersion: artifact.modelVersion,
    raceDate: artifact.raceDate,
    historySha256: artifact.source.historySha256,
    predictions: artifact.predictions,
  }));
  if (expected !== artifact.predictionSha256) throw new Error(`Frozen public-role Evidence hash mismatch: ${name}`);
  if (artifact.productionConnected !== false || artifact.policy.currentRaceResultRead !== false ||
    artifact.policy.futureRaceShapeJoinAllowed !== false || artifact.policy.marketUsedForEligibilityAndFinalTieBreakOnly !== true ||
    artifact.policy.evUsedForRanking !== false || artifact.policy.tmIndexChanged !== false) {
    throw new Error(`Invalid public-role Evidence policy: ${name}`);
  }
  const resultPath = join(ARCHIVE_DIR, `${artifact.raceDate}-results.json`);
  if (!existsSync(resultPath)) {
    pendingDates.push(artifact.raceDate);
    continue;
  }
  const resultByRace = new Map((readJson(resultPath).races ?? []).map((race) => [race.bundleId, race]));
  for (const prediction of artifact.predictions ?? []) {
    const resultRace = resultByRace.get(prediction.bundleId);
    for (const key of Object.keys(records)) {
      const row = recordFor(prediction[key], resultFor(prediction[key], resultRace), artifact.raceDate, prediction.bundleId);
      if (row) records[key].push(row);
    }
    if (prediction.paceValue) valueEligibleRaces += 1;
    if (prediction.paceDanger) dangerEligibleRaces += 1;
    if (prediction.paceValue && prediction.evidenceValue) {
      const paceRow = recordFor(prediction.paceValue, resultFor(prediction.paceValue, resultRace), artifact.raceDate, prediction.bundleId);
      const evidenceRow = recordFor(prediction.evidenceValue, resultFor(prediction.evidenceValue, resultRace), artifact.raceDate, prediction.bundleId);
      if (paceRow && evidenceRow) {
        paired.paceValue.push(paceRow);
        paired.evidenceValue.push(evidenceRow);
        if (prediction.paceValue.number !== prediction.evidenceValue.number) valueChanged += 1;
      }
    }
    if (prediction.paceDanger && prediction.evidenceDanger) {
      const paceRow = recordFor(prediction.paceDanger, resultFor(prediction.paceDanger, resultRace), artifact.raceDate, prediction.bundleId);
      const evidenceRow = recordFor(prediction.evidenceDanger, resultFor(prediction.evidenceDanger, resultRace), artifact.raceDate, prediction.bundleId);
      if (paceRow && evidenceRow) {
        paired.paceDanger.push(paceRow);
        paired.evidenceDanger.push(evidenceRow);
        if (prediction.paceDanger.number !== prediction.evidenceDanger.number) dangerChanged += 1;
      }
    }
  }
}

const stats = Object.fromEntries(Object.entries(records).map(([key, rows]) => [key, summarizePublicRoleRecords(rows)]));
const pairedStats = Object.fromEntries(Object.entries(paired).map(([key, rows]) => [key, summarizePublicRoleRecords(rows)]));
const valueCoverage = valueEligibleRaces ? stats.evidenceValue.sampleSize / valueEligibleRaces : 0;
const dangerCoverage = dangerEligibleRaces ? stats.evidenceDanger.sampleSize / dangerEligibleRaces : 0;
const valueGate = {
  enoughProspectiveSamples: stats.evidenceValue.sampleSize >= 30,
  enoughChangedSelections: valueChanged >= 5,
  usableCoverage: valueCoverage >= 0.3,
  topThreeImproved: finite(pairedStats.evidenceValue.topThreeRate) && pairedStats.evidenceValue.topThreeRate > pairedStats.paceValue.topThreeRate,
  placeReturnMaintained: finite(pairedStats.evidenceValue.placeReturnRate) && pairedStats.evidenceValue.placeReturnRate >= pairedStats.paceValue.placeReturnRate,
};
const dangerGate = {
  enoughProspectiveSamples: stats.evidenceDanger.sampleSize >= 30,
  enoughChangedSelections: dangerChanged >= 5,
  usableCoverage: dangerCoverage >= 0.3,
  missedTopThreeImproved: finite(pairedStats.evidenceDanger.missedTopThreeRate) && pairedStats.evidenceDanger.missedTopThreeRate > pairedStats.paceDanger.missedTopThreeRate,
  winRateMaintained: finite(pairedStats.evidenceDanger.winRate) && pairedStats.evidenceDanger.winRate <= pairedStats.paceDanger.winRate,
};
const valueAccepted = Object.values(valueGate).every(Boolean);
const dangerAccepted = Object.values(dangerGate).every(Boolean);
const report = `# 公開ロール Evidence v4 影評価 (${TODAY})

- 注目穴: **${valueAccepted ? "接続候補" : "現行維持・前向き蓄積中"}**
- 危険な人気馬: **${dangerAccepted ? "接続候補" : "現行維持・前向き蓄積中"}**
- 本番TM INDEX・公開ロール: 未変更
- 結果待ち: ${pendingDates.length ? pendingDates.join("、") : "なし"}

| ロール | 方式 | 選出数 | 1着率 | 3着内率 | 馬券外率 | 複勝回収率 |
|---|---|---:|---:|---:|---:|---:|
| 注目穴 | 現行 | ${stats.productionValue.sampleSize} | ${pct(stats.productionValue.winRate)} | ${pct(stats.productionValue.topThreeRate)} | ${pct(stats.productionValue.missedTopThreeRate)} | ${pct(stats.productionValue.placeReturnRate)} |
| 注目穴 | Pace v3 | ${stats.paceValue.sampleSize} | ${pct(stats.paceValue.winRate)} | ${pct(stats.paceValue.topThreeRate)} | ${pct(stats.paceValue.missedTopThreeRate)} | ${pct(stats.paceValue.placeReturnRate)} |
| 注目穴 | Evidence v4 | ${stats.evidenceValue.sampleSize} | ${pct(stats.evidenceValue.winRate)} | ${pct(stats.evidenceValue.topThreeRate)} | ${pct(stats.evidenceValue.missedTopThreeRate)} | ${pct(stats.evidenceValue.placeReturnRate)} |
| 危険 | 現行 | ${stats.productionDanger.sampleSize} | ${pct(stats.productionDanger.winRate)} | ${pct(stats.productionDanger.topThreeRate)} | ${pct(stats.productionDanger.missedTopThreeRate)} | ${pct(stats.productionDanger.placeReturnRate)} |
| 危険 | Pace v3 | ${stats.paceDanger.sampleSize} | ${pct(stats.paceDanger.winRate)} | ${pct(stats.paceDanger.topThreeRate)} | ${pct(stats.paceDanger.missedTopThreeRate)} | ${pct(stats.paceDanger.placeReturnRate)} |
| 危険 | Evidence v4 | ${stats.evidenceDanger.sampleSize} | ${pct(stats.evidenceDanger.winRate)} | ${pct(stats.evidenceDanger.topThreeRate)} | ${pct(stats.evidenceDanger.missedTopThreeRate)} | ${pct(stats.evidenceDanger.placeReturnRate)} |

- 注目穴の同一レース変更: ${valueChanged}件 / 選出率 ${pct(valueCoverage * 100)}
- 危険馬の同一レース変更: ${dangerChanged}件 / 選出率 ${pct(dangerCoverage * 100)}
- 採用ゲートはコード固定。結果確認後の閾値変更は禁止。
`;
mkdirSync(dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, report, "utf8");
console.log(JSON.stringify({ output: OUTPUT, pendingDates, valueChanged, dangerChanged, valueCoverage, dangerCoverage, valueAccepted, dangerAccepted, valueGate, dangerGate, stats, pairedStats }, null, 2));
