#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ANALYZE_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(ANALYZE_DIR, "..", "..");
const ARCHIVE_DIR = join(ROOT, "data", "archive");
const SHADOW_DIR = join(ROOT, "data", "shadow", "index-leader");
const OUTPUT_DATE = new Date().toISOString().slice(0, 10);
const OUTPUT = join(ROOT, "docs", "analysis", `index-leader-shadow-evaluation-${OUTPUT_DATE}.md`);
const MIN_EVALUATED_RACES = 30;
const MIN_SWAPS = 5;
const MAX_SWAP_RATE = 0.4;

const readJson = (path) => JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
const stableJson = (value) => `${JSON.stringify(value, null, 2)}\n`;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const pct = (hits, count) => count ? `${(hits / count * 100).toFixed(1)}%` : "—";
const normalizeName = (value) => String(value ?? "").normalize("NFKC").replace(/[\s\u3000]/g, "");

const resultFor = (horse, race) => {
  if (!horse || !race) return null;
  const result = (race.horses ?? []).find((item) => Number(item.horseNumber) === Number(horse.number));
  return result && normalizeName(result.horseName) === normalizeName(horse.name)
    ? result
    : null;
};

const artifactPaths = existsSync(SHADOW_DIR)
  ? readdirSync(SHADOW_DIR)
      .filter((name) => /^\d{4}-\d{2}-\d{2}-pre-race\.json$/.test(name))
      .sort()
      .map((name) => join(SHADOW_DIR, name))
  : [];

const completed = [];
const pendingDates = [];
for (const artifactPath of artifactPaths) {
  const artifact = readJson(artifactPath);
  const expectedHash = sha256(stableJson({
    raceDate: artifact.raceDate,
    model: artifact.model,
    predictions: artifact.predictions,
  }));
  if (expectedHash !== artifact.predictionSha256) {
    throw new Error(`Frozen prediction hash mismatch: ${artifactPath}`);
  }
  const resultPath = join(ARCHIVE_DIR, `${artifact.raceDate}-results.json`);
  if (!existsSync(resultPath)) {
    pendingDates.push(artifact.raceDate);
    continue;
  }
  const results = readJson(resultPath);
  const resultsByRace = new Map((results.races ?? []).map((race) => [race.bundleId, race]));
  const rows = artifact.predictions.map((prediction) => {
    const race = resultsByRace.get(prediction.bundleId);
    const currentResult = resultFor(prediction.currentLeader, race);
    const shadowResult = resultFor(prediction.shadowLeader, race);
    const secondResult = resultFor(prediction.currentSecond, race);
    if (!currentResult || !shadowResult || !secondResult) return null;
    return {
      date: artifact.raceDate,
      race: `${prediction.track}${prediction.raceNumber}R`,
      currentLeader: prediction.currentLeader,
      shadowLeader: prediction.shadowLeader,
      currentFinish: Number(currentResult.finishPosition),
      shadowFinish: Number(shadowResult.finishPosition),
      secondFinish: Number(secondResult.finishPosition),
      shadowOtherFinish: prediction.shadowSwap
        ? Number(currentResult.finishPosition)
        : Number(secondResult.finishPosition),
      swap: prediction.shadowSwap,
    };
  }).filter(Boolean);
  completed.push({ date: artifact.raceDate, rows });
}

