#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildIndividualProfileFit } from "../intelligence/blood-ai.mjs";
import { FOREIGN_SIRE_PROFILE_CANDIDATES } from "../intelligence/dictionaries/foreign-sire-profile-candidates.mjs";
import { BASE_SIRE_PROFILES, SIRE_PROFILES } from "../intelligence/dictionaries/sire-profile-dictionary.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const weekData = JSON.parse(readFileSync(join(ROOT, "tools", "week-data.json"), "utf8").replace(/^\uFEFF/, ""));
const reportDate = new Date().toISOString().slice(0, 10);
const output = join(ROOT, "docs", "analysis", `blood-foreign-profile-whatif-${reportDate}.md`);
const expandedProfiles = SIRE_PROFILES;
const rows = [];

for (const race of (weekData.races ?? []).filter((item) => item.grade)) {
  for (const horse of race.horses ?? []) {
    const bloodScore = horse?.analysis?.factorsDetail?.blood?.score;
    if (!Number.isFinite(bloodScore)) continue;
    const current = buildIndividualProfileFit(horse, race.raceContext, {
      ancestorFallback: true,
      profiles: BASE_SIRE_PROFILES,
    });
    const candidate = buildIndividualProfileFit(horse, race.raceContext, {
      ancestorFallback: true,
      profiles: expandedProfiles,
    });
    const delta = candidate.adjustment - current.adjustment;
    const addedEvidence = candidate.evidence.filter((item) =>
      FOREIGN_SIRE_PROFILE_CANDIDATES.some((profile) => profile.id === item.profileId)
    );
    rows.push({
      race: `${race.track}${race.number}R ${race.name}`,
      horse: horse.name,
      before: bloodScore,
      after: bloodScore + delta,
      delta,
      addedEvidence,
    });
  }
}

const changed = rows.filter((row) => Math.abs(row.delta) >= 0.0001);
const directlyCovered = rows.filter((row) => row.addedEvidence.some((item) => ["sire", "broodmareSire"].includes(item.role)));
const unaffected = rows.filter((row) => !row.addedEvidence.length);
const maxAbsDelta = Math.max(0, ...rows.map((row) => Math.abs(row.delta)));
const maxUnaffectedDelta = Math.max(0, ...unaffected.map((row) => Math.abs(row.delta)));
const meanAbsDelta = rows.length ? rows.reduce((sum, row) => sum + Math.abs(row.delta), 0) / rows.length : 0;
const pass = directlyCovered.length >= 5 && maxAbsDelta <= 1.5 && maxUnaffectedDelta <= 0.25;
const lines = [
  `# 外国血統プロフィール what-if (${reportDate})`,
  "",
  "## 候補",
  "",
  ...FOREIGN_SIRE_PROFILE_CANDIDATES.map((profile) => `- ${profile.names[0]}: ${profile.traits.join(" / ")}`),
  "",
  "全プロフィールは競走実績・血統構成を確認できるスタリオン資料に出典を限定し、産駒統計とは分離した最大±1.5点の個別適合層で測定する。",
  "",
  "## 出典",
  "",
  ...FOREIGN_SIRE_PROFILE_CANDIDATES.map((profile) => `- ${profile.names[0]}: ${profile.sourceRefs.join(" / ")}`),
  "",
  "## 結果",
  "",
  `- 対象: ${rows.length}頭`,
  `- 新規直父・母父照合: ${directlyCovered.length}頭`,
  `- 変化: ${changed.length}頭`,
  `- 最大絶対差: ${maxAbsDelta.toFixed(4)}点`,
  `- 新規Evidenceなしの最大差（center再計算影響）: ${maxUnaffectedDelta.toFixed(4)}点`,
  `- 平均絶対差: ${meanAbsDelta.toFixed(4)}点`,
  `- 安全ゲート: ${pass ? "PASS" : "FAIL"}`,
  "",
  "## 馬別",
  "",
  "| レース | 馬 | 現行Blood | what-if | 差分 | 新規Evidence |",
  "|---|---|---:|---:|---:|---|",
  ...rows.map((row) => `| ${row.race} | ${row.horse} | ${row.before.toFixed(3)} | ${row.after.toFixed(3)} | ${row.delta >= 0 ? "+" : ""}${row.delta.toFixed(3)} | ${row.addedEvidence.map((item) => `${item.roleLabel}${item.name}`).join(" / ") || "—"} |`),
  "",
  "## 判定",
  "",
  pass
    ? "新規照合と既存馬への波及が安全ゲート内。概念回帰と全テスト通過後、本番プロフィール集合へ採用した。"
    : "既存馬への波及または変動幅が安全ゲートを超えたため、本番接続しない。",
  "",
];
writeFileSync(output, lines.join("\n"));
console.log(JSON.stringify({ output, horses: rows.length, directlyCovered: directlyCovered.length, changed: changed.length, maxAbsDelta, maxUnaffectedDelta, meanAbsDelta, pass }, null, 2));
