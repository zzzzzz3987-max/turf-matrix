import { readFileSync, writeFileSync } from "node:fs";
import { buildTrainingAnalysis } from "../intelligence/training-ai.mjs";

const before = JSON.parse(readFileSync("tools/week-data.before-context-20260919.json", "utf8"));
const after = JSON.parse(readFileSync("tools/week-data.batch-candidate.json", "utf8"));
if (before.meta.date !== after.meta.date || !after.meta.contextPreview) throw new Error("Preview date/policy mismatch");
const rows = after.races.flatMap((race) => race.horses.map((horse) => {
  const old = before.races.find((r) => r.id === race.id)?.horses.find((h) => h.name === horse.name);
  if (!old) throw new Error(`Missing baseline: ${horse.name}`);
  const training = buildTrainingAnalysis(horse);
  const laps = horse.analysis.pace?.historicalFlow?.runs ?? [];
  return { race: race.name, horse: horse.name, before: old.tmIndex, after: horse.tmIndex,
    intervalDays: training.raceIntervalDays, trainingIndexEligible: training.indexEligible,
    trainingSummary: training.summary,
    lapEvidence: laps.map((r) => ({ date: r.date, pace: r.paceLabel, reason: r.reason, lap: r.lapEvidence })) };
}));
const report = { date: after.meta.date, previewOnly: true, horseCount: rows.length,
  changed: rows.filter((r) => r.before !== r.after).length,
  policy: { opponentPriorStarts: 3, shortTurnaroundMaxDays: 9, historicRecordBonus: 0,
    note: "Race sectionals are not individual sectionals. No all-time record or champion-equivalence is inferred." }, rows };
writeFileSync("tools/context-preview-report.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ horseCount: report.horseCount, changed: report.changed, shortTurnaround: rows.filter((r) => !r.trainingIndexEligible).map((r) => r.horse) }));
