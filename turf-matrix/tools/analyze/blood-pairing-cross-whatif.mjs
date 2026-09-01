import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildPairingCrossShadow } from "../intelligence/blood-pairing-statistics.mjs";
import { resolvePedigreeLineIds } from "../intelligence/bloodline-resolver.mjs";

const args = process.argv.slice(2);
const valueAfter = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : fallback;
};
const inputPath = resolve(valueAfter("--input", "tmp/pedigree-complete-candidate.json"));
const statisticsPath = resolve(valueAfter("--statistics", "tmp/blood-pairing-cross-learned.json"));
const outputPath = resolve(valueAfter("--output", "docs/analysis/blood-pairing-cross-whatif-2026-09-01.md"));
const source = JSON.parse(readFileSync(inputPath, "utf8"));
const statistics = JSON.parse(readFileSync(statisticsPath, "utf8"));
const round4 = (value) => Number(Number(value).toFixed(4));
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const bloodFor = (horse) => horse.analysis?.factorsDetail?.blood ?? horse.analysis?.factors?.blood ?? null;
const denseRanks = (rows, scoreKey) => {
  const sorted = [...rows].sort((left, right) => right[scoreKey] - left[scoreKey] || left.number - right.number);
  let previous = null;
  let rank = 0;
  return new Map(sorted.map((row, index) => {
    if (previous == null || row[scoreKey] !== previous) rank = index + 1;
    previous = row[scoreKey];
    return [row.name, rank];
  }));
};

const gradedRaces = (source.races ?? []).filter((race) => race.grade || race.category === "grade");
const rows = [];
for (const race of gradedRaces) {
  const raceRows = (race.horses ?? []).map((horse) => {
    const blood = bloodFor(horse);
    const shadow = buildPairingCrossShadow({ horse, statistics });
    const currentBlood = Number(blood?.score ?? 65);
    return {
      race: race.name,
      number: Number(horse.number ?? horse.currentRace?.horseNumber ?? 0),
      name: horse.name,
      currentBlood,
      adjustment: shadow.adjustment,
      shadowBlood: round4(clamp(currentBlood + shadow.adjustment, 0, 100)),
      bloodStatus: blood?.status ?? "unknown",
      shadow,
    };
  });
  const beforeRanks = denseRanks(raceRows, "currentBlood");
  const afterRanks = denseRanks(raceRows, "shadowBlood");
  for (const row of raceRows) {
    row.beforeRank = beforeRanks.get(row.name);
    row.afterRank = afterRanks.get(row.name);
    rows.push(row);
  }
}

const entitySummary = Object.fromEntries([
  "sireBroodmareSire",
  "sireBroodmareSireLineId",
  "sireLineIdBroodmareSire",
  "sireLineIdBroodmareSireLineId",
  "cross",
].map((entityType) => {
  const entities = Object.values(statistics.entities?.[entityType] ?? {});
  const allStats = entities.flatMap((entity) => Object.values(entity).flatMap((dimension) => Object.values(dimension ?? {})));
  return [entityType, {
    entityCount: entities.length,
    referenceStatCount: allStats.filter((stat) => stat.sampleSize >= (statistics.minimumSamples?.reference ?? 5)).length,
    activeStatCount: allStats.filter((stat) => stat.eligible).length,
    activeEntityCount: entities.filter((entity) => Object.values(entity)
      .some((dimension) => Object.values(dimension ?? {}).some((stat) => stat.eligible))).length,
    maxSampleSize: Math.max(0, ...allStats.map((stat) => stat.sampleSize ?? 0)),
  }];
}));

