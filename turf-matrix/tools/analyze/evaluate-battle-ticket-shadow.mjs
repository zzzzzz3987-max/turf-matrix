#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sameBattleTicketPlan } from "../battle-ticket-selection.mjs";
import {
  aggregateBattleTicketRows,
  evaluateBattleTicketPlan,
} from "./lib/battle-ticket-shadow.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ARCHIVE_DIR = join(ROOT, "data", "archive");
const SHADOW_DIR = join(ROOT, "data", "shadow", "battle-ticket");
const OUTPUT_DATE = new Date().toISOString().slice(0, 10);
const OUTPUT = join(ROOT, "docs", "analysis", `battle-ticket-shadow-evaluation-${OUTPUT_DATE}.md`);
const MIN_DAYS = 8;
const MIN_CHANGED_PLANS = 4;
const MAX_SKIP_RATE = 0.5;
const MIN_ROI_GAIN = 5;
const readJson = (path) => JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
const stableJson = (value) => `${JSON.stringify(value, null, 2)}\n`;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const pct = (value) => typeof value === "number" ? `${value.toFixed(1)}%` : "—";
const yen = (value) => `${value >= 0 ? "+" : ""}${value.toLocaleString("ja-JP")}円`;

const paths = existsSync(SHADOW_DIR)
  ? readdirSync(SHADOW_DIR)
      .filter((name) => /^\d{4}-\d{2}-\d{2}-pre-race[.]json$/.test(name))
      .sort()
      .map((name) => join(SHADOW_DIR, name))
  : [];
const groups = new Map();
const pendingResults = [];
const incompletePayouts = [];

for (const path of paths) {
  const artifact = readJson(path);
  const expectedHash = sha256(stableJson({
    raceDate: artifact.raceDate,
    engineFingerprint: artifact.source?.engineFingerprint,
    selectionFingerprint: artifact.source?.selectionFingerprint,
    ticketFingerprint: artifact.ticketFingerprint,
    ticketRuleVersion: artifact.ticketRuleVersion,
    race: artifact.race,
    baseline: artifact.baseline,
    shadow: artifact.shadow,
  }));
  if (expectedHash !== artifact.predictionSha256) throw new Error(`Frozen prediction hash mismatch: ${path}`);
  if (!artifact.race || !artifact.baseline || !artifact.shadow) continue;

  const resultPath = join(ARCHIVE_DIR, `${artifact.raceDate}-results.json`);
  if (!existsSync(resultPath)) {
    pendingResults.push(artifact.raceDate);
    continue;
  }
  const resultRace = (readJson(resultPath).races ?? []).find((race) => race.bundleId === artifact.race.bundleId);
  if (!resultRace) {
    pendingResults.push(artifact.raceDate);
    continue;
  }
  const baseline = evaluateBattleTicketPlan(artifact.baseline, resultRace);
  const shadow = evaluateBattleTicketPlan(artifact.shadow, resultRace);
  if (!baseline.complete || !shadow.complete) {
    incompletePayouts.push(artifact.raceDate);
    continue;
  }

  const key = [
    artifact.source.engineFingerprint.id,
    artifact.source.selectionFingerprint.id,
    artifact.ticketFingerprint.id,
    artifact.ticketRuleVersion,
  ].join("/");
  if (!groups.has(key)) groups.set(key, {
    key,
    engineFingerprint: artifact.source.engineFingerprint.id,
    selectionFingerprint: artifact.source.selectionFingerprint.id,
    ticketFingerprint: artifact.ticketFingerprint.id,
    ticketRuleVersion: artifact.ticketRuleVersion,
    rows: [],
  });
  groups.get(key).rows.push({
    date: artifact.raceDate,
    race: `${artifact.race.track}${artifact.race.number}R`,
    axis: artifact.race.indexTop.name,
    changed: !sameBattleTicketPlan(artifact.baseline, artifact.shadow),
    baseline,
    shadow,
  });
}

