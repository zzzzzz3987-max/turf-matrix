#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { evidenceOpponent, evidenceProfile, indexRanking, valueOf } from "../race-signal-selection.mjs";
import { widePayoutFor } from "../result-payouts.mjs";

const ANALYZE_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(ANALYZE_DIR, "..", "..");
const ARCHIVE_DIR = join(ROOT, "data", "archive");
const REPORT_DATE = new Date().toISOString().slice(0, 10);
const OUT = join(ROOT, "docs", "analysis", `opponent-selection-whatif-${REPORT_DATE}.md`);
const readJson = (path) => JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const factorScore = (horse, key) => horse?.analysis?.factorsDetail?.[key]?.score ?? null;
const pct = (value, count) => count ? `${(value / count * 100).toFixed(1)}%` : "—";
const returnRate = (payout, bets) => bets ? `${(payout / (bets * 100) * 100).toFixed(1)}%` : "—";

const resultFiles = readdirSync(ARCHIVE_DIR).filter((name) => /^\d{4}-\d{2}-\d{2}-results\.json$/.test(name));
const methods = {
  index3: { label: "TM INDEX 3位", select: (race, ranked) => ranked[2] ?? null },
  training: { label: "指数3〜5位・調教最上位", select: (race, ranked) => [...ranked.slice(2, 5)].sort((a, b) => (factorScore(b, "training") ?? -Infinity) - (factorScore(a, "training") ?? -Infinity) || b.tmIndex - a.tmIndex || a.number - b.number)[0] ?? null },
  form: { label: "指数3〜5位・近走最上位", select: (race, ranked) => [...ranked.slice(2, 5)].sort((a, b) => (factorScore(b, "form") ?? -Infinity) - (factorScore(a, "form") ?? -Infinity) || b.tmIndex - a.tmIndex || a.number - b.number)[0] ?? null },
  pace: { label: "指数3〜5位・展開最上位", select: (race, ranked) => [...ranked.slice(2, 5)].sort((a, b) => (factorScore(b, "pace") ?? -Infinity) - (factorScore(a, "pace") ?? -Infinity) || b.tmIndex - a.tmIndex || a.number - b.number)[0] ?? null },
  value: { label: "旧方式・VALUE 1位", select: (race, ranked) => [...(race.horses ?? [])]
    .filter((horse) => !new Set(ranked.slice(0, 2).map((item) => item.id)).has(horse.id))
    .filter((horse) => finite(valueOf(horse)?.ev) && valueOf(horse).ev >= 1 && valueOf(horse).ev < 3)
    .sort((a, b) => (valueOf(b)?.marketGap ?? -Infinity) - (valueOf(a)?.marketGap ?? -Infinity)
      || valueOf(b).ev - valueOf(a).ev || b.tmIndex - a.tmIndex || a.number - b.number)[0] ?? ranked[2] ?? null },
  evidence: { label: "指数3〜5位・総合Evidence", select: (race) => evidenceOpponent(race)?.horse ?? null },
};
const stats = Object.fromEntries(Object.keys(methods).map((key) => [key, {
  count: 0,
  opponentPlaced: 0,
  axisPlaced: 0,
  coPlaced: 0,
  wideBets: 0,
  wideHits: 0,
  widePayout: 0,
}]));
const raceRows = [];
let skipped = 0;

for (const resultName of resultFiles) {
  const date = resultName.slice(0, 10);
  const snapshotPath = join(ARCHIVE_DIR, `${date}-preodds.json`);
  if (!existsSync(snapshotPath)) continue;
  const snapshot = readJson(snapshotPath);
  const results = readJson(join(ARCHIVE_DIR, resultName));
  const resultByBundle = new Map((results.races ?? []).map((race) => [race.bundleId, race]));
  for (const race of snapshot.races ?? []) {
    const resultRace = resultByBundle.get(race.bundleId);
    const ranked = indexRanking(race);
    if (!resultRace || ranked.length < 5) {
      skipped += 1;
      continue;
    }
    const finishByNumber = new Map((resultRace.horses ?? []).map((horse) => [Number(horse.horseNumber), Number(horse.finishPosition)]));
    const axis = ranked[0];
    const axisFinish = finishByNumber.get(Number(axis.number));
    if (!finite(axisFinish) || axisFinish <= 0) {
      skipped += 1;
      continue;
    }
    const selections = {};
    for (const [key, method] of Object.entries(methods)) {
      const opponent = method.select(race, ranked);
      const opponentFinish = opponent ? finishByNumber.get(Number(opponent.number)) : null;
      if (!opponent || !finite(opponentFinish) || opponentFinish <= 0) continue;
      const row = stats[key];
      row.count += 1;
      row.axisPlaced += axisFinish <= 3 ? 1 : 0;
      row.opponentPlaced += opponentFinish <= 3 ? 1 : 0;
      row.coPlaced += axisFinish <= 3 && opponentFinish <= 3 ? 1 : 0;
      const wide = widePayoutFor(resultRace, axis.number, opponent.number);
      if (wide.available) {
        row.wideBets += 1;
        row.wideHits += wide.hit ? 1 : 0;
        row.widePayout += wide.payout;
      }
      selections[key] = `${opponent.name}(${opponentFinish}着)`;
    }
    raceRows.push({ date, race: race.name, axis: `${axis.name}(${axisFinish}着)`, selections });
  }
}

