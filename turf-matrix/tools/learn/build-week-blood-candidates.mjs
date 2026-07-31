import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const args = process.argv.slice(2);
const valueAfter = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const inputPath = resolve(valueAfter("--input", "tools/week-data.preodds.json"));
const learnedPath = resolve(valueAfter("--learned", "tools/jvlink/output/bloodlines.learned.json"));
const outputPath = resolve(valueAfter("--output", "tools/jvlink/output/week-blood-candidates.json"));
const reportPath = resolve(valueAfter("--report", "tools/jvlink/output/week-blood-candidates.md"));

for (const path of [inputPath, learnedPath]) {
  if (!existsSync(path)) {
    console.error(`[ERROR] 必要な入力がありません: ${path}`);
    process.exit(2);
  }
}

const source = JSON.parse(readFileSync(inputPath, "utf8"));
const learned = JSON.parse(readFileSync(learnedPath, "utf8"));
const normalize = (value) => String(value ?? "").normalize("NFKC").toLowerCase().replace(/\s+/g, "").trim();
const distanceBand = (distance) => {
  const value = Number(distance);
  if (!Number.isFinite(value)) return "unknown";
  if (value <= 1400) return "sprint";
  if (value <= 1800) return "mile";
  if (value <= 2200) return "middle";
  return "long";
};
const signed = (value) => `${value >= 0 ? "+" : ""}${value}`;
const percentage = (value) => Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "--";

const statisticFor = (entityType, displayName, race) => {
  if (!displayName) return null;
  const entity = learned.entities?.[entityType]?.[normalize(displayName)];
  if (!entity) return null;
  const band = distanceBand(race.distance);
  const candidates = [
    {
      scope: "course-surface-distance",
      key: `${race.track}|${race.surface}|${band}`,
      value: entity.courseSurfaceDistance?.[`${race.track}|${race.surface}|${band}`],
    },
    {
      scope: "surface-distance",
      key: `${race.surface}|${band}`,
      value: entity.surfaceDistance?.[`${race.surface}|${band}`],
    },
    { scope: "overall", key: "all", value: entity.overall?.all },
  ];
  const selected = candidates.find((candidate) => candidate.value?.eligible)
    ?? candidates.find((candidate) => candidate.value);
  if (!selected) return null;
  const baseline = learned.baseline?.hitRate;
  const hitRateLift = Number.isFinite(baseline) && Number.isFinite(selected.value.hitRate)
    ? Number((selected.value.hitRate - baseline).toFixed(4))
    : null;
  return {
    entityType,
    name: displayName,
    scope: selected.scope,
    conditionKey: selected.key,
    sampleSize: selected.value.sampleSize,
    uniqueHorseCount: selected.value.uniqueHorseCount,
    winRate: selected.value.winRate,
    hitRate: selected.value.hitRate,
    avgFinish: selected.value.avgFinish,
    hitRateLift,
    eligible: Boolean(selected.value.eligible),
    confidence: selected.value.confidence,
    status: selected.value.eligible ? "eligible" : "reference-only",
  };
};

const races = (source.races ?? []).map((race) => {
  const contextTraits = Object.entries(race.raceContext?.traits ?? {})
    .filter(([, value]) => Number.isFinite(value))
    .sort(([, a], [, b]) => b - a)
    .map(([trait, value]) => ({ trait, value }));
  const horses = (race.horses ?? []).map((horse) => {
    const pedigree = horse.pedigree ?? {};
    const blood = horse.analysis?.factorsDetail?.blood ?? null;
    const statistics = [
      statisticFor("sire", pedigree.sire ?? horse.currentRace?.sire, race),
      statisticFor("broodmareSire", pedigree.broodmareSire ?? horse.currentRace?.broodmareSire, race),
      statisticFor("femaleLine", pedigree.damDam, race),
    ].filter(Boolean);
    return {
      horseNumber: horse.number,
      horseName: horse.name ?? horse.horseName,
      pedigree: {
        sire: pedigree.sire ?? horse.currentRace?.sire ?? null,
        broodmareSire: pedigree.broodmareSire ?? horse.currentRace?.broodmareSire ?? null,
        femaleLine: pedigree.damDam ?? null,
      },
      currentBlood: blood ? {
        score: blood.score,
        status: blood.status,
        confidence: blood.confidence,
        summary: blood.summary,
        evidenceLabels: (blood.evidence ?? []).map((item) => item?.label ?? item).filter(Boolean),
      } : null,
      statistics,
      candidateStatus: statistics.some((item) => item.eligible)
        ? "eligible-statistics"
        : blood?.status === "missing"
          ? "missing"
          : "dictionary-only",
    };
  });
  return {
    raceId: race.id,
    date: race.raceContext?.date ?? source.meta?.date ?? null,
    track: race.track,
    raceNo: race.number,
    raceName: race.name,
    surface: race.surface,
    distance: race.distance,
    distanceBand: distanceBand(race.distance),
    targetTraits: contextTraits.slice(0, 2),
    horseCount: horses.length,
    eligibleHorseCount: horses.filter((horse) => horse.candidateStatus === "eligible-statistics").length,
    dictionaryOnlyHorseCount: horses.filter((horse) => horse.candidateStatus === "dictionary-only").length,
    missingHorseCount: horses.filter((horse) => horse.candidateStatus === "missing").length,
    horses,
  };
});

