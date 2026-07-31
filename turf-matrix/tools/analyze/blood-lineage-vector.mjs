import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildBloodProfile } from "../intelligence/blood-ai.mjs";
import { BLOODLINE_RULES } from "../intelligence/dictionaries/bloodline-dictionary.mjs";
import { FEMALE_LINE_RULES } from "../intelligence/dictionaries/female-line-dictionary.mjs";
import { buildRaceContext } from "../intelligence/race-context.mjs";
import { signedVectorAlignment } from "./blood-vector-alignment.mjs";

const INPUT_PATH = resolve("tools/jvlink/output/current-graded-blood-review.json");
const OUTPUT_PATH = resolve("docs/analysis/blood-lineage-vector-2026-08-02.md");
const NEUTRAL_SCORE = 65;
const SCORE_AMPLITUDE = 12;

const mean = (values) => values.length
  ? values.reduce((sum, value) => sum + value, 0) / values.length
  : 0;

const standardDeviation = (values) => {
  const average = mean(values);
  return values.length
    ? Math.sqrt(mean(values.map((value) => (value - average) ** 2)))
    : 0;
};

const correlation = (xs, ys) => {
  if (!xs.length || xs.length !== ys.length) return 0;
  const mx = mean(xs);
  const my = mean(ys);
  const numerator = xs.reduce((sum, x, index) => sum + (x - mx) * (ys[index] - my), 0);
  const denominator = Math.sqrt(
    xs.reduce((sum, x) => sum + (x - mx) ** 2, 0)
      * ys.reduce((sum, y) => sum + (y - my) ** 2, 0),
  );
  return denominator ? numerator / denominator : 0;
};

const normalize = (value) => String(value ?? "").normalize("NFKC").toLowerCase().replace(/\s+/g, "");
const fixed = (value, digits = 3) => Number.isFinite(value) ? value.toFixed(digits) : "--";

const ruleMap = new Map(
  [...BLOODLINE_RULES, ...FEMALE_LINE_RULES].map((rule) => [rule.id, rule]),
);

const chooseSpecificAncestorMatches = (matches) => {
  const byAncestor = new Map();
  for (const match of matches) {
    for (const entry of match.hitEntries ?? []) {
      if (!(entry.scoreWeight > 0)) continue;
      const key = `${entry.branch}:${normalize(entry.name)}`;
      const candidate = { match, entry };
      const current = byAncestor.get(key);
      if (!current
        || Number(candidate.match.depth ?? 1) > Number(current.match.depth ?? 1)
        || (Number(candidate.match.depth ?? 1) === Number(current.match.depth ?? 1)
          && candidate.match.id.localeCompare(current.match.id) < 0)) {
        byAncestor.set(key, candidate);
      }
    }
  }
  return [...byAncestor.values()];
};

export const lineageVectorScore = ({ matches, raceTraits }) => {
  const candidates = chooseSpecificAncestorMatches(matches).map(({ match, entry }) => ({
    branch: entry.branch,
    ancestor: entry.name,
    ruleId: match.id,
    weight: Number(entry.scoreWeight),
    alignment: signedVectorAlignment(ruleMap.get(match.id)?.traits, raceTraits),
  }));
  const totalWeight = candidates.reduce((sum, candidate) => sum + candidate.weight, 0);
  const alignment = totalWeight
    ? candidates.reduce((sum, candidate) => sum + candidate.alignment * candidate.weight, 0) / totalWeight
    : 0;
  return {
    alignment,
    score: NEUTRAL_SCORE + SCORE_AMPLITUDE * alignment,
    evidence: candidates,
  };
};

