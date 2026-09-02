#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { summarizePublicRoleRecords } from "./lib/public-role-performance.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ARCHIVE_DIR = join(ROOT, "data", "archive");
const SHADOW_DIR = join(ROOT, "data", "shadow", "public-role-pace-v3");
const TODAY = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const OUTPUT = join(ROOT, "docs", "analysis", `public-role-pace-shadow-evaluation-${TODAY}.md`);
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
    date,
    raceId,
    horseName: selection.name,
    finishPosition: result.finishPosition,
    payoutAvailable,
    winPayout: payoutAvailable ? result.winPayout : null,
    placePayout: payoutAvailable ? result.placePayout : null,
  };
};

const records = { productionValue: [], paceValue: [], productionDanger: [], paceDanger: [] };
let valueChanged = 0;
let dangerChanged = 0;
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
  if (expected !== artifact.predictionSha256) throw new Error(`Frozen public-role Pace hash mismatch: ${name}`);
  if (artifact.productionConnected !== false || artifact.policy.currentRaceResultRead !== false ||
    artifact.policy.futureRaceShapeJoinAllowed !== false || artifact.policy.historicalOfficialLapsUsed !== true ||
    artifact.policy.tmIndexChanged !== false) throw new Error(`Invalid public-role Pace policy: ${name}`);
  const resultPath = join(ARCHIVE_DIR, `${artifact.raceDate}-results.json`);
  if (!existsSync(resultPath)) {
    pendingDates.push(artifact.raceDate);
    continue;
  }
  const resultByRace = new Map((readJson(resultPath).races ?? []).map((race) => [race.bundleId, race]));
  for (const prediction of artifact.predictions ?? []) {
    const resultRace = resultByRace.get(prediction.bundleId);
    if (prediction.productionValue && prediction.paceValue) {
      const production = recordFor(prediction.productionValue, resultFor(prediction.productionValue, resultRace), artifact.raceDate, prediction.bundleId);
      const pace = recordFor(prediction.paceValue, resultFor(prediction.paceValue, resultRace), artifact.raceDate, prediction.bundleId);
      if (production && pace) {
        records.productionValue.push(production);
        records.paceValue.push(pace);
        if (prediction.productionValue.number !== prediction.paceValue.number) valueChanged += 1;
      }
    }
    if (prediction.productionDanger && prediction.paceDanger) {
      const production = recordFor(prediction.productionDanger, resultFor(prediction.productionDanger, resultRace), artifact.raceDate, prediction.bundleId);
      const pace = recordFor(prediction.paceDanger, resultFor(prediction.paceDanger, resultRace), artifact.raceDate, prediction.bundleId);
      if (production && pace) {
        records.productionDanger.push(production);
        records.paceDanger.push(pace);
        if (prediction.productionDanger.number !== prediction.paceDanger.number) dangerChanged += 1;
      }
    }
  }
}

const productionValue = summarizePublicRoleRecords(records.productionValue);
const paceValue = summarizePublicRoleRecords(records.paceValue);
const productionDanger = summarizePublicRoleRecords(records.productionDanger);
const paceDanger = summarizePublicRoleRecords(records.paceDanger);
const valueGate = {
  enoughSamples: paceValue.sampleSize >= 30,
  enoughChanges: valueChanged >= 5,
  topThreeImproved: finite(paceValue.topThreeRate) && paceValue.topThreeRate > productionValue.topThreeRate,
  placeReturnMaintained: finite(paceValue.placeReturnRate) && paceValue.placeReturnRate >= productionValue.placeReturnRate,
};
const dangerGate = {
  enoughSamples: paceDanger.sampleSize >= 30,
  enoughChanges: dangerChanged >= 5,
  missedTopThreeImproved: finite(paceDanger.missedTopThreeRate) && paceDanger.missedTopThreeRate > productionDanger.missedTopThreeRate,
  winRateMaintained: finite(paceDanger.winRate) && paceDanger.winRate <= productionDanger.winRate,
};
const valueAccepted = Object.values(valueGate).every(Boolean);
const dangerAccepted = Object.values(dangerGate).every(Boolean);
const report = `# 公開ロール Pace v3 影評価 (${TODAY})

- 注目穴: **${valueAccepted ? "接続候補" : "現行維持・蓄積中"}**
- 危険な人気馬: **${dangerAccepted ? "接続候補" : "現行維持・蓄積中"}**
- 本番TM INDEX・公開ロール: 未変更
- 結果待ち: ${pendingDates.length ? pendingDates.join("、") : "なし"}

| ロール | 方式 | 同一レース比較 | 1着率 | 3着内率 | 馬券外率 | 複勝回収率 |
|---|---|---:|---:|---:|---:|---:|
| 注目穴 | 現行 | ${productionValue.sampleSize} | ${pct(productionValue.winRate)} | ${pct(productionValue.topThreeRate)} | ${pct(productionValue.missedTopThreeRate)} | ${pct(productionValue.placeReturnRate)} |
| 注目穴 | Pace v3 | ${paceValue.sampleSize} | ${pct(paceValue.winRate)} | ${pct(paceValue.topThreeRate)} | ${pct(paceValue.missedTopThreeRate)} | ${pct(paceValue.placeReturnRate)} |
| 危険 | 現行 | ${productionDanger.sampleSize} | ${pct(productionDanger.winRate)} | ${pct(productionDanger.topThreeRate)} | ${pct(productionDanger.missedTopThreeRate)} | ${pct(productionDanger.placeReturnRate)} |
| 危険 | Pace v3 | ${paceDanger.sampleSize} | ${pct(paceDanger.winRate)} | ${pct(paceDanger.topThreeRate)} | ${pct(paceDanger.missedTopThreeRate)} | ${pct(paceDanger.placeReturnRate)} |

- 注目穴の選択変更: ${valueChanged}件
- 危険な人気馬の選択変更: ${dangerChanged}件
`;
mkdirSync(dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, report, "utf8");
console.log(JSON.stringify({ output: OUTPUT, pendingDates, valueChanged, dangerChanged, valueAccepted, dangerAccepted, productionValue, paceValue, productionDanger, paceDanger }, null, 2));