const output = {
  schemaVersion: 1,
  status: "review-candidate",
  sourceWeek: source.meta?.date ?? null,
  sourceMode: source.mode ?? source.meta?.dataStatus ?? null,
  sourcePaths: { weekData: inputPath, learnedStatistics: learnedPath },
  methodology: {
    note: "候補レポートのみ。本番Blood AI・TM INDEX・承認済み辞書へ自動反映しない。",
    dimensions: ["course-surface-distance-band", "surface-distance-band", "overall"],
    minimumSamples: learned.minimumSamples,
    baselineHitRate: learned.baseline?.hitRate ?? null,
  },
  raceCount: races.length,
  horseCount: races.reduce((sum, race) => sum + race.horseCount, 0),
  eligibleHorseCount: races.reduce((sum, race) => sum + race.eligibleHorseCount, 0),
  races,
};

const lines = [
  `# 週次血統専門化候補 ${output.sourceWeek ?? "日付未取得"}`,
  "",
  "> このレポートはレビュー候補です。Blood AI、TM INDEX、承認済み辞書には自動反映しません。",
  "",
  `- 対象: ${output.raceCount}レース / ${output.horseCount}頭`,
  `- 統計候補あり: ${output.eligibleHorseCount}頭`,
  `- 過去走観測: ${learned.observationCount ?? 0}件`,
  `- 全体複勝率: ${percentage(learned.baseline?.hitRate)}`,
  "",
];

for (const race of races) {
  const traits = race.targetTraits.map(({ trait, value }) => `${trait} ${value.toFixed(2)}`).join(" / ") || "未定義";
  lines.push(
    `## ${race.track}${race.raceNo}R ${race.raceName}`,
    "",
    `- 条件: ${race.surface}${race.distance}m (${race.distanceBand})`,
    `- コース要求特性: ${traits}`,
    `- カバー: 統計候補 ${race.eligibleHorseCount} / 辞書のみ ${race.dictionaryOnlyHorseCount} / 欠損 ${race.missingHorseCount}`,
    "",
    "| 馬 | Blood | status | 統計根拠 |",
    "|---|---:|---|---|",
  );
  for (const horse of race.horses) {
    const evidence = horse.statistics.length
      ? horse.statistics.map((item) => `${item.name} ${item.scope} n=${item.sampleSize} 複勝率${percentage(item.hitRate)} 差${signed((item.hitRateLift ?? 0) * 100)}pt ${item.status}`).join("<br>")
      : "該当統計なし";
    lines.push(`| ${horse.horseNumber ?? "--"} ${horse.horseName} | ${horse.currentBlood?.score ?? "--"} | ${horse.candidateStatus} | ${evidence} |`);
  }
  lines.push("");
}

mkdirSync(dirname(outputPath), { recursive: true });
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
writeFileSync(reportPath, `${lines.join("\n")}\n`, "utf8");

console.log(JSON.stringify({
  output: outputPath,
  report: reportPath,
  sourceWeek: output.sourceWeek,
  raceCount: output.raceCount,
  horseCount: output.horseCount,
  eligibleHorseCount: output.eligibleHorseCount,
  perRace: races.map((race) => ({
    race: `${race.track}${race.raceNo}R ${race.raceName}`,
    horses: race.horseCount,
    eligible: race.eligibleHorseCount,
    dictionaryOnly: race.dictionaryOnlyHorseCount,
    missing: race.missingHorseCount,
  })),
}, null, 2));