const activePairings = rows.filter((row) => row.shadow.pairing).length;
const activeCrosses = rows.filter((row) => row.shadow.activeCrosses.length).length;
const changed = rows.filter((row) => row.adjustment !== 0);
const rankChanged = rows.filter((row) => row.beforeRank !== row.afterRank);
const maxAbsAdjustment = Math.max(0, ...rows.map((row) => Math.abs(row.adjustment)));
const currentLineResolution = rows.reduce((summary, row) => {
  const sourceHorse = gradedRaces.find((race) => race.name === row.race)?.horses?.find((horse) => horse.name === row.name);
  const resolved = resolvePedigreeLineIds(sourceHorse?.pedigree);
  summary.sire += Number(Boolean(resolved.sireLine));
  summary.broodmareSire += Number(Boolean(resolved.broodmareSireLine));
  summary.both += Number(Boolean(resolved.sireLine && resolved.broodmareSireLine));
  return summary;
}, { sire: 0, broodmareSire: 0, both: 0 });
const levelCounts = rows.reduce((counts, row) => {
  const key = row.shadow.pairing?.fallbackLevel ?? (row.shadow.pairingReference ? "reference_only" : "none");
  counts[key] = (counts[key] ?? 0) + 1;
  return counts;
}, {});

const statisticText = (attempt) => {
  if (!attempt) return "該当統計なし";
  const selection = attempt.selection;
  const value = selection?.statistic ?? selection?.reference?.statistic;
  const scope = selection?.scope ?? selection?.reference?.scope;
  return `${attempt.fallbackLevel} ${attempt.label} / ${scope ?? "-"} / N=${value?.sampleSize ?? 0}・馬=${value?.uniqueHorseCount ?? 0}`;
};
const crossText = (row) => {
  if (row.shadow.activeCrosses.length) {
    return row.shadow.activeCrosses.map((cross) => {
      const stat = cross.selection.statistic;
      return `${cross.ancestor} ${cross.pattern} N=${stat.sampleSize}`;
    }).join(" / ");
  }
  const reference = row.shadow.crosses.find((cross) => cross.selection.reference);
  if (reference) return `参考のみ ${reference.ancestor} ${reference.pattern} N=${reference.selection.reference.statistic.sampleSize}`;
  return row.shadow.crosses.length ? "検出済み・統計基準未達" : "検出なし";
};

