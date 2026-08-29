#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildLoadAnalysis, buildRaceLoadContext } from "../intelligence/load-ai.mjs";

const ANALYZE_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(ANALYZE_DIR, "..", "..");
const ARCHIVE_DIR = join(ROOT, "data", "archive");
const REPORT_DATE = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
const OUTPUT = join(ROOT, "docs", "analysis", `load-adjustment-whatif-${REPORT_DATE}.md`);
const readJson = (path) => JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const pct = (value, count) => count ? `${(value / count * 100).toFixed(1)}%` : "—";

const raceShape = (race) => ({
  raceDate: race.id?.slice(0, 10) ?? null,
  raceName: race.name,
  raceNameRaw: race.nameRaw,
  grade: race.grade,
  category: race.category,
  surface: race.surface,
  distance: race.distance,
});

const rank = (horses, scoreFor) => [...horses]
  .filter((horse) => finite(Number(scoreFor(horse))))
  .sort((left, right) => Number(scoreFor(right)) - Number(scoreFor(left)) || Number(left.number) - Number(right.number));

const withLoad = (race) => {
  const shapedRace = raceShape(race);
  const loadContext = buildRaceLoadContext(race.horses ?? [], shapedRace);
  const context = { ...shapedRace, load: loadContext };
  return (race.horses ?? []).map((horse) => {
    const load = buildLoadAnalysis(horse, context);
    return {
      ...horse,
      proposedLoadAdjustment: load.adjustment,
      loadAnalysis: load,
      adjustedIndex: Math.max(45, Math.min(92, Number(horse.tmIndex) + load.adjustment)),
    };
  });
};

const stats = { races: 0, horses: 0, baselineWins: 0, baselinePlaces: 0, adjustedWins: 0, adjustedPlaces: 0, changed: 0 };
const changed = [];
const dates = [];

for (const resultName of readdirSync(ARCHIVE_DIR).filter((name) => /^\d{4}-\d{2}-\d{2}-results\.json$/.test(name)).sort()) {
  const date = resultName.slice(0, 10);
  const snapshotPath = join(ARCHIVE_DIR, `${date}-preodds.json`);
  if (!existsSync(snapshotPath)) continue;
  const snapshot = readJson(snapshotPath);
  const results = readJson(join(ARCHIVE_DIR, resultName));
  const resultByBundle = new Map((results.races ?? []).map((race) => [race.bundleId, race]));
  let evaluatedForDate = 0;
  for (const race of snapshot.races ?? []) {
    const resultRace = resultByBundle.get(race.bundleId);
    if (!resultRace) continue;
    const evaluated = withLoad(race);
    const baseline = rank(evaluated, (horse) => horse.tmIndex)[0];
    const adjusted = rank(evaluated, (horse) => horse.adjustedIndex)[0];
    if (!baseline || !adjusted) continue;
    const resultsByNumber = new Map((resultRace.horses ?? []).map((horse) => [Number(horse.horseNumber), horse]));
    const baselineResult = resultsByNumber.get(Number(baseline.number));
    const adjustedResult = resultsByNumber.get(Number(adjusted.number));
    if (!baselineResult || !adjustedResult || !finite(Number(baselineResult.finishPosition)) || !finite(Number(adjustedResult.finishPosition))) continue;
    stats.races += 1;
    stats.horses += evaluated.length;
    evaluatedForDate += 1;
    stats.baselineWins += Number(baselineResult.finishPosition) === 1 ? 1 : 0;
    stats.baselinePlaces += Number(baselineResult.finishPosition) <= 3 ? 1 : 0;
    stats.adjustedWins += Number(adjustedResult.finishPosition) === 1 ? 1 : 0;
    stats.adjustedPlaces += Number(adjustedResult.finishPosition) <= 3 ? 1 : 0;
    if (baseline.id !== adjusted.id) {
      stats.changed += 1;
      changed.push({
        date,
        race: race.name,
        baseline: baseline.name,
        baselineIndex: baseline.tmIndex,
        baselineFinish: baselineResult.finishPosition,
        adjusted: adjusted.name,
        adjustedIndex: adjusted.adjustedIndex,
        adjustedFinish: adjustedResult.finishPosition,
      });
    }
  }
  if (evaluatedForDate) dates.push(`${date} (${evaluatedForDate}R)`);
}

