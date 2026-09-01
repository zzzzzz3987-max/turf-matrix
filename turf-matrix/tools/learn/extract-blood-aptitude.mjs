import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { dateKey, isObservationBeforeCutoff, resolveEvaluationCutoff } from "./blood-statistics-policy.mjs";
import { parse as parsePedigreeCache } from "../parsers/pedigree-html-parser.mjs";
import { detectPedigreeCrosses, pedigreeFeatureEntries } from "../intelligence/blood-features.mjs";
import { resolvePedigreeLineIds } from "../intelligence/bloodline-resolver.mjs";

const args = process.argv.slice(2);
const valueAfter = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const inputPath = resolve(valueAfter("--input", "tools/week-data.preodds.json"));
const outputPath = resolve(valueAfter("--output", "tools/jvlink/output/bloodlines.learned.json"));
const archiveDir = resolve(valueAfter("--archive", "data/archive"));
const requestedCutoff = valueAfter("--cutoff", null);
const requestedWeek = valueAfter("--for-week", null);
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
const normalizeAncestor = (value) => normalize(value).replace(/[＊*$]/g, "").replace(/[.'’\-]/g, "");
const pedigreeCacheByHorse = new Map(parsePedigreeCache({
  path: "data/pedigree-cache/__raw_html_not_used__",
}).records.map((record) => [normalize(record.horseName), record]));
const pairKey = (...values) => values.every(Boolean) ? values.join("::") : "";
const enrichPedigree = (horseName, pedigree) => {
  const cached = pedigreeCacheByHorse.get(normalize(horseName));
  if (!cached) return pedigree;
  const byBranch = new Map((cached.ancestors ?? []).map((ancestor) => [ancestor.branch, ancestor]));
  for (const ancestor of pedigree?.ancestors ?? []) {
    if (Number(ancestor.generation) <= 3) byBranch.set(ancestor.branch, ancestor);
  }
  return {
    ...cached,
    ...pedigree,
    ancestors: [...byBranch.values()],
  };
};
const evaluationCutoff = requestedCutoff ? dateKey(requestedCutoff) : resolveEvaluationCutoff(source);
if (!evaluationCutoff) {
  console.error("[ERROR] 評価基準日を特定できないため、未来情報を除外できません。");
  process.exit(2);
}
let futureObservationCount = 0;
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
const addObservation = ({ horseName, pedigree, date, course, surface, distance, going, finish, fieldSize, raceNumber, raceName }) => {
  if (!pedigree || !Number.isFinite(finish) || finish <= 0) return;
  if (!isObservationBeforeCutoff(date, evaluationCutoff)) {
    futureObservationCount += 1;
    return;
  }
  const normalizedHorseName = normalize(horseName);
  const resolvedPedigree = enrichPedigree(horseName, pedigree);
  const resolvedAncestor = (branch) => resolvedPedigree.ancestors?.find((item) => item.branch === branch)?.name;
  const sire = normalize(resolvedPedigree.sire);
  const broodmareSire = normalize(resolvedPedigree.broodmareSire);
  const sireLine = normalize(resolvedPedigree.sireSire ?? resolvedAncestor("sire.sire"));
  const broodmareSireLine = normalize(resolvedAncestor("dam.sire.sire"));
  const resolvedLineIds = resolvePedigreeLineIds(resolvedPedigree);
  const sireLineId = normalize(resolvedLineIds.sireLine?.id);
  const broodmareSireLineId = normalize(resolvedLineIds.broodmareSireLine?.id);
  const crossKeys = detectPedigreeCrosses(pedigreeFeatureEntries({ pedigree: resolvedPedigree }))
    .map((cross) => pairKey(normalizeAncestor(cross.ancestor), cross.pattern));
  const observationKey = [normalizedHorseName, date, course, raceNumber, raceName, finish].join("|");
  if (seen.has(observationKey)) return;
  seen.add(observationKey);
  rows.push({
    horseName: normalizedHorseName,
    sire,
    broodmareSire,
    sireLine,
    broodmareSireLine,
    sireLineId,
    broodmareSireLineId,
    femaleLine: normalize(resolvedPedigree.damDam),
    sireBroodmareSire: pairKey(sire, broodmareSire),
    sireBroodmareSireLine: pairKey(sire, broodmareSireLine),
    sireLineBroodmareSire: pairKey(sireLine, broodmareSire),
    sireLineBroodmareSireLine: pairKey(sireLine, broodmareSireLine),
    sireBroodmareSireLineId: pairKey(sire, broodmareSireLineId),
    sireLineIdBroodmareSire: pairKey(sireLineId, broodmareSire),
    sireLineIdBroodmareSireLineId: pairKey(sireLineId, broodmareSireLineId),
    crossKeys,
    date,
    course: course ?? "unknown",
    surface: surface ?? "unknown",
    distanceBand: distanceBand(distance),
    going: going ?? "unknown",
    season: season(date),
    finish,
    fieldSize: Number(fieldSize) || null,
  });
};
for (const race of source.races ?? []) {
  for (const horse of race.horses ?? []) {
    const pedigree = horse.pedigree;
    if (!pedigree) continue;
    for (const run of horse.pastRuns ?? []) {
      const finish = Number(run.confirmedFinishPosition ?? run.finishPosition);
      if (!Number.isFinite(finish) || finish <= 0) continue;
      addObservation({
        horseName: horse.name ?? horse.horseName,
        pedigree,
        date: run.date ?? run.raceDate,
        course: run.course,
        surface: run.surface,
        distance: run.distance,
        going: run.trackCondition,
        finish,
        fieldSize: run.fieldSize,
        raceNumber: run.raceNumber,
        raceName: run.raceName,
      });
    }
  }
}

let archivePairCount = 0;
if (existsSync(archiveDir)) {
  const dates = readdirSync(archiveDir)
    .map((name) => name.match(/^(\d{4}-\d{2}-\d{2})-preodds\.json$/)?.[1])
    .filter(Boolean)
    .sort();
  for (const date of dates) {
    if (!isObservationBeforeCutoff(date, evaluationCutoff)) continue;
    const snapshotPath = join(archiveDir, `${date}-preodds.json`);
    const resultsPath = join(archiveDir, `${date}-results.json`);
    if (!existsSync(resultsPath)) continue;
    archivePairCount += 1;
    const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
    const results = JSON.parse(readFileSync(resultsPath, "utf8"));
    const resultsByBundle = new Map((results.races ?? []).map((race) => [race.bundleId, race]));
    for (const race of snapshot.races ?? []) {
      const resultRace = resultsByBundle.get(race.bundleId);
      if (!resultRace) continue;
      const resultByNumber = new Map((resultRace.horses ?? []).map((horse) => [Number(horse.horseNumber), horse]));
      for (const horse of race.horses ?? []) {
        const resultHorse = resultByNumber.get(Number(horse.number ?? horse.horseNumber));
        if (!resultHorse || normalize(resultHorse.horseName) !== normalize(horse.name ?? horse.horseName)) continue;
        addObservation({
          horseName: horse.name ?? horse.horseName,
          pedigree: horse.pedigree,
          date,
          course: race.track ?? race.course ?? race.venue,
          surface: race.surface,
          distance: race.distance,
          going: resultRace.going ?? race.going ?? race.trackCondition,
          finish: Number(resultHorse.finishPosition),
          fieldSize: race.horses?.length,
          raceNumber: race.number ?? race.raceNo,
          raceName: race.name ?? race.raceName,
        });
      }
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
const uniqueLineHorses = new Map();
for (const row of rows) {
  const current = uniqueLineHorses.get(row.horseName) ?? { sireLineId: false, broodmareSireLineId: false };
  current.sireLineId ||= Boolean(row.sireLineId);
  current.broodmareSireLineId ||= Boolean(row.broodmareSireLineId);
  uniqueLineHorses.set(row.horseName, current);
}
const lineResolution = {
  source: "bloodline-dictionary-line-id-v1",
  observationCount: rows.length,
  sireResolvedObservationCount: rows.filter((row) => row.sireLineId).length,
  broodmareSireResolvedObservationCount: rows.filter((row) => row.broodmareSireLineId).length,
  bothResolvedObservationCount: rows.filter((row) => row.sireLineId && row.broodmareSireLineId).length,
  uniqueHorseCount: uniqueLineHorses.size,
  sireResolvedUniqueHorseCount: [...uniqueLineHorses.values()].filter((row) => row.sireLineId).length,
  broodmareSireResolvedUniqueHorseCount: [...uniqueLineHorses.values()].filter((row) => row.broodmareSireLineId).length,
  bothResolvedUniqueHorseCount: [...uniqueLineHorses.values()].filter((row) => row.sireLineId && row.broodmareSireLineId).length,
};
const dimensions = [
  ["overall", () => "all"],
  ["courseSurfaceDistance", (row) => `${row.course}|${row.surface}|${row.distanceBand}`],
  ["surfaceDistance", (row) => `${row.surface}|${row.distanceBand}`],
  ["courseSurfaceGoing", (row) => `${row.course}|${row.surface}|${row.going}`],
  ["surfaceSeason", (row) => `${row.surface}|${row.season}`],
];

const aggregateEntity = (field, { multiple = false } = {}) => {
  const entityGroups = new Map();
  for (const row of rows) {
    const names = multiple ? row[field] ?? [] : [row[field]];
    for (const name of new Set(names.filter(Boolean))) {
      if (!entityGroups.has(name)) entityGroups.set(name, []);
      entityGroups.get(name).push(row);
    }
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
  schemaVersion: 4,
  status: "learned",
  generatedForWeek: requestedWeek ?? source.meta?.date ?? source.raceDate ?? evaluationCutoff,
  source: "TURF MATRIX normalized pastRuns + pedigree",
  sourceRaceCount: source.races?.length ?? 0,
  sourceHorseCount: source.races?.reduce((sum, race) => sum + (race.horses?.length ?? 0), 0) ?? 0,
  archivePairCount,
  evaluationCutoff: evaluationCutoff || null,
  futureObservationCount,
  observationCount: rows.length,
  minimumSamples,
  lineResolution,
  baseline,
  entities: {
    sire: aggregateEntity("sire"),
    broodmareSire: aggregateEntity("broodmareSire"),
    sireLine: aggregateEntity("sireLine"),
    broodmareSireLine: aggregateEntity("broodmareSireLine"),
    sireLineId: aggregateEntity("sireLineId"),
    broodmareSireLineId: aggregateEntity("broodmareSireLineId"),
    femaleLine: aggregateEntity("femaleLine"),
    sireBroodmareSire: aggregateEntity("sireBroodmareSire"),
    sireBroodmareSireLine: aggregateEntity("sireBroodmareSireLine"),
    sireLineBroodmareSire: aggregateEntity("sireLineBroodmareSire"),
    sireLineBroodmareSireLine: aggregateEntity("sireLineBroodmareSireLine"),
    sireBroodmareSireLineId: aggregateEntity("sireBroodmareSireLineId"),
    sireLineIdBroodmareSire: aggregateEntity("sireLineIdBroodmareSire"),
    sireLineIdBroodmareSireLineId: aggregateEntity("sireLineIdBroodmareSireLineId"),
    cross: aggregateEntity("crossKeys", { multiple: true }),
  },
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  output: outputPath,
  observations: rows.length,
  archivePairs: archivePairCount,
  evaluationCutoff: output.evaluationCutoff,
  futureObservationsSkipped: futureObservationCount,
  lineResolution,
  sireCount: Object.keys(output.entities.sire).length,
  broodmareSireCount: Object.keys(output.entities.broodmareSire).length,
  sireLineCount: Object.keys(output.entities.sireLine).length,
  broodmareSireLineCount: Object.keys(output.entities.broodmareSireLine).length,
  sireLineIdCount: Object.keys(output.entities.sireLineId).length,
  broodmareSireLineIdCount: Object.keys(output.entities.broodmareSireLineId).length,
  femaleLineCount: Object.keys(output.entities.femaleLine).length,
  sireBroodmareSireCount: Object.keys(output.entities.sireBroodmareSire).length,
  sireBroodmareSireLineCount: Object.keys(output.entities.sireBroodmareSireLine).length,
  sireLineBroodmareSireCount: Object.keys(output.entities.sireLineBroodmareSire).length,
  sireLineBroodmareSireLineCount: Object.keys(output.entities.sireLineBroodmareSireLine).length,
  sireBroodmareSireLineIdCount: Object.keys(output.entities.sireBroodmareSireLineId).length,
  sireLineIdBroodmareSireCount: Object.keys(output.entities.sireLineIdBroodmareSire).length,
  sireLineIdBroodmareSireLineIdCount: Object.keys(output.entities.sireLineIdBroodmareSireLineId).length,
  crossCount: Object.keys(output.entities.cross).length,
  baseline: Object.fromEntries(Object.entries(output.baseline).filter(([key]) => key !== "horseContributions")),
}, null, 2));
