#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { evidenceProfile, indexRanking } from "../race-signal-selection.mjs";

const ANALYZE_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(ANALYZE_DIR, "..", "..");
const ARCHIVE_DIR = join(ROOT, "data", "archive");
const REPORT_DATE = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
const OUTPUT = join(ROOT, "docs", "analysis", `index-leader-whatif-${REPORT_DATE}.md`);
const readJson = (path) => JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const pct = (hits, count) => count ? `${(hits / count * 100).toFixed(1)}%` : "—";
const roi = (payout, count) => count ? `${(payout / count).toFixed(1)}%` : "—";

const evidenceLeader = (ranked) => {
  const topScore = ranked[0]?.tmIndex;
  if (!finite(topScore)) return null;
  return ranked
    .filter((horse) => horse.tmIndex === topScore)
    .map((horse) => ({ horse, profile: evidenceProfile(horse) }))
    .sort((left, right) => (right.profile.score ?? -Infinity) - (left.profile.score ?? -Infinity)
      || right.profile.coverage - left.profile.coverage
      || left.horse.number - right.horse.number)[0]?.horse ?? null;
};

const methods = {
  current: { label: "現行1位（同点は馬番順）", select: (ranked) => ranked[0] ?? null },
  rank2: { label: "現行2位", select: (ranked) => ranked[1] ?? null },
  tiedEvidence: { label: "同点首位群・総合Evidence最上位", select: evidenceLeader },
};
const createStats = () => ({ count: 0, wins: 0, places: 0, winPayout: 0, placePayout: 0 });
const overall = Object.fromEntries(Object.keys(methods).map((key) => [key, createStats()]));
const tiedOnly = Object.fromEntries(Object.keys(methods).map((key) => [key, createStats()]));
const gapBands = new Map();
const changed = [];

const add = (row, result) => {
  row.count += 1;
  row.wins += result.finishPosition === 1 ? 1 : 0;
  row.places += result.finishPosition <= 3 ? 1 : 0;
  row.winPayout += Number(result.winPayout ?? 0);
  row.placePayout += Number(result.placePayout ?? 0);
};

for (const resultName of readdirSync(ARCHIVE_DIR).filter((name) => /^\d{4}-\d{2}-\d{2}-results\.json$/.test(name))) {
  const date = resultName.slice(0, 10);
  const snapshotPath = join(ARCHIVE_DIR, `${date}-preodds.json`);
  if (!existsSync(snapshotPath)) continue;
  const snapshot = readJson(snapshotPath);
  const results = readJson(join(ARCHIVE_DIR, resultName));
  const resultByBundle = new Map((results.races ?? []).map((race) => [race.bundleId, race]));
  for (const race of snapshot.races ?? []) {
    const resultRace = resultByBundle.get(race.bundleId);
    const ranked = indexRanking(race);
    if (!resultRace || ranked.length < 2) continue;
    const resultByNumber = new Map((resultRace.horses ?? []).map((horse) => [Number(horse.horseNumber), horse]));
    const gap = ranked[0].tmIndex - ranked[1].tmIndex;
    const band = gap === 0 ? "同点" : gap === 1 ? "1点差" : gap === 2 ? "2点差" : "3点差以上";
    if (!gapBands.has(band)) gapBands.set(band, Object.fromEntries(Object.keys(methods).map((key) => [key, createStats()])));
    const selections = Object.fromEntries(Object.entries(methods).map(([key, method]) => [key, method.select(ranked)]));
    for (const [key, horse] of Object.entries(selections)) {
      const result = horse ? resultByNumber.get(Number(horse.number)) : null;
      if (!result || !finite(Number(result.finishPosition)) || Number(result.finishPosition) <= 0) continue;
      add(overall[key], result);
      add(gapBands.get(band)[key], result);
      if (gap === 0) add(tiedOnly[key], result);
    }
    if (gap === 0 && selections.current?.id !== selections.tiedEvidence?.id) {
      changed.push({
        date,
        race: race.name,
        current: selections.current?.name,
        currentFinish: resultByNumber.get(Number(selections.current?.number))?.finishPosition ?? null,
        evidence: selections.tiedEvidence?.name,
        evidenceFinish: resultByNumber.get(Number(selections.tiedEvidence?.number))?.finishPosition ?? null,
      });
    }
  }
}

const tableRow = (label, row) => `| ${label} | ${row.count} | ${row.wins} | ${pct(row.wins, row.count)} | ${row.places} | ${pct(row.places, row.count)} | ${roi(row.winPayout, row.count)} | ${roi(row.placePayout, row.count)} |`;
const renderTable = (stats) => [
  "| 方式 | 対象 | 1着 | 勝率 | 3着内 | 複勝率 | 単勝回収率 | 複勝回収率 |",
  "|---|---:|---:|---:|---:|---:|---:|---:|",
  ...Object.entries(methods).map(([key, method]) => tableRow(method.label, stats[key])),
].join("\n");

const report = [
  `# TM INDEX 首位選定 what-if ${REPORT_DATE}`,
  "",
  "## 目的",
  "",
  "TM INDEXの整数同点を馬番順で決める現行挙動と、同点首位群だけをAbility / Form / Training / PaceのEvidenceで決める方式を比較する。1点差以上の指数序列は変更しない。",
  "",
  "## 全レース",
  "",
  renderTable(overall),
  "",
  "## TM INDEX同点レースのみ",
  "",
  renderTable(tiedOnly),
  "",
  "## 指数差別",
  "",
  ...[...gapBands.entries()].flatMap(([band, stats]) => [`### ${band}`, "", renderTable(stats), ""]),
  "## 同点決着が変わるレース",
  "",
  "| 日付 | レース | 現行1位 | 着順 | Evidence首位 | 着順 |",
  "|---|---|---|---:|---|---:|",
  ...changed.map((row) => `| ${row.date} | ${row.race} | ${row.current} | ${row.currentFinish ?? "—"} | ${row.evidence} | ${row.evidenceFinish ?? "—"} |`),
  "",
  "## 判定原則",
  "",
  "- 現行2位が強いという結果だけで、1位と2位を一律反転しない。",
  "- 整数同点時の馬番順は分析根拠ではないため、Evidenceタイブレークへ置換可能。",
  "- 1点差以上はTM INDEXの情報として維持し、追加データで継続監視する。",
  "",
].join("\n");

writeFileSync(OUTPUT, report);
console.log(JSON.stringify({ output: OUTPUT, overall, tiedOnly, changed: changed.length }, null, 2));
