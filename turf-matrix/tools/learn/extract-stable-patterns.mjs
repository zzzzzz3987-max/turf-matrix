import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { buildTrainingProfile } from "../intelligence/training-ai.mjs";
import { parseCsvRows } from "../parsers/parser-contract.mjs";

const args = process.argv.slice(2);
const valueAfter = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const archiveDir = resolve(valueAfter("--archive", "data/archive"));
const outputPath = resolve(valueAfter("--output", "tools/jvlink/output/stables.learned.json"));
const minimumSampleSize = 20;

const files = existsSync(archiveDir)
  ? readdirSync(archiveDir).filter((name) => name.endsWith(".json")).map((name) => join(archiveDir, name))
  : [];
const normalize = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, "").trim();
const resultLookup = new Map();
if (existsSync(archiveDir)) {
  for (const name of readdirSync(archiveDir).filter((file) => file.endsWith("-result-template.csv"))) {
    const rows = parseCsvRows(readFileSync(join(archiveDir, name), "utf8"));
    const headers = rows[0] ?? [];
    const index = Object.fromEntries(headers.map((header, column) => [header, column]));
    for (const row of rows.slice(1)) {
      const finish = Number(row[index["着順"]]);
      if (!Number.isFinite(finish) || finish <= 0) continue;
      const key = [
        normalize(row[index["場所"]]),
        Number(row[index["R"]]),
        Number(row[index["馬番"]]),
        normalize(row[index["馬名"]]),
      ].join("|");
      resultLookup.set(key, finish);
    }
  }
}
const examples = [];

for (const file of files) {
  const payload = JSON.parse(readFileSync(file, "utf8"));
  for (const race of payload.races ?? []) {
    for (const horse of race.horses ?? []) {
      const resultKey = [
        normalize(race.course ?? race.venue),
        Number(race.raceNo ?? race.number),
        Number(horse.number ?? horse.horseNumber),
        normalize(horse.name ?? horse.horseName),
      ].join("|");
      const finish = Number(
        resultLookup.get(resultKey) ??
        horse.review?.finishPosition ??
        horse.raw?.review?.finishPosition ??
        horse.result?.finishPosition
      );
      if (!Number.isFinite(finish) || finish <= 0) continue;
      const trainer = horse.trainer ?? horse.currentRace?.trainer;
      if (!trainer) continue;
      const profile = buildTrainingProfile(horse);
      if (!profile.sessions.length) continue;
      const representative = profile.phaseRepresentatives.oneWeek ?? profile.phaseRepresentatives.final;
      if (!representative) continue;
      const laps = [representative.lap?.lap4, representative.lap?.lap3, representative.lap?.lap2, representative.lap?.lap1]
        .filter(Number.isFinite);
      examples.push({
        trainer,
        trainingCenter: horse.currentRace?.stableSide ?? horse.stableSide ?? null,
        placed: finish <= 3,
        phase: representative.phase,
        course: representative.type === "wood" ? representative.course ?? "wood" : "slope",
        time4F: representative.f4,
        last1F: representative.f1,
        accel: laps.length >= 2 && laps.at(-1) <= laps.at(-2),
        count: profile.sessions.length,
      });
    }
  }
}

const percentile = (values, ratio) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))];
};
const groups = new Map();
for (const example of examples) {
  if (!groups.has(example.trainer)) groups.set(example.trainer, []);
  groups.get(example.trainer).push(example);
}

const stables = [];
for (const [name, values] of groups) {
  if (values.length < minimumSampleSize) continue;
  const placed = values.filter((value) => value.placed);
  if (placed.length < 5) continue;
  const courseCounts = placed.reduce((counts, value) => {
    counts[value.course] = (counts[value.course] ?? 0) + 1;
    return counts;
  }, {});
  const primaryCourse = Object.entries(courseCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
  const hitRate = placed.length / values.length;
  stables.push({
    name,
    trainingCenter: values.find((value) => value.trainingCenter)?.trainingCenter ?? null,
    winningPattern: {
      phase: "oneWeek",
      course: primaryCourse ? [primaryCourse] : [],
      time4FMax: percentile(placed.map((value) => value.time4F), 0.65),
      last1FMax: percentile(placed.map((value) => value.last1F), 0.65),
      accel: placed.filter((value) => value.accel).length / placed.length >= 0.6,
      minCount: Math.max(1, Math.round(percentile(placed.map((value) => value.count), 0.35) ?? 1)),
    },
    signaturePhrase: `一週前${primaryCourse ?? "調教"}を軸にした好走時パターン`,
    sampleSize: values.length,
    placedCount: placed.length,
    hitRate: Number(hitRate.toFixed(4)),
    source: "learned",
    confidence: values.length >= 50 ? "high" : "mid",
  });
}

const output = {
  schemaVersion: 2,
  status: "learned",
  source: "data/archive reviewed races",
  archiveFiles: files.length,
  resultRows: resultLookup.size,
  reviewedExamples: examples.length,
  minimumSampleSize,
  stables: stables.sort((a, b) => a.name.localeCompare(b.name, "ja")),
};
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  output: outputPath,
  archiveFiles: files.length,
  resultRows: resultLookup.size,
  reviewedExamples: examples.length,
  learnedStableCount: output.stables.length,
  note: examples.length ? null : "着順付き調教アーカイブがないため、承認候補は生成されていません。",
}, null, 2));