const summaries = [...groups.values()].map((group) => {
  const baseline = aggregateBattleTicketRows(group.rows.map((row) => row.baseline));
  const shadow = aggregateBattleTicketRows(group.rows.map((row) => row.shadow));
  const changes = group.rows.filter((row) => row.changed).length;
  const skipRate = group.rows.length ? shadow.skippedDays / group.rows.length : 1;
  const roiGain = typeof baseline.roi === "number" && typeof shadow.roi === "number"
    ? shadow.roi - baseline.roi
    : null;
  const criteria = [
    ["同一世代で8開催日以上", group.rows.length >= MIN_DAYS, `${group.rows.length}日`],
    ["事前買い目変更4件以上", changes >= MIN_CHANGED_PLANS, `${changes}件`],
    ["見送り率50%以下", skipRate <= MAX_SKIP_RATE, pct(skipRate * 100)],
    ["的中日数を維持", shadow.hitDays >= baseline.hitDays, `${baseline.hitDays} → ${shadow.hitDays}`],
    ["収支を維持", shadow.profit >= baseline.profit, `${yen(baseline.profit)} → ${yen(shadow.profit)}`],
    ["回収率を5pt以上改善", roiGain !== null && roiGain >= MIN_ROI_GAIN, roiGain === null ? "—" : `${roiGain >= 0 ? "+" : ""}${roiGain.toFixed(1)}pt`],
  ];
  const enough = group.rows.length >= MIN_DAYS && changes >= MIN_CHANGED_PLANS;
  const accepted = criteria.every(([, pass]) => pass);
  return {
    ...group,
    baseline,
    shadow,
    changes,
    criteria,
    status: accepted ? "PASS（接続候補）" : enough ? "FAIL（現行維持）" : "COLLECTING（標本蓄積中）",
  };
});

const summaryTable = (label, summary) => `| ${label} | ${summary.betDays} | ${summary.skippedDays} | ${summary.tickets} | ${summary.hits} | ${summary.hitDays} | ${pct(summary.roi)} | ${yen(summary.profit)} |`;
const typeTable = (label, summary) => ["win", "quinella", "wide"].map((type) => {
  const value = summary.byType[type];
  const typeLabel = { win: "単勝", quinella: "馬連", wide: "ワイド" }[type];
  return `| ${label} | ${typeLabel} | ${value.tickets} | ${value.hits} | ${pct(value.roi)} |`;
}).join("\n");

const sections = summaries.map((summary) => {
  const criteria = summary.criteria.map(([label, pass, value]) => `| ${label} | ${pass ? "PASS" : "WAIT/FAIL"} | ${value} |`).join("\n");
  const days = summary.rows.map((row) => `| ${row.date} | ${row.race} ${row.axis} | ${row.changed ? "変更" : "同一"} | ${row.baseline.plannedTicketCount} | ${row.shadow.plannedTicketCount || "見送り"} | ${yen(row.baseline.profit)} | ${yen(row.shadow.profit)} |`).join("\n");
  return `## ${summary.engineFingerprint} / ${summary.ticketRuleVersion}

**${summary.status}**

| 方式 | 購入日 | 見送り | 点数 | 的中 | 的中日 | 回収率 | 収支 |
|---|---:|---:|---:|---:|---:|---:|---:|
${summaryTable("現行", summary.baseline)}
${summaryTable("券種選別", summary.shadow)}

| 方式 | 券種 | 点数 | 的中 | 回収率 |
|---|---|---:|---:|---:|
${typeTable("現行", summary.baseline)}
${typeTable("券種選別", summary.shadow)}

### 採用ゲート

| 基準 | 判定 | 実測 |
|---|---|---|
${criteria}

### 開催日別

| 日付 | 勝負レース | 買い目 | 現行点数 | 選別点数 | 現行収支 | 選別収支 |
|---|---|---|---:|---:|---:|---:|
${days}`;
}).join("\n\n");

const latest = summaries.at(-1);
const report = `# 勝負レース買い目・事前影評価 (${OUTPUT_DATE})

結果確定前に固定した単勝・馬連・ワイドの採否だけを評価する。異なる採点・選定・買い目世代は合算しない。

- 現在の判定: **${latest?.status ?? "COLLECTING（事前固定なし）"}**
- 結果待ち: ${pendingResults.length ? pendingResults.join("、") : "なし"}
- 払戻不足: ${incompletePayouts.length ? `${incompletePayouts.join("、")}（評価対象外）` : "なし"}
- 古い結果にない馬連払戻を0円として扱わない

${sections || "同一世代の評価可能な事前固定データはまだありません。"}
`;
mkdirSync(dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, report);
console.log(JSON.stringify({
  output: OUTPUT,
  status: latest?.status ?? "COLLECTING",
  groups: summaries.map((summary) => ({ days: summary.rows.length, changes: summary.changes, status: summary.status })),
  pendingResults,
  incompletePayouts,
}, null, 2));
