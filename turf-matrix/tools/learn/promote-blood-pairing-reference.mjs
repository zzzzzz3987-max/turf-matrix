import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const args = process.argv.slice(2);
const valueAfter = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const inputPath = resolve(valueAfter("--input", "tools/jvlink/output/bloodlines.learned.json"));
const outputPath = resolve(valueAfter("--output", "data/master/blood-pairing-reference.json"));
const entityTypes = [
  "sireBroodmareSire",
  "sireBroodmareSireLineId",
  "sireLineIdBroodmareSire",
  "sireLineIdBroodmareSireLineId",
  "cross",
];

if (!existsSync(inputPath)) {
  console.error(`[ERROR] 配合統計候補がありません: ${inputPath}`);
  process.exit(2);
}

const learned = JSON.parse(readFileSync(inputPath, "utf8"));
const minimumReferenceSamples = learned.minimumSamples?.reference ?? 5;
const minimumReferenceHorses = 2;
const entities = {};
let approvedEntityCount = 0;
let approvedStatisticCount = 0;

for (const entityType of entityTypes) {
  entities[entityType] = {};
  for (const [name, dimensions] of Object.entries(learned.entities?.[entityType] ?? {})) {
    const approvedDimensions = {};
    for (const [dimension, statistics] of Object.entries(dimensions)) {
      const approvedStatistics = Object.fromEntries(Object.entries(statistics).filter(([, value]) =>
        value.sampleSize >= minimumReferenceSamples
        && value.uniqueHorseCount >= minimumReferenceHorses
      ));
      if (Object.keys(approvedStatistics).length) {
        approvedDimensions[dimension] = approvedStatistics;
        approvedStatisticCount += Object.keys(approvedStatistics).length;
      }
    }
    if (Object.keys(approvedDimensions).length) {
      entities[entityType][name] = approvedDimensions;
      approvedEntityCount += 1;
    }
  }
}

const summary = {
  input: inputPath,
  output: outputPath,
  approvedEntityCount,
  approvedStatisticCount,
  rule: `sampleSize>=${minimumReferenceSamples} and uniqueHorseCount>=${minimumReferenceHorses}`,
  scoreApplied: false,
};

if (!args.includes("--confirm")) {
  console.log(JSON.stringify({
    ...summary,
    status: "review-only",
    note: "--confirm指定時のみ、点数非接続の参考統計として保存します。",
  }, null, 2));
  process.exit(1);
}

const approved = {
  schemaVersion: 1,
  status: "approved_reference",
  generatedForWeek: learned.generatedForWeek,
  source: learned.source,
  sourceRaceCount: learned.sourceRaceCount,
  sourceHorseCount: learned.sourceHorseCount,
  observationCount: learned.observationCount,
  evaluationCutoff: learned.evaluationCutoff,
  futureObservationCount: learned.futureObservationCount,
  minimumSamples: learned.minimumSamples,
  lineResolution: learned.lineResolution,
  baseline: Object.fromEntries(
    Object.entries(learned.baseline ?? {}).filter(([key]) => key !== "horseContributions")
  ),
  approval: {
    rule: summary.rule,
    scoreApplied: false,
    note: "配合・クロス統計は分析Evidence専用。Blood ScoreおよびTM INDEXには接続しない。",
  },
  entities,
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(approved, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ ...summary, status: "approved_reference" }, null, 2));
