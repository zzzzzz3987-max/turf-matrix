import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const args = process.argv.slice(2);
const valueAfter = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const inputPath = resolve(valueAfter("--input", "tools/week-data.preodds.json"));
const outputPath = resolve(valueAfter("--output", "tools/jvlink/output/bloodlines.learned.json"));
const minimumSamples = {
  reference: 5,
  active: 12,
  high: 30,
  uniqueHorsesActive: 5,
  uniqueHorsesHigh: 10,
};

if (!existsSync(inputPath)) {
  console.error(`[ERROR] Blood統計の入力がありません: ${inputPath}`);
  process.exit(2);
}

const source = JSON.parse(readFileSync(inputPath, "utf8"));
const normalize = (value) => String(value ?? "").normalize("NFKC").toLowerCase().replace(/\s+/g, "").trim();
const distanceBand = (distance) => {
  const value = Number(distance);
  if (!Number.isFinite(value)) return "unknown";
  if (value <= 1400) return "sprint";
  if (value <= 1800) return "mile";
  if (value <= 2200) return "middle";
  return "long";
};
const season = (date) => {
  const month = Number(String(date ?? "").match(/^\d{4}[-/]?(\d{2})/)?.[1]);
  if ([3, 4, 5].includes(month)) return "spring";
  if ([6, 7, 8].includes(month)) return "summer";
  if ([9, 10, 11].includes(month)) return "autumn";
  if ([12, 1, 2].includes(month)) return "winter";
  return "unknown";
};

const rows = [];
const seen = new Set();
for (const race of source.races ?? []) {
  for (const horse of race.horses ?? []) {
    const pedigree = horse.pedigree;
    if (!pedigree) continue;
    for (const run of horse.pastRuns ?? []) {
      const finish = Number(run.confirmedFinishPosition ?? run.finishPosition);
      if (!Number.isFinite(finish) || finish <= 0) continue;
      const horseName = normalize(horse.name ?? horse.horseName);
      const observationKey = [
        horseName,
        run.date,
        run.course,
        run.raceNumber,
        run.raceName,
        finish,
      ].join("|");
      if (seen.has(observationKey)) continue;
      seen.add(observationKey);
      rows.push({
        horseName,
        sire: normalize(pedigree.sire),
        broodmareSire: normalize(pedigree.broodmareSire),
        femaleLine: normalize(pedigree.damDam),
        date: run.date,
        course: run.course ?? "unknown",
        surface: run.surface ?? "unknown",
        distanceBand: distanceBand(run.distance),
        going: run.trackCondition ?? "unknown",
        season: season(run.date),
        finish,
        fieldSize: Number(run.fieldSize) || null,
      });
    }
  }
}

const summarize = (observations) => {
  const starts = observations.length;
  const horseGroups = observations.reduce((groups, row) => {
    (groups[row.horseName] ??= []).push(row);
    return groups;
  }, {});
  const uniqueHorseCount = Object.keys(horseGroups).length;
  const wins = observations.filter((row) => row.finish === 1).length;
  const top3 = observations.filter((row) => row.finish <= 3).length;
  const avgFinish = starts ? observations.reduce((sum, row) => sum + row.finish, 0) / starts : null;
  const eligible = starts >= minimumSamples.active && uniqueHorseCount >= minimumSamples.uniqueHorsesActive;
  return {
    sampleSize: starts,
    uniqueHorseCount,
    wins,
    top3,
    winRate: starts ? Number((wins / starts).toFixed(4)) : null,
    hitRate: starts ? Number((top3 / starts).toFixed(4)) : null,
    avgFinish: avgFinish == null ? null : Number(avgFinish.toFixed(2)),
    eligible,
    confidence:
      starts >= minimumSamples.high && uniqueHorseCount >= minimumSamples.uniqueHorsesHigh
        ? "high"
        : eligible
          ? "mid"
          : "low",
    horseContributions: Object.fromEntries(Object.entries(horseGroups).map(([horseName, values]) => [
      horseName,
      {
        sampleSize: values.length,
        wins: values.filter((row) => row.finish === 1).length,
        top3: values.filter((row) => row.finish <= 3).length,
        finishTotal: Number(values.reduce((sum, row) => sum + row.finish, 0).toFixed(2)),
      },
    ])),
  };
};

const baseline = summarize(rows);
const dimensions = [
  ["overall", () => "all"],
  ["courseSurfaceDistance", (row) => `${row.course}|${row.surface}|${row.distanceBand}`],
  ["surfaceDistance", (row) => `${row.surface}|${row.distanceBand}`],
  ["courseSurfaceGoing", (row) => `${row.course}|${row.surface}|${row.going}`],
  ["surfaceSeason", (row) => `${row.surface}|${row.season}`],
];

const aggregateEntity = (field) => {
  const entityGroups = new Map();
  for (const row of rows) {
    const name = row[field];
    if (!name) continue;
    if (!entityGroups.has(name)) entityGroups.set(name, []);
    entityGroups.get(name).push(row);
  }
  return Object.fromEntries([...entityGroups.entries()].sort(([a], [b]) => a.localeCompare(b, "ja")).map(([name, observations]) => {
    const stats = {};
    for (const [dimension, keyFor] of dimensions) {
      const groups = new Map();
      for (const row of observations) {
        const key = keyFor(row);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(row);
      }
      stats[dimension] = Object.fromEntries([...groups.entries()]
        .map(([key, values]) => [key, summarize(values)])
        .filter(([, value]) => value.sampleSize >= minimumSamples.reference)
        .sort(([a], [b]) => a.localeCompare(b, "ja")));
    }
    return [name, stats];
  }));
};

const output = {
  schemaVersion: 1,
  status: "learned",
  generatedForWeek: source.meta?.date ?? null,
  source: "TURF MATRIX normalized pastRuns + pedigree",
  sourceRaceCount: source.races?.length ?? 0,
  sourceHorseCount: source.races?.reduce((sum, race) => sum + (race.horses?.length ?? 0), 0) ?? 0,
  observationCount: rows.length,
  minimumSamples,
  baseline,
  entities: {
    sire: aggregateEntity("sire"),
    broodmareSire: aggregateEntity("broodmareSire"),
    femaleLine: aggregateEntity("femaleLine"),
  },
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  output: outputPath,
  observations: rows.length,
  sireCount: Object.keys(output.entities.sire).length,
  broodmareSireCount: Object.keys(output.entities.broodmareSire).length,
  femaleLineCount: Object.keys(output.entities.femaleLine).length,
  baseline: Object.fromEntries(Object.entries(output.baseline).filter(([key]) => key !== "horseContributions")),
}, null, 2));