const rows = completed.flatMap((item) => item.rows);
const statsFor = (finishKey, compareKey) => ({
  count: rows.length,
  wins: rows.filter((row) => row[finishKey] === 1).length,
  places: rows.filter((row) => row[finishKey] <= 3).length,
  pairAhead: rows.filter((row) => row[finishKey] < row[compareKey]).length,
});
const current = statsFor("currentFinish", "secondFinish");
const shadow = statsFor("shadowFinish", "shadowOtherFinish");
const swaps = rows.filter((row) => row.swap).length;
const swapRate = rows.length ? swaps / rows.length : 0;
const enoughEvidence = rows.length >= MIN_EVALUATED_RACES && swaps >= MIN_SWAPS;
const criteria = [
  ["評価済み30レース以上", rows.length >= MIN_EVALUATED_RACES, `${rows.length}レース`],
  ["事前入替5件以上", swaps >= MIN_SWAPS, `${swaps}件`],
  ["入替率40%以下", swapRate <= MAX_SWAP_RATE, pct(swaps, rows.length)],
  ["勝数を維持", shadow.wins >= current.wins, `${current.wins} → ${shadow.wins}`],
  ["複勝数を維持", shadow.places >= current.places, `${current.places} → ${shadow.places}`],
  ["1位・2位間の先着選択を維持", shadow.pairAhead >= current.pairAhead, `${current.pairAhead} → ${shadow.pairAhead}`],
  ["勝数または複勝数が1件以上改善", shadow.wins >= current.wins + 1 || shadow.places >= current.places + 1, `勝 ${shadow.wins - current.wins >= 0 ? "+" : ""}${shadow.wins - current.wins} / 複 ${shadow.places - current.places >= 0 ? "+" : ""}${shadow.places - current.places}`],
];
const accepted = enoughEvidence && criteria.every(([, pass]) => pass);
const status = accepted ? "PASS（接続候補）" : enoughEvidence ? "FAIL（現行維持）" : "COLLECTING（標本蓄積中）";

const dayRows = completed.map(({ date, rows: day }) => {
  const dayCurrentWins = day.filter((row) => row.currentFinish === 1).length;
  const dayShadowWins = day.filter((row) => row.shadowFinish === 1).length;
  const dayCurrentPlaces = day.filter((row) => row.currentFinish <= 3).length;
  const dayShadowPlaces = day.filter((row) => row.shadowFinish <= 3).length;
  return `| ${date} | ${day.length} | ${day.filter((row) => row.swap).length} | ${dayCurrentWins} → ${dayShadowWins} | ${dayCurrentPlaces} → ${dayShadowPlaces} |`;
}).join("\n");
const criterionRows = criteria.map(([label, pass, value]) => `| ${label} | ${pass ? "PASS" : "WAIT/FAIL"} | ${value} |`).join("\n");
const report = `# TM INDEX 首位・影比較 累積評価 (${OUTPUT_DATE})

## 判定

**${status}**

- 評価済み: ${rows.length}レース
- 事前固定された入替: ${swaps}件（${pct(swaps, rows.length)}）
- 結果待ち: ${pendingDates.length ? pendingDates.join("、") : "なし"}
- 結果取得後にだけ集計し、予測・閾値・係数は変更しない

## 累積成績

| 方式 | 1着 | 勝率 | 3着内 | 複勝率 | 1位・2位間の先着選択 |
|---|---:|---:|---:|---:|---:|
| 現行TM INDEX 1位 | ${current.wins} | ${pct(current.wins, current.count)} | ${current.places} | ${pct(current.places, current.count)} | ${pct(current.pairAhead, current.count)} |
| 影比較器 | ${shadow.wins} | ${pct(shadow.wins, shadow.count)} | ${shadow.places} | ${pct(shadow.places, shadow.count)} | ${pct(shadow.pairAhead, shadow.count)} |

## 開催日別

| 日付 | 対象 | 入替 | 勝数 現行→影 | 複勝数 現行→影 |
|---|---:|---:|---:|---:|
${dayRows || "| — | 0 | 0 | — | — |"}

## 採用ゲート

| 基準 | 判定 | 実測 |
|---|---|---|
${criterionRows}

公開時に採用する場合もTM INDEX値そのものは変更せず、指数順位とは別の「総合首位」として扱う。固定ホールドアウトが未通過のため、この累積影評価が全基準を満たすまでは本番へ接続しない。
`;

mkdirSync(dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, report);
console.log(JSON.stringify({
  output: OUTPUT,
  status,
  evaluatedRaces: rows.length,
  swaps,
  pendingDates,
  current,
  shadow,
}, null, 2));
