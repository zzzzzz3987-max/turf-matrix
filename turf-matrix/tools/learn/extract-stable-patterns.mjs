import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { buildTrainingProfile } from "../intelligence/training-ai.mjs";
import { parseCsvRows } from "../parsers/parser-contract.mjs";
import { DEFAULT_LEARNING_OPTIONS, learnStablePatterns, trainingPhaseSnapshot } from "./stable-pattern-learning.mjs";

const args = process.argv.slice(2);
const valueAfter = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const archiveDir = resolve(valueAfter("--archive", "data/archive"));
const outputPath = resolve(valueAfter("--output", "tools/jvlink/output/stables.learned.json"));
const historyPath = resolve(valueAfter("--observations", "tools/jvlink/output/stable-history-observations.json"));
const numberAfter = (flag, fallback) => {
  const value = Number(valueAfter(flag, fallback));
  return Number.isFinite(value) ? value : fallback;
};
const learningOptions = {
  ...DEFAULT_LEARNING_OPTIONS,
  minimumStableSampleSize: numberAfter("--minimum-stable-sample", DEFAULT_LEARNING_OPTIONS.minimumStableSampleSize),
  minimumPatternSampleSize: numberAfter("--minimum-pattern-sample", DEFAULT_LEARNING_OPTIONS.minimumPatternSampleSize),
  priorWeight: numberAfter("--prior-weight", DEFAULT_LEARNING_OPTIONS.priorWeight),
  validationFraction: numberAfter("--validation-fraction", DEFAULT_LEARNING_OPTIONS.validationFraction),
};

const files = existsSync(archiveDir)
  ? readdirSync(archiveDir).filter((name) => name.endsWith(".json")).map((name) => join(archiveDir, name))
  : [];
const normalize = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, "").trim();
const resultLookup = new Map();
const resultByBundleHorse = new Map();
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
  for (const name of readdirSync(archiveDir).filter((file) => file.endsWith("-results.json"))) {
    const payload = JSON.parse(readFileSync(join(archiveDir, name), "utf8"));
    for (const race of payload.races ?? []) {
      for (const horse of race.horses ?? []) {
        const finish = Number(horse.finishPosition);
        if (!Number.isFinite(finish) || finish <= 0) continue;
        const key = [
          race.bundleId,
          Number(horse.horseNumber),
          normalize(horse.horseName),
        ].join("|");
        resultByBundleHorse.set(key, finish);
      }
    }
  }
}
const observationsByKey = new Map();
let duplicateRows = 0;

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
        resultByBundleHorse.get([
          race.bundleId,
          Number(horse.number ?? horse.horseNumber),
          normalize(horse.name ?? horse.horseName),
        ].join("|")) ??
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
      const phases = Object.fromEntries(
        ["oneWeek", "final"]
          .map((phase) => [phase, trainingPhaseSnapshot(profile.phaseRepresentatives[phase])])
          .filter(([, value]) => value)
      );
      if (!Object.keys(phases).length) continue;
      const raceIdentity = race.bundleId ?? [
        race.date ?? payload.meta?.date ?? payload.date,
        normalize(race.course ?? race.venue),
        Number(race.raceNo ?? race.number),
      ].join("|");
      const observationKey = [
        raceIdentity,
        Number(horse.number ?? horse.horseNumber),
        normalize(horse.name ?? horse.horseName),
      ].join("|");
      const observation = {
        id: observationKey,
        dedupeKey: [
          horse.currentRace?.raceDate ?? race.date ?? payload.meta?.date ?? payload.date ?? "",
          normalize(horse.name ?? horse.horseName),
        ].join("|"),
        trainer,
        trainingCenter: horse.currentRace?.stableSide ?? horse.stableSide ?? null,
        raceDate: horse.currentRace?.raceDate ?? race.date ?? payload.meta?.date ?? payload.date ?? null,
        finish,
        placed: finish <= 3,
        count: profile.sessions.length,
        phases,
        sourceFile: file,
      };
      const storageKey = observation.dedupeKey || observationKey;
      const current = observationsByKey.get(storageKey);
      if (current) duplicateRows += 1;
      if (!current || Object.keys(observation.phases).length > Object.keys(current.phases).length || observation.count > current.count) {
        observationsByKey.set(storageKey, observation);
      }
    }
  }
}
let historicalObservationCount = 0;
if (existsSync(historyPath)) {
  const history = JSON.parse(readFileSync(historyPath, "utf8"));
  for (const observation of history.observations ?? []) {
    if (!observation?.id || !observation.trainer || !observation.phases) continue;
    historicalObservationCount += 1;
    const storageKey = observation.dedupeKey || observation.id;
    const current = observationsByKey.get(storageKey);
    if (current) duplicateRows += 1;
    if (!current || Object.keys(observation.phases).length > Object.keys(current.phases).length || Number(observation.count ?? 0) > Number(current.count ?? 0)) {
      observationsByKey.set(storageKey, observation);
    }
  }
}
const observations = [...observationsByKey.values()];
const learned = learnStablePatterns(observations, learningOptions);

const output = {
  schemaVersion: 3,
  status: "learned",
  source: "JV-Link RACE/SLOP/WOOD history and reviewed archives",
  archiveFiles: files.length,
  resultRows: resultLookup.size,
  resultJsonRows: resultByBundleHorse.size,
  reviewedExamples: observations.length,
  archiveObservationCount: observations.length - historicalObservationCount,
  historicalObservationCount,
  historyPath: existsSync(historyPath) ? historyPath : null,
  duplicateRowsRemoved: duplicateRows,
  uniqueTrainerCount: learned.diagnostics.length,
  minimumSampleSize: learningOptions.minimumStableSampleSize,
  minimumPatternSampleSize: learningOptions.minimumPatternSampleSize,
  learningPolicy: {
    comparison: "同一厩舎の全出走を基準に、パターン合致時の収縮後複勝率を比較",
    phasePolicy: "一週前と最終追い切りを分離",
    priorWeight: learningOptions.priorWeight,
    validationFraction: learningOptions.validationFraction,
    minimumAdjustedLift: learningOptions.minimumAdjustedLift,
    minimumValidationMatches: learningOptions.minimumValidationMatches,
    minimumValidationLift: learningOptions.minimumValidationLift,
    productionWrite: false,
  },
  stables: learned.stables,
  candidates: learned.candidates,
  diagnostics: learned.diagnostics,
};
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  output: outputPath,
  archiveFiles: files.length,
  resultRows: resultLookup.size,
  resultJsonRows: resultByBundleHorse.size,
  reviewedExamples: observations.length,
  historicalObservationCount,
  duplicateRowsRemoved: duplicateRows,
  uniqueTrainerCount: learned.diagnostics.length,
  eligibleTrainerCount: learned.candidates.length,
  learnedStableCount: output.stables.length,
  note: observations.length
    ? output.stables.length
      ? "対照比較と時系列検証を通過した候補だけをstablesへ出力しました。masterは未変更です。"
      : "最低サンプル・対照比較・時系列検証をすべて通過した候補はありません。masterは未変更です。"
    : "着順付き調教アーカイブがないため、承認候補は生成されていません。",
}, null, 2));
