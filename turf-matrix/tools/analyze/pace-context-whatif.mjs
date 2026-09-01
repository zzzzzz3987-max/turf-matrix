#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveTrackBias } from "../intelligence/track-bias-ai.mjs";
import {
  aggregatePaceContextEvaluation,
  buildRacePaceContextPrediction,
  evaluateRacePaceContextPrediction,
} from "./lib/pace-context-shadow.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ARCHIVE_DIR = join(ROOT, "data", "archive");
const HISTORY_PATH = join(ROOT, "data", "master", "race-shape-history.json");
const OUTPUT = join(ROOT, "docs", "analysis", "pace-context-whatif-2026-09-02.md");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
const pct = (value) => Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : "-";
const normalizeSurface = (value) => String(value ?? "").startsWith("ダ") ? "ダート" : String(value ?? "");

const buildSameDayBiasSnapshot = (date) => {
  const resultsPath = join(ARCHIVE_DIR, `${date}-all-race-results.json`);
  const signalsPath = join(ARCHIVE_DIR, `${date}-all-race-signals-pre-race.json`);
  if (!existsSync(resultsPath) || !existsSync(signalsPath)) return null;
  const results = readJson(resultsPath);
  const signals = readJson(signalsPath);
  const meta = new Map((signals.races ?? []).map((race) => [`${race.track}-${Number(race.number)}`, race]));
  const races = [];
  for (const resultRace of results.Races ?? []) {
    const race = resultRace.Race ?? {};
    const track = race.CourseName;
    const raceNo = Number(race.RaceNo);
    const signal = meta.get(`${track}-${raceNo}`);
    const surface = normalizeSurface(signal?.surface);
    if (!signal || !["芝", "ダート"].includes(surface)) continue;
    const horses = (resultRace.Horses ?? []).map((horse) => ({
      horseNumber: horse.HorseNumber,
      horseName: horse.HorseName,
      finish: horse.FinishPosition,
      popularity: horse.FinalPopularity,
      corner4: horse.Corner4,
    }));
    races.push({ date, track, surface, raceNo, fieldSize: signal.fieldSize, horses });
  }
  return {
    schemaVersion: 2,
    targetDate: date,
    sourceDate: date,
    scoringMode: "shadow",
    source: "archived JV-Link all-race results",
    method: "same-day earlier-race retrospective cutoff",
    races,
  };
};

const history = readJson(HISTORY_PATH);
const dates = readdirSync(ARCHIVE_DIR)
  .map((name) => name.match(/^(\d{4}-\d{2}-\d{2})-preodds\.json$/)?.[1])
  .filter(Boolean)
  .filter((date) => existsSync(join(ARCHIVE_DIR, `${date}-results.json`)))
  .sort();
const evaluated = [];
for (const date of dates) {
  const snapshot = readJson(join(ARCHIVE_DIR, `${date}-preodds.json`));
  const results = readJson(join(ARCHIVE_DIR, `${date}-results.json`));
  const byBundle = new Map((results.races ?? []).map((race) => [race.bundleId, race]));
  const biasSnapshot = buildSameDayBiasSnapshot(date);
  for (const race of snapshot.races ?? []) {
    const raceForBias = {
      raceDate: date,
      course: race.track,
      surface: race.surface,
      raceNo: race.number,
    };
    const trackBias = biasSnapshot ? resolveTrackBias(biasSnapshot, raceForBias) : null;
    const prediction = buildRacePaceContextPrediction(race, history, trackBias);
    const evaluation = evaluateRacePaceContextPrediction(prediction, byBundle.get(race.bundleId));
    if (evaluation) evaluated.push({ ...evaluation, date });
  }
}