export const analyzeLineageVectors = (payload) => {
  const rows = payload.races.flatMap((race) => {
    const context = buildRaceContext(race);
    return race.horses.map((horse) => {
      const input = {
        horseName: horse.horseName,
        currentRace: race,
        pedigree: horse.pedigree,
      };
      const profile = buildBloodProfile(input, context);
      const vector = lineageVectorScore({
        matches: [...profile.rawMatches, ...profile.rawFemaleMatches],
        raceTraits: context.traits,
      });
      const statisticsAdjustment = Number(profile.statisticsAdjustment ?? 0);
      return {
        race: `${race.course}${race.raceNo}R ${race.raceName}`,
        horseName: horse.horseName,
        coverage: profile.coverage,
        currentScore: profile.score,
        vectorScore: vector.score,
        statisticsScore: vector.score + statisticsAdjustment,
        statisticsAdjustment,
        statisticsEvidence: profile.statistics,
        alignment: vector.alignment,
        evidence: vector.evidence,
      };
    });
  });
  const scores = rows.map((row) => row.vectorScore);
  const statisticsScores = rows.map((row) => row.statisticsScore);
  const summary = {
    horseCount: rows.length,
    coverageScoreCorrelation: correlation(rows.map((row) => row.coverage), scores),
    scoreMean: mean(scores),
    scoreSd: standardDeviation(scores),
    scoreMin: Math.min(...scores),
    scoreMax: Math.max(...scores),
    scoreRange: Math.max(...scores) - Math.min(...scores),
    statisticsCoverage: rows.filter((row) => row.statisticsEvidence.length > 0).length / rows.length,
    statisticsScoreSd: standardDeviation(statisticsScores),
    statisticsScoreMin: Math.min(...statisticsScores),
    statisticsScoreMax: Math.max(...statisticsScores),
    statisticsScoreRange: Math.max(...statisticsScores) - Math.min(...statisticsScores),
    statisticsCoverageScoreCorrelation: correlation(
      rows.map((row) => row.coverage),
      statisticsScores,
    ),
    averageEvidenceBranches: mean(rows.map((row) => row.evidence.length)),
  };
  return { rows, summary };
};

const render = ({ rows, summary }) => [
  "# Blood AI lineage-preserving vector what-if",
  "",
  "> Review only. This report does not change production Blood AI, TM INDEX, or week-data.json.",
  "",
  "## Summary",
  "",
  `- Horses: ${summary.horseCount}`,
  `- Coverage-score correlation: ${fixed(summary.coverageScoreCorrelation)}`,
  `- Mean / SD: ${fixed(summary.scoreMean)} / ${fixed(summary.scoreSd)}`,
  `- Min / max / range: ${fixed(summary.scoreMin)} / ${fixed(summary.scoreMax)} / ${fixed(summary.scoreRange)}`,
  `- Average scored lineage branches: ${fixed(summary.averageEvidenceBranches)}`,
  `- Qualified-statistics coverage: ${fixed(summary.statisticsCoverage)}`,
  `- Vector + qualified statistics SD / range: ${fixed(summary.statisticsScoreSd)} / ${fixed(summary.statisticsScoreRange)}`,
  `- Vector + qualified statistics coverage correlation: ${fixed(summary.statisticsCoverageScoreCorrelation)}`,
  "",
  "## Horses",
  "",
  "| Race | Horse | Coverage | Current | Vector | Stat adj | Vector+stat | Alignment | Evidence |",
  "|---|---|---:|---:|---:|---:|---:|---:|---|",
  ...rows.map((row) => `| ${row.race} | ${row.horseName} | ${fixed(row.coverage)} | ${fixed(row.currentScore)} | ${fixed(row.vectorScore)} | ${fixed(row.statisticsAdjustment)} | ${fixed(row.statisticsScore)} | ${fixed(row.alignment)} | ${row.evidence.map((item) => `${item.branch}:${item.ruleId}`).join(", ") || "none"} |`),
  "",
].join("\n");

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  const payload = JSON.parse(readFileSync(INPUT_PATH, "utf8").replace(/^\uFEFF/, ""));
  const result = analyzeLineageVectors(payload);
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, `${render(result)}\n`, "utf8");
  console.log(JSON.stringify({ output: OUTPUT_PATH, ...result.summary }, null, 2));
}