const rankedMethods = Object.entries(stats).sort(([, a], [, b]) => (b.coPlaced / (b.count || 1)) - (a.coPlaced / (a.count || 1)));
const wideRaceCount = Math.max(...Object.values(stats).map((row) => row.wideBets), 0);
const lines = [
  `# 相手2選定 what-if (${REPORT_DATE})`,
  "",
  "## 前提",
  "",
  "- 相手1はTM INDEX 2位で固定し、本レポートでは相手2の候補方式を比較する。",
  "- 最重要指標は、TM INDEX 1位の軸と相手2が同時に3着以内へ入った割合（ワイド成立率）とする。",
  wideRaceCount
    ? `- JV-Link HRのワイド払戻を取得できた${wideRaceCount}レースだけ、100円均等購入の的中率・回収率を併記する。旧アーカイブは分母に含めない。`
    : "- 既存結果アーカイブにワイド払戻がないため、ワイド回収率は未集計。今後取得した開催から蓄積する。",
  "- 着順結果がないレース、出走馬5頭未満、異常終了馬は集計から除外する。",
  "",
  "## 集計結果",
  "",
  "| 方式 | 対象 | 相手2複勝率 | 軸複勝率 | 同時3着内 | ワイド対象 | ワイド的中率 | ワイド回収率 |",
  "|---|---:|---:|---:|---:|---:|---:|---:|",
  ...Object.entries(methods).map(([key, method]) => {
    const row = stats[key];
    return `| ${method.label} | ${row.count} | ${pct(row.opponentPlaced, row.count)} | ${pct(row.axisPlaced, row.count)} | ${pct(row.coPlaced, row.count)} | ${row.wideBets} | ${pct(row.wideHits, row.wideBets)} | ${returnRate(row.widePayout, row.wideBets)} |`;
  }),
  "",
  `対象レース: ${Math.max(...Object.values(stats).map((row) => row.count), 0)} / スキップ: ${skipped}`,
  "",
  "## 暫定判定",
  "",
  rankedMethods[0]?.[1].count
    ? `現時点の同時3着内率トップは **${methods[rankedMethods[0][0]].label}**。${wideRaceCount ? `ワイド払戻は${wideRaceCount}レース分の初期標本であり、採用判断にはまだ使わない。` : "払戻未取得のため、採用判断は的中率ベースの暫定評価。"}`
    : "有効な結果データがなく、方式比較は未判定。",
  "",
  "実運用では、指数3〜5位の能力・近走・調教・展開を等配分した総合Evidence方式を採用し、VALUEは選定の主因ではなく同点時の補助に限定する。",
  "",
  "## レース別選定",
  "",
  "| 日付 | レース | 軸 | INDEX3 | 調教 | 近走 | 展開 | VALUE | 総合Evidence |",
  "|---|---|---|---|---|---|---|---|---|",
  ...raceRows.map((row) => `| ${row.date} | ${row.race} | ${row.axis} | ${row.selections.index3 ?? "—"} | ${row.selections.training ?? "—"} | ${row.selections.form ?? "—"} | ${row.selections.pace ?? "—"} | ${row.selections.value ?? "—"} | ${row.selections.evidence ?? "—"} |`),
  "",
  "## 総合Evidence定義",
  "",
  "候補はTM INDEX 3〜5位に限定し、Ability / Form / Training / Paceの利用可能スコアを等配分で平均する。同点時のみデータ充足度、EV、TM INDEX、馬番の順で決定する。",
  "",
  `参考: 現行ロジックのEvidenceプロファイルは4項目（${Object.keys(evidenceProfile({ analysis: { factorsDetail: {} } }).components).join(" / ")}）。`,
  "",
];
writeFileSync(OUT, lines.join("\n"));
console.log(JSON.stringify({ out: OUT, races: raceRows.length, skipped, stats }, null, 2));