const aggregate = aggregatePaceContextEvaluation(evaluated);
const criteria = [
  ["評価100レース以上", aggregate.raceCount >= 100, `${aggregate.raceCount}レース`],
  ["補正発火30レース以上", aggregate.adjustedRaceCount >= 30, `${aggregate.adjustedRaceCount}レース`],
  ["Pace首位変更5レース以上", aggregate.paceLeaderChangedRaceCount >= 5, `${aggregate.paceLeaderChangedRaceCount}レース`],
  ["Pace pairwiseを維持", (aggregate.shadowPacePairwiseRate ?? 0) >= (aggregate.currentPacePairwiseRate ?? 0), `${pct(aggregate.currentPacePairwiseRate)}→${pct(aggregate.shadowPacePairwiseRate)}`],
  ["Pace首位勝数を維持", aggregate.shadowPaceWins >= aggregate.currentPaceWins, `${aggregate.currentPaceWins}→${aggregate.shadowPaceWins}`],
  ["Pace首位複勝数を維持", aggregate.shadowPacePlaces >= aggregate.currentPacePlaces, `${aggregate.currentPacePlaces}→${aggregate.shadowPacePlaces}`],
  ["勝数または複勝数を改善", aggregate.shadowPaceWins > aggregate.currentPaceWins || aggregate.shadowPacePlaces > aggregate.currentPacePlaces, `勝${aggregate.shadowPaceWins - aggregate.currentPaceWins >= 0 ? "+" : ""}${aggregate.shadowPaceWins - aggregate.currentPaceWins} / 複${aggregate.shadowPacePlaces - aggregate.currentPacePlaces >= 0 ? "+" : ""}${aggregate.shadowPacePlaces - aggregate.currentPacePlaces}`],
  ["最大Pace補正2点以内", aggregate.maxAbsAdjustment <= 2, `${aggregate.maxAbsAdjustment}点`],
];
const statisticalPass = criteria.every(([, pass]) => pass);
const liveBiasReady = aggregate.liveBiasRaceCount >= 30;
const productionPass = statisticalPass && liveBiasReady;
const changedRows = evaluated.filter((race) => race.paceLeaderChanged).map((race) =>
  `| ${race.date} | ${race.track}${race.raceNumber}R ${race.raceName} | ${race.currentPaceLeader.name} (${race.currentPaceLeader.finish}着) | ${race.shadowPaceLeader.name} (${race.shadowPaceLeader.finish}着・${race.shadowPaceLeader.paceAdjustment >= 0 ? "+" : ""}${race.shadowPaceLeader.paceAdjustment}) |`
).join("\n");

const report = `# Pace × Course × Track Bias what-if (2026-09-02)

## 結論

**統合実装: 完了 / 数値診断: ${statisticalPass ? "PASS" : "FAIL"} / 本番接続: ${productionPass ? "候補" : "HOLD"}**

今回レースの想定ペース、近走脚質、コース形態、枠ゾーン、同日それ以前の確定結果による脚質・枠傾向、過去走の前残り・前崩れ耐性を一つの影評価へ統合した。PaceとTM INDEXの本番値は変更していない。

## 重要な区別

- JV-Link確定成績に直線の実走進路はない。馬番から分かるのは内外の枠ゾーンであり、内伸び・外伸びとは呼ばない。
- 同日バイアスは対象レースより前のレース番号だけを使用する。
- 現在馬の人気・オッズ・Valueは不使用。過去確定レースの人気は、人気馬が前に多かっただけの偏りを弱める目的に限って使用する。
- 補正は過去shapeと今回contextの合算で最大±2点。

## 実測

| 指標 | 現行 | 統合影評価 |
|---|---:|---:|
| 対象 | ${aggregate.raceCount}レース / ${aggregate.horseCount}頭 | 同左 |
| 補正発火 | - | ${aggregate.adjustedRaceCount}レース / ${aggregate.adjustedHorseCount}頭 |
| 今回context補正 | - | ${aggregate.contextAdjustedHorseCount}頭 |
| コース固有profile | - | ${aggregate.exactCourseProfileRaceCount}レース |
| 汎用コース形態fallback | - | ${aggregate.genericCourseGeometryRaceCount}レース |
| コース形態未取得 | - | ${aggregate.missingCourseGeometryRaceCount}レース |
| 同日バイアスを利用できた対象 | - | ${aggregate.liveBiasRaceCount}レース |
| Pace pairwise | ${pct(aggregate.currentPacePairwiseRate)} | ${pct(aggregate.shadowPacePairwiseRate)} |
| Pace首位勝数 | ${aggregate.currentPaceWins} | ${aggregate.shadowPaceWins} |
| Pace首位複勝数 | ${aggregate.currentPacePlaces} | ${aggregate.shadowPacePlaces} |
| TM首位勝数 | ${aggregate.currentTmWins} | ${aggregate.shadowTmWins} |
| TM首位複勝数 | ${aggregate.currentTmPlaces} | ${aggregate.shadowTmPlaces} |
| Pace首位変更 | - | ${aggregate.paceLeaderChangedRaceCount}レース |
| TM首位変更 | - | ${aggregate.tmLeaderChangedRaceCount}レース |
| 最大補正 | - | ${aggregate.maxAbsAdjustment}点 |

## 診断ゲート

| 条件 | 判定 | 実測 |
|---|---|---|
${criteria.map(([label, pass, actual]) => `| ${label} | ${pass ? "PASS" : "FAIL"} | ${actual} |`).join("\n")}
| 同日バイアス30レース以上 | ${liveBiasReady ? "PASS" : "FAIL"} | ${aggregate.liveBiasRaceCount}レース |

## Pace首位変更

| 日付 | レース | 現行首位 | 影首位 |
|---|---|---|---|
${changedRows || "| - | - | - | - |"}

係数と閾値は結果を見て変更しない。同日バイアスの事前凍結サンプルが30レースに達し、全ゲートを同時に満たすまで本番接続しない。
`;
mkdirSync(dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, report, "utf8");
console.log(JSON.stringify({ output: OUTPUT, statisticalPass, liveBiasReady, productionPass, ...aggregate }, null, 2));
