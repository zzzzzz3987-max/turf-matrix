import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { traceIndex } from "./audit-index-contributions.mjs";
import { scoreRecentForm } from "../intelligence/form-ai.mjs";
import { scoreCourse } from "../intelligence/course-ai.mjs";
import { validateOddsJoinIntegrity, validateValueDisplayIntegrity } from "../intelligence/output-contract.mjs";
import { buildHorsePublicView, isPublicFactorEvaluated } from "../../src/lib/public-view-model.js";

const finite = Number.isFinite;
const normalizeSurface = (value) => String(value ?? "").startsWith("ダ") ? "ダ" : value;
const factorKeys = ["ability", "form", "distance", "course", "training", "blood", "pace", "trackBias", "stable"];

export const diagnoseCurrentMatrix = (week) => {
  const rows = [];
  const errors = [...validateOddsJoinIntegrity(week), ...validateValueDisplayIntegrity(week)];
  for (const race of week?.races ?? []) {
    for (const horse of race.horses ?? []) {
      const details = horse.analysis?.factorsDetail ?? {};
      const row = {
        race: race.bundleId ?? race.id,
        number: horse.number,
        name: horse.name,
        factors: Object.fromEntries(factorKeys.map((key) => [key, {
          status: details[key]?.status ?? "absent",
          score: details[key]?.score ?? null,
          publiclyEvaluated: isPublicFactorEvaluated(details[key]),
        }])),
        indexReplay: null,
        candidateDifferences: {},
      };
      try {
        const trace = traceIndex(horse, race.raceContext ?? race);
        row.indexReplay = { rawMatches: trace.rawMatches, finalMatches: trace.finalMatches };
        if (!trace.rawMatches || !trace.finalMatches) errors.push(`${row.race}/${horse.name}: saved index does not replay`);
      } catch (error) {
        errors.push(`${row.race}/${horse.name}: ${error.message}`);
      }
      const scores = Object.fromEntries((horse.analysis?.indexContributions ?? []).map((item) => [item.key, item.score]));
      // These are counterfactual factor differences, not evidence of improved outcomes.
      if (finite(scores.form) && scoreRecentForm(horse) === scores.form) {
        row.candidateDifferences.formWeightedAverage = scoreRecentForm(horse, { normalizeWeights: true }) - scores.form;
      }
      if (finite(scores.course) && scoreCourse(horse) === scores.course) {
        row.candidateDifferences.courseSameSurface = scoreCourse(horse, { sameSurfaceOnly: true }) - scores.course;
      }
      const current = horse.currentRace ?? {};
      row.otherSurfaceSameCourseRuns = (horse.pastRuns ?? []).filter((run) =>
        current.course && run.course === current.course && run.surface && current.surface &&
        normalizeSurface(run.surface) !== normalizeSurface(current.surface)).length;
      row.unassessedNumericFactors = factorKeys.filter((key) => finite(details[key]?.score) && !isPublicFactorEvaluated(details[key]));
      const publicView = buildHorsePublicView(horse);
      row.unassessedFactorsExposedAsStrengths = publicView.strengths
        .filter((factor) => !isPublicFactorEvaluated(details[factor.key])).map((factor) => factor.key);
      if (row.unassessedFactorsExposedAsStrengths.length) errors.push(`${row.race}/${horse.name}: unassessed factor presented as strength`);
      row.trainingExcludedFromIndex = !Object.hasOwn(scores, "training");
      if (details.training?.status === "missing" && !row.trainingExcludedFromIndex) {
        errors.push(`${row.race}/${horse.name}: missing training included in index`);
      }
      rows.push(row);
    }
  }
  if (!rows.length) errors.push("No horses available for diagnosis");
  return {
    schemaVersion: 1,
    raceDate: week?.meta?.date ?? null,
    scope: "Local saved data and current code, not proof of live deployment or predictive accuracy.",
    summary: {
      races: week?.races?.length ?? 0,
      horses: rows.length,
      replayed: rows.filter((row) => row.indexReplay?.rawMatches && row.indexReplay?.finalMatches).length,
      trainingMissing: rows.filter((row) => row.factors.training.status === "missing").length,
      trainingPartial: rows.filter((row) => row.factors.training.status === "partial").length,
      trackBiasMonitoring: rows.filter((row) => row.factors.trackBias.status === "monitor").length,
      otherSurfaceSameCourseHorses: rows.filter((row) => row.otherSurfaceSameCourseRuns > 0).length,
      formCandidateChanges: rows.filter((row) => finite(row.candidateDifferences.formWeightedAverage) && row.candidateDifferences.formWeightedAverage !== 0).length,
      courseCandidateChanges: rows.filter((row) => finite(row.candidateDifferences.courseSameSurface) && row.candidateDifferences.courseSameSurface !== 0).length,
      unassessedNumericFactors: rows.reduce((sum, row) => sum + row.unassessedNumericFactors.length, 0),
      publicStrengthErrors: rows.reduce((sum, row) => sum + row.unassessedFactorsExposedAsStrengths.length, 0),
      errors: errors.length,
    },
    errors,
    rows,
  };
};

const main = () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const input = resolve(root, process.argv[2] ?? "tools/week-data.json");
  const output = resolve(root, process.argv[3] ?? "docs/analysis/current-matrix-diagnosis.json");
  if (input === output) throw new Error("Diagnosis output must not overwrite its input");
  const source = readFileSync(input, "utf8");
  const report = diagnoseCurrentMatrix(JSON.parse(source.replace(/^\uFEFF/, "")));
  report.inputSha256 = createHash("sha256").update(source).digest("hex");
  writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report.summary, null, 2));
  if (report.errors.length) process.exitCode = 1;
};

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
