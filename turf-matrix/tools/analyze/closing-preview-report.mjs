import { readFileSync, writeFileSync } from "node:fs";
import { selectAbilityRuns } from "../intelligence/ability-ai.mjs";

const [beforePath, afterPath, outputPath] = process.argv.slice(2);
if (!beforePath || !afterPath || !outputPath) throw new Error("Usage: closing-preview-report.mjs before.json after.json output.json");
const before = JSON.parse(readFileSync(beforePath, "utf8"));
const after = JSON.parse(readFileSync(afterPath, "utf8"));
if (before.meta.date !== after.meta.date) throw new Error("Baseline date mismatch");
const rows = after.races.flatMap((race) => race.horses.map((horse) => {
  const old = before.races.find((r) => r.id === race.id)?.horses.find((h) => h.name === horse.name);
  if (!old) throw new Error(`Missing baseline: ${horse.name}`);
  const runs = selectAbilityRuns(horse);
  return { race: race.name, horse: horse.name, before: old.tmIndex, after: horse.tmIndex,
    abilityBefore: old.analysis.factors.ability, abilityAfter: horse.analysis.factors.ability,
    comparedRuns: runs.filter((r) => r.closingBenchmark?.status === "available").map((r) => ({
      date: r.date, last3F: r.last3F, ...r.closingBenchmark,
    })),
    maxComparisonRaces: Math.max(0, ...runs.map((r) => r.closingBenchmark?.raceCount ?? 0)),
  };
}));
const report = { date: after.meta.date, previewOnly: true, reference: after.meta.closingReference,
  horseCount: rows.length, comparedHorses: rows.filter((r) => r.comparedRuns.length).length,
  abilityChanged: rows.filter((r) => r.abilityBefore !== r.abilityAfter).length,
  indexChanged: rows.filter((r) => r.before !== r.after).length, rows };
writeFileSync(outputPath, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ ...report, rows: rows.filter((r) => r.comparedRuns.length) }, null, 2));
