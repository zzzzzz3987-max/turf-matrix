#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildIndividualProfileFit } from "../intelligence/blood-ai.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const weekData = JSON.parse(readFileSync(join(ROOT, "tools", "week-data.json"), "utf8").replace(/^\uFEFF/, ""));
const reportDate = new Date().toISOString().slice(0, 10);
const output = join(ROOT, "docs", "analysis", `blood-ancestor-profile-whatif-${reportDate}.md`);
const rows = [];

for (const race of (weekData.races ?? []).filter((item) => item.grade)) {
  for (const horse of race.horses ?? []) {
    const current = buildIndividualProfileFit(horse, race.raceContext);
    const candidate = buildIndividualProfileFit(horse, race.raceContext, { ancestorFallback: true });
    const bloodScore = horse?.analysis?.factorsDetail?.blood?.score;
    if (!Number.isFinite(bloodScore)) continue;
    const delta = candidate.adjustment - current.adjustment;
    const inherited = candidate.evidence.filter((item) => item.sourceType === "ancestor_profile_fallback");
    rows.push({
      race: `${race.track}${race.number}R ${race.name}`,
      horse: horse.name,
      before: bloodScore,
      after: bloodScore + delta,
      delta,
      inherited,
    });
  }
}

const changed = rows.filter((row) => Math.abs(row.delta) >= 0.0001);
const maxAbsDelta = Math.max(0, ...rows.map((row) => Math.abs(row.delta)));
const meanAbsDelta = rows.length ? rows.reduce((sum, row) => sum + Math.abs(row.delta), 0) / rows.length : 0;
const inheritedCounts = new Map();
for (const row of changed) {
  for (const item of row.inherited) {
    const key = `${item.name} (${item.branch})`;
    inheritedCounts.set(key, (inheritedCounts.get(key) ?? 0) + 1);
  }
}
const pass = changed.length > 0 && maxAbsDelta <= 0.5;
const lines = [
  `# Blood祖先プロフィール継承 what-if (${reportDate})`,
  "",
  "## 設計",
  "",
  "- 直父または母父の個別プロフィールがない枝だけ、取得済み祖先で最も近い登録プロフィールを1件採用する。",
  "- 父父は既存の実重み0.12、3代祖先は1本0.01を使い、未照合分を中立値として加算しない。",
  "- 直父・母父プロフィール、統計補正、Bloodlineルール、定数は変更しない。",
  "",
  "## 結果",
  "",
  `- 対象: ${rows.length}頭`,
  `- 変化: ${changed.length}頭`,
  `- 最大絶対差: ${maxAbsDelta.toFixed(4)}点`,
  `- 平均絶対差: ${meanAbsDelta.toFixed(4)}点`,
  `- 安全ゲート（変化あり・最大0.5点以内）: ${pass ? "PASS" : "FAIL"}`,
  "",
  "## 採用祖先",
  "",
  ...(inheritedCounts.size
    ? [...inheritedCounts.entries()].map(([key, count]) => `- ${key}: ${count}頭`)
    : ["- 該当なし"]),
  "",
  "## 馬別",
  "",
  "| レース | 馬 | 現行Blood | what-if | 差分 | 継承Evidence |",
  "|---|---|---:|---:|---:|---|",
  ...rows.map((row) => `| ${row.race} | ${row.horse} | ${row.before.toFixed(3)} | ${row.after.toFixed(3)} | ${row.delta >= 0 ? "+" : ""}${row.delta.toFixed(3)} | ${row.inherited.map((item) => `${item.name} ${item.branch} w=${item.weight}`).join(" / ") || "—"} |`),
  "",
  "## 判定",
  "",
  pass
    ? "差分は世代重みの範囲内。馬名・着順・人気を使わず、既に取得済みの血統構造だけを補完するため、本番候補とする。"
    : "安全ゲート未達。Blood本番値へは接続しない。",
  "",
];
writeFileSync(output, lines.join("\n"));
console.log(JSON.stringify({ output, horses: rows.length, changed: changed.length, maxAbsDelta, meanAbsDelta, pass }, null, 2));