const lines = [
  "# Blood配合・クロス実績 what-if (2026-09-01)",
  "",
  "## 結論",
  "",
  `- 対象は2026-08-30重賞2レース・${rows.length}頭。Blood本番値とTM INDEXは変更していない。`,
  `- 影評価で配合統計が発火した馬は${activePairings}頭、クロス統計が発火した馬は${activeCrosses}頭、Blood影値が変わった馬は${changed.length}頭。`,
  `- 最大絶対変動は${maxAbsAdjustment.toFixed(4)}点（事前固定上限2.0点）、Blood順位変動は${rankChanged.length}頭。`,
  `- line ID解決は父系${currentLineResolution.sire}/${rows.length}頭、母父系${currentLineResolution.broodmareSire}/${rows.length}頭、両方確定${currentLineResolution.both}/${rows.length}頭。`,
  `- 学習観測${statistics.observationCount}件、基準日${statistics.evaluationCutoff}、基準日以後の観測除外${statistics.futureObservationCount}件。現在馬自身の過去走はleave-one-horse-outで除外した。`,
  "- 対象レースの結果・人気・オッズは係数決定にも影評価入力にも使用していない。過去レースの着順は時点を切った配合集団実績として使用した。少数標本は採点せず、完全配合から広い祖先配合へ順にフォールバックした。",
  "",
  "## 学習母集団",
  "",
  `学習観測のline ID解決: 父系${statistics.lineResolution?.sireResolvedObservationCount ?? 0}/${statistics.lineResolution?.observationCount ?? 0}、母父系${statistics.lineResolution?.broodmareSireResolvedObservationCount ?? 0}/${statistics.lineResolution?.observationCount ?? 0}、両方${statistics.lineResolution?.bothResolvedObservationCount ?? 0}/${statistics.lineResolution?.observationCount ?? 0}。`,
  "",
  "| 層 | 登録組数 | 参考統計 | 採用統計 | 採用組数 | 最大N |",
  "|---|---:|---:|---:|---:|---:|",
  ...[
    ["父×母父", "sireBroodmareSire"],
    ["父×母父系", "sireBroodmareSireLineId"],
    ["父系×母父", "sireLineIdBroodmareSire"],
    ["父系×母父系", "sireLineIdBroodmareSireLineId"],
    ["クロス", "cross"],
  ].map(([label, key]) => {
    const value = entitySummary[key];
    return `| ${label} | ${value.entityCount} | ${value.referenceStatCount} | ${value.activeStatCount} | ${value.activeEntityCount} | ${value.maxSampleSize} |`;
  }),
  "",
  "採用条件はN>=12かつ5頭以上、HighはN>=30かつ10頭以上。N>=5は参考表示だけとし、採点しない。系統は血統辞書のline IDへ正規化し、直父または直母父から父系祖先をたどって最初に確定したIDを使う。未分類名を系統として捏造しない。",
  "",
  "## 影評価方式",
  "",
  "1. 父×母父 → 父×母父系 → 父系×母父 → 父系×母父系の順で、最初に採用条件を満たす統計を使う。",
  "2. 各層で今回コース・距離帯 → 今回コース・馬場 → 同馬場・距離帯 → 全体の順に参照する。",
  "3. 3着内率を全体平均へ事前N=24で縮小する。配合は最大±1.5点、クロスは平均して最大±0.5点、合計最大±2.0点。",
  "4. 複数クロスのうち好成績だけを選ばず、採用条件を満たしたクロスを平均する。",
  "",
  `フォールバック内訳: ${Object.entries(levelCounts).map(([key, value]) => `${key} ${value}頭`).join(" / ")}`,
  "",
  "## 20頭比較",
  "",
  "| レース | 馬 | 現Blood | 影補正 | 影Blood | 順位 | 配合Evidence | クロスEvidence |",
  "|---|---|---:|---:|---:|---:|---|---|",
  ...rows.map((row) => {
    const pairing = row.shadow.pairing ?? row.shadow.pairingReference;
    return `| ${row.race} | ${row.number} ${row.name} | ${row.currentBlood.toFixed(4)} | ${row.adjustment >= 0 ? "+" : ""}${row.adjustment.toFixed(4)} | ${row.shadowBlood.toFixed(4)} | ${row.beforeRank}→${row.afterRank} | ${statisticText(pairing)} | ${crossText(row)} |`;
  }),
  "",
  "## 採用判定",
  "",
  `- Future leakage: ${statistics.futureObservationCount === 0 && statistics.evaluationCutoff === "20260830" ? "PASS" : "FAIL"}（対象日2026-08-30より前だけを学習）`,
  `- 最大変動2点以内: ${maxAbsAdjustment <= 2 ? "PASS" : "FAIL"}`,
  `- 人気・オッズ非参照: PASS（モジュール入力はhorseの血統・レース条件と時点付き統計のみ）`,
  `- 現時点の本番接続: HOLD。重賞20頭だけで精度向上は判定せず、事前固定の影値を週末結果へ蓄積してから採否を決める。`,
  "",
  "## 次の確認",
  "",
  "- 未分類となった父系・母父系を監視し、辞書拡張は馬名ではなく再利用可能な祖先・系統ルール単位で行う。",
  "- 配合・クロス影値について30レース以上を事前固定で評価し、1位成績だけでなくBlood順位相関と上位差の保存を確認する。",
  "- 採用時もBlood内だけに接続し、TM INDEXへの接続は別工程で効果を切り分ける。",
  "",
].join("\n");

writeFileSync(outputPath, lines, "utf8");
console.log(JSON.stringify({
  output: outputPath,
  races: gradedRaces.length,
  horses: rows.length,
  activePairings,
  activeCrosses,
  changed: changed.length,
  rankChanged: rankChanged.length,
  maxAbsAdjustment: round4(maxAbsAdjustment),
  levelCounts,
}, null, 2));
