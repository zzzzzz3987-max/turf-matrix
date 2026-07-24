#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TOOLS_DIR = dirname(fileURLToPath(import.meta.url));
const CANDIDATE_PATH = join(TOOLS_DIR, "week-data.batch-candidate.json");
const candidate = JSON.parse(readFileSync(CANDIDATE_PATH, "utf8"));
const errors = [];
let adjustedHorseCount = 0;

for (const race of candidate.races ?? []) {
  const rows = (race.horses ?? []).map((horse) => {
    const detail = horse.analysis?.goingAnalysis ?? {};
    const adjustment = horse.analysis?.goingAdjustment ?? 0;
    if (!Number.isFinite(adjustment) || Math.abs(adjustment) > 2) {
      errors.push(`${race.id}/${horse.name}: invalid going adjustment ${adjustment}`);
    }
    if ((!race.going || ["良", "稍重"].includes(race.going)) && adjustment !== 0) {
      errors.push(`${race.id}/${horse.name}: adjustment must be 0 for going=${race.going ?? "missing"}`);
    }
    if (adjustment !== 0) adjustedHorseCount += 1;
    return {
      number: horse.number,
      horse: horse.name,
      heavyRuns: detail.relevantRunCount ?? 0,
      goodRuns: detail.goodRunCount ?? 0,
      adjustment,
      before: Number.isFinite(horse.tmIndex) ? horse.tmIndex - adjustment : null,
      after: horse.tmIndex,
      status: detail.status ?? "missing",
    };
  });

  const distribution = rows.reduce((summary, row) => {
    const key = row.adjustment >= 0 ? `+${row.adjustment}` : String(row.adjustment);
    summary[key] = (summary[key] ?? 0) + 1;
    return summary;
  }, {});

  console.log(`\n${race.track}${race.number}R ${race.name} / ${race.surface}${race.distance}m / 馬場: ${race.going ?? "未取得"}`);
  console.log(`取得時刻: ${race.goingUpdatedAt ?? "未取得"} / 補正分布: ${JSON.stringify(distribution)}`);
  for (const row of rows.filter((item) => item.adjustment !== 0)) {
    console.log(
      `${String(row.number).padStart(2, " ")} ${row.horse} 重不良${row.heavyRuns}走 良${row.goodRuns}走 ` +
      `${row.adjustment >= 0 ? "+" : ""}${row.adjustment} ${row.before}→${row.after} ${row.status}`,
    );
  }
}

if (errors.length) {
  errors.forEach((error) => console.error(`[FAIL] ${error}`));
  process.exit(1);
}

console.log(`\nGoing adjustment verified: ${candidate.races?.length ?? 0} races / adjusted ${adjustedHorseCount} horses / errors 0.`);
