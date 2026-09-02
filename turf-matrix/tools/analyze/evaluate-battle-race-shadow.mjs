#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  aggregateBattleRows,
  evaluateBattleSelection,
  sameBattleSelection,
} from "./lib/battle-race-shadow.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ARCHIVE_DIR = join(ROOT, "data", "archive");
const SHADOW_DIR = join(ROOT, "data", "shadow", "battle-race");
const OUTPUT_DATE = new Date().toISOString().slice(0, 10);
const OUTPUT = join(ROOT, "docs", "analysis", `battle-race-shadow-evaluation-${OUTPUT_DATE}.md`);
const MIN_DAYS = 6;
const MIN_CHANGED_SELECTIONS = 3;
const readJson = (path) => JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
const stableJson = (value) => `${JSON.stringify(value, null, 2)}\n`;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const pct = (hits, count) => count ? `${(hits / count * 100).toFixed(1)}%` : "—";
const rate = (value) => typeof value === "number" ? `${value.toFixed(1)}%` : "—";

const paths = existsSync(SHADOW_DIR)
  ? readdirSync(SHADOW_DIR)
      .filter((name) => /^\d{4}-\d{2}-\d{2}-pre-race[.]json$/.test(name))
      .sort()
      .map((name) => join(SHADOW_DIR, name))
  : [];
const groups = new Map();
const pendingDates = [];

for (const path of paths) {
  const artifact = readJson(path);
  const expectedHash = sha256(stableJson({
    raceDate: artifact.raceDate,
    engineFingerprint: artifact.source?.engineFingerprint,
    selectionFingerprint: artifact.source?.selectionFingerprint,
    shadowRuleVersion: artifact.shadowRuleVersion,
    baseline: artifact.baseline,
    shadow: artifact.shadow,
    candidates: artifact.candidates,
  }));
  if (expectedHash !== artifact.predictionSha256) throw new Error(`Frozen prediction hash mismatch: ${path}`);
  const resultPath = join(ARCHIVE_DIR, `${artifact.raceDate}-results.json`);
  if (!existsSync(resultPath)) {
    pendingDates.push(artifact.raceDate);
    continue;
  }
  const resultsByRace = new Map((readJson(resultPath).races ?? []).map((race) => [race.bundleId, race]));
  const baseline = evaluateBattleSelection(artifact.baseline, resultsByRace);
  const shadow = evaluateBattleSelection(artifact.shadow, resultsByRace);
  if (!baseline || !shadow) continue;
  const key = [
    artifact.source.engineFingerprint.id,
    artifact.source.selectionFingerprint.id,
    artifact.shadowRuleVersion,
  ].join("/");
  if (!groups.has(key)) groups.set(key, {
    key,
    engineFingerprint: artifact.source.engineFingerprint.id,
    selectionFingerprint: artifact.source.selectionFingerprint.id,
    shadowRuleVersion: artifact.shadowRuleVersion,
    rows: [],
  });
  groups.get(key).rows.push({
    date: artifact.raceDate,
    changed: !sameBattleSelection(artifact.baseline, artifact.shadow),
    baseline,
    shadow,
  });
}

