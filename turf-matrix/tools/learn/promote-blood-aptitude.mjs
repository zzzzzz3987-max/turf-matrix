import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const args = process.argv.slice(2);
const valueAfter = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const inputPath = resolve(valueAfter("--input", "tools/jvlink/output/bloodlines.learned.json"));
const outputPath = resolve(valueAfter("--output", "data/master/bloodlines.json"));

if (!existsSync(inputPath)) {
  console.error(`[ERROR] 承認候補がありません: ${inputPath}`);
  process.exit(2);
}

const learned = JSON.parse(readFileSync(inputPath, "utf8"));
const entities = {};
let approvedEntityCount = 0;
let approvedStatisticCount = 0;

for (const [entityType, sourceEntities] of Object.entries(learned.entities ?? {})) {
  entities[entityType] = {};
  for (const [name, dimensions] of Object.entries(sourceEntities)) {
    const approvedDimensions = {};
    for (const [dimension, statistics] of Object.entries(dimensions)) {
      const approvedStatistics = Object.fromEntries(
        Object.entries(statistics).filter(([, value]) => value.eligible)
      );
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
  rule: `sampleSize>=${learned.minimumSamples?.active} and uniqueHorseCount>=${learned.minimumSamples?.uniqueHorsesActive}`,
};

if (!args.includes("--confirm")) {
  console.log(JSON.stringify({ ...summary, status: "review-only", note: "--confirm 指定時のみmasterへ反映します。" }, null, 2));
  process.exit(1);
}

const approved = {
  schemaVersion: learned.schemaVersion,
  status: "approved",
  generatedForWeek: learned.generatedForWeek,
  source: learned.source,
  sourceRaceCount: learned.sourceRaceCount,
  sourceHorseCount: learned.sourceHorseCount,
  observationCount: learned.observationCount,
  minimumSamples: learned.minimumSamples,
  baseline: Object.fromEntries(Object.entries(learned.baseline ?? {}).filter(([key]) => key !== "horseContributions")),
  approval: {
    rule: summary.rule,
    note: "集計候補のうち最低サンプル数と異なる産駒数を満たす統計だけを明示承認。",
  },
  entities,
};
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(approved, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ ...summary, status: "approved" }, null, 2));
