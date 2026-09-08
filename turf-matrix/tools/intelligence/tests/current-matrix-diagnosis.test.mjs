import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { diagnoseCurrentMatrix } from "../../analyze/diagnose-current-matrix.mjs";

const readWeek = () => JSON.parse(readFileSync(new URL("../../week-data.json", import.meta.url), "utf8"));

test("current diagnosis replays every published index without modifying inputs", () => {
  const week = readWeek();
  const before = JSON.stringify(week);
  const report = diagnoseCurrentMatrix(week);
  assert.deepEqual(report.errors, []);
  assert.equal(report.summary.replayed, week.races.reduce((sum, race) => sum + race.horses.length, 0));
  assert.equal(report.summary.publicStrengthErrors, 0);
  assert.equal(JSON.stringify(week), before);
});

test("diagnosis reports incomplete training separately from numeric factor scores", () => {
  const week = readWeek();
  const expected = week.races.flatMap((race) => race.horses)
    .filter((horse) => horse.analysis.factorsDetail.training.status === "missing").length;
  const report = diagnoseCurrentMatrix(week);
  assert.equal(report.summary.trainingMissing, expected);
  assert.ok(report.rows.filter((row) => row.factors.training.status === "missing")
    .every((row) => row.trainingExcludedFromIndex));
});

test("diagnosis fails closed on corrupted scores, missing replay inputs, or empty datasets", () => {
  const week = readWeek();
  week.races[0].horses[0].tmIndex += 1;
  assert.ok(diagnoseCurrentMatrix(week).errors.some((error) => /does not replay/.test(error)));
  delete week.races[0].horses[0].analysis.indexContributions;
  assert.ok(diagnoseCurrentMatrix(week).errors.some((error) => /Missing contributions/.test(error)));
  assert.deepEqual(diagnoseCurrentMatrix({ races: [] }).errors, ["No horses available for diagnosis"]);
});