const currentPath = join(ARCHIVE_DIR, "2026-08-30-preodds.json");
const current = existsSync(currentPath) ? readJson(currentPath) : null;
const sundayRows = [];
for (const race of current?.races ?? []) {
  const ranked = rank(withLoad(race), (horse) => horse.adjustedIndex);
  for (let index = 0; index < ranked.length; index += 1) {
    const horse = ranked[index];
    sundayRows.push({
      race: `${race.track}${race.number}R ${race.name}`,
      horse: horse.name,
      carriedWeight: horse.carriedWeight,
      equivalentWeight: horse.loadAnalysis.equivalentWeight,
      relativeKg: horse.loadAnalysis.relativeKg,
      adjustment: horse.proposedLoadAdjustment,
      before: horse.tmIndex,
      after: horse.adjustedIndex,
      rank: index + 1,
    });
  }
}

const gate = {
  sample: stats.races >= 100,
  changed: stats.changed > 0,
  changeRate: stats.races > 0 && stats.changed / stats.races <= 0.2,
  wins: stats.adjustedWins >= stats.baselineWins,
  places: stats.adjustedPlaces >= stats.baselinePlaces,
};
const adopted = Object.values(gate).every(Boolean);
const signed = (value) => value > 0 ? `+${value}` : `${value}`;
const changedTable = changed.length
  ? changed.map((row) => `| ${row.date} | ${row.race} | ${row.baseline} (${row.baselineIndex}) | ${row.baselineFinish} | ${row.adjusted} (${row.adjustedIndex}) | ${row.adjustedFinish} |`)
  : ["| — | 変更なし | — | — | — | — |"];

const report = [
  `# 斤量補正 what-if ${REPORT_DATE}`,
  "",
  "## 固定仕様",
  "",
  "- JRAの馬齢重量差と牝馬2kg減を古馬牡馬基準へ換算する。",
  "- レース内の換算斤量中央値との差を評価する。",
  "- 補正は1kg差あたり0.75点相当を整数化し、最大±2点とする。",
  "- 今回距離±200m、同一馬場区分で同等以上の斤量を背負った3着内が2走以上あれば、減点を1点だけ緩和する。",
  "- オッズ、人気、馬名、結果は補正値の算出に使わない。",
  "",
  "## 履歴検証",
  "",
  `- 対象: ${dates.join(" / ")}`,
  `- ${stats.races}レース / ${stats.horses}頭`,
  "",
  "| 方式 | 1着 | 勝率 | 3着内 | 複勝率 |",
  "|---|---:|---:|---:|---:|",
  `| 現行TM INDEX 1位 | ${stats.baselineWins} | ${pct(stats.baselineWins, stats.races)} | ${stats.baselinePlaces} | ${pct(stats.baselinePlaces, stats.races)} |`,
  `| 斤量補正後1位 | ${stats.adjustedWins} | ${pct(stats.adjustedWins, stats.races)} | ${stats.adjustedPlaces} | ${pct(stats.adjustedPlaces, stats.races)} |`,
  "",
  `- 首位変更: ${stats.changed}レース (${pct(stats.changed, stats.races)})`,
  `- 採用ゲート: **${adopted ? "PASS" : "FAIL"}**`,
  `- 内訳: 100R以上=${gate.sample} / 変更あり=${gate.changed} / 変更率20%以下=${gate.changeRate} / 勝数維持=${gate.wins} / 複勝数維持=${gate.places}`,
  "",
  "## 首位変更レース",
  "",
  "| 日付 | レース | 現行1位 (指数) | 着順 | 補正後1位 (指数) | 着順 |",
  "|---|---|---|---:|---|---:|",
  ...changedTable,
  "",
  "## 2026-08-30 公開データ what-if",
  "",
  "| レース | 馬 | 斤量 | 換算斤量 | 中央値差 | 補正 | 変更前 | 変更後 | 順位 |",
  "|---|---|---:|---:|---:|---:|---:|---:|---:|",
  ...sundayRows.map((row) => `| ${row.race} | ${row.horse} | ${row.carriedWeight ?? "—"} | ${row.equivalentWeight?.toFixed(1) ?? "—"} | ${signed(row.relativeKg)}kg | ${signed(row.adjustment)} | ${row.before} | ${row.after} | ${row.rank} |`),
  "",
  "## 判定",
  "",
  adopted
    ? "履歴上で指数1位の勝数・複勝数を落とさず、変更率も上限内のため、本番接続候補とする。"
    : "採用ゲート未達。斤量Evidenceは表示するが、TM INDEXへの補正接続は行わない。",
  "",
].join("\n");

writeFileSync(OUTPUT, report);
console.log(JSON.stringify({ output: OUTPUT, stats, gate, adopted }, null, 2));