const summaries = [...groups.values()].map((group) => {
  const baseline = aggregateBattleRows(group.rows.map((row) => row.baseline));
  const shadow = aggregateBattleRows(group.rows.map((row) => row.shadow));
  const changes = group.rows.filter((row) => row.changed).length;
  const criteria = [
    ["同一エンジンで6開催日以上", group.rows.length >= MIN_DAYS, `${group.rows.length}日`],
    ["事前選択変更3件以上", changes >= MIN_CHANGED_SELECTIONS, `${changes}件`],
    ["軸1着数を維持", shadow.wins >= baseline.wins, `${baseline.wins} → ${shadow.wins}`],
    ["軸3着内数を維持", shadow.places >= baseline.places, `${baseline.places} → ${shadow.places}`],
    ["相手1との同時3着内を維持", shadow.pair1Hits >= baseline.pair1Hits, `${baseline.pair1Hits} → ${shadow.pair1Hits}`],
    ["相手2との同時3着内を維持", shadow.pair2Hits >= baseline.pair2Hits, `${baseline.pair2Hits} → ${shadow.pair2Hits}`],
    ["軸または相手成績を1件以上改善",
      shadow.wins > baseline.wins || shadow.places > baseline.places
        || shadow.pair1Hits > baseline.pair1Hits || shadow.pair2Hits > baseline.pair2Hits,
      `勝 ${shadow.wins - baseline.wins >= 0 ? "+" : ""}${shadow.wins - baseline.wins} / 複 ${shadow.places - baseline.places >= 0 ? "+" : ""}${shadow.places - baseline.places} / 相1 ${shadow.pair1Hits - baseline.pair1Hits >= 0 ? "+" : ""}${shadow.pair1Hits - baseline.pair1Hits} / 相2 ${shadow.pair2Hits - baseline.pair2Hits >= 0 ? "+" : ""}${shadow.pair2Hits - baseline.pair2Hits}`],
  ];
  const enough = group.rows.length >= MIN_DAYS && changes >= MIN_CHANGED_SELECTIONS;
  const accepted = criteria.every(([, pass]) => pass);
  return { ...group, baseline, shadow, changes, criteria, status: accepted ? "PASS（接続候補）" : enough ? "FAIL（現行維持）" : "COLLECTING（標本蓄積中）" };
});

const sections = summaries.map((summary) => {
  const criteria = summary.criteria.map(([label, pass, value]) => `| ${label} | ${pass ? "PASS" : "WAIT/FAIL"} | ${value} |`).join("\n");
  const days = summary.rows.map((row) => `| ${row.date} | ${row.changed ? "変更" : "同一"} | ${row.baseline.race} ${row.baseline.horseName} (${row.baseline.axisFinish}着) | ${row.shadow.race} ${row.shadow.horseName} (${row.shadow.axisFinish}着) |`).join("\n");
  return `## ${summary.engineFingerprint} / ${summary.shadowRuleVersion}

**${summary.status}**

- 同一採点・選定世代: ${summary.rows.length}日
- 事前選択変更: ${summary.changes}件

| 方式 | 軸1着 | 軸3着内 | 単勝回収率 | 複勝回収率 | 相手1と同時3着内 | 相手2と同時3着内 |
|---|---:|---:|---:|---:|---:|---:|
| 現行 | ${summary.baseline.wins} | ${summary.baseline.places} | ${rate(summary.baseline.winReturnRate)} | ${rate(summary.baseline.placeReturnRate)} | ${summary.baseline.pair1Hits}/${summary.baseline.pair1Comparable} | ${summary.baseline.pair2Hits}/${summary.baseline.pair2Comparable} |
| Battle Readiness | ${summary.shadow.wins} | ${summary.shadow.places} | ${rate(summary.shadow.winReturnRate)} | ${rate(summary.shadow.placeReturnRate)} | ${summary.shadow.pair1Hits}/${summary.shadow.pair1Comparable} | ${summary.shadow.pair2Hits}/${summary.shadow.pair2Comparable} |

### 採用ゲート

| 基準 | 判定 | 実測 |
|---|---|---|
${criteria}

### 開催日別

| 日付 | 選択 | 現行 | 影候補 |
|---|---|---|---|
${days}`;
}).join("\n\n");

const latest = summaries.at(-1);
const report = `# 勝負レース・事前影評価 (${OUTPUT_DATE})

結果を見てから予測や基準を変更せず、採点エンジンと選定ロジックの指紋が同じ開催だけを集計する。

- 現在の判定: **${latest?.status ?? "COLLECTING（事前固定なし）"}**
- 結果待ち: ${pendingDates.length ? pendingDates.join("、") : "なし"}
- 異なるエンジン世代の成績は合算しない

${sections || "同一世代の評価可能な事前固定データはまだありません。"}
`;
mkdirSync(dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, report);
console.log(JSON.stringify({
  output: OUTPUT,
  status: latest?.status ?? "COLLECTING",
  groups: summaries.map((summary) => ({
    engineFingerprint: summary.engineFingerprint,
    days: summary.rows.length,
    changes: summary.changes,
    status: summary.status,
  })),
  pendingDates,
}, null, 2));
