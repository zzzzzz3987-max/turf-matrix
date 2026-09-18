import { readFileSync } from "node:fs";
import { buildLapBenchmark, comparisonKey, MIN_COMPARISON_RACES } from "../intelligence/lap-benchmark.mjs";

const cutoff = process.argv[2];
if (!/^\d{4}-\d{2}-\d{2}$/.test(cutoff ?? "")) throw new Error("Pass evaluation date: YYYY-MM-DD");
const history = JSON.parse(readFileSync(new URL("../../data/master/race-shape-history.json", import.meta.url), "utf8").replace(/^\uFEFF/, ""));
const rows = history.races.map(race => ({ race, result: buildLapBenchmark(race, history, cutoff) }));
const counts = {};
const groups = new Map();
for (const { race, result } of rows) {
  counts[result.status] = (counts[result.status] ?? 0) + 1;
  const key = comparisonKey(race);
  if (!key || result.status === "missing") continue;
  if (!groups.has(key)) groups.set(key, { conditions: JSON.parse(key), comparableRaces: result.sampleSize,
    additionalRacesNeeded: Math.max(0, MIN_COMPARISON_RACES - result.sampleSize) });
}
console.log(JSON.stringify({ evaluationDate: cutoff, minimumComparisonRaces: MIN_COMPARISON_RACES,
  counts, groups: [...groups.values()].sort((a, b) => b.comparableRaces - a.comparableRaces),
  limitations: ["Race-level sectionals, not individual horse sectionals", "Age, class and daily track speed are not adjusted", "No production score adjustment"] }, null, 2));
