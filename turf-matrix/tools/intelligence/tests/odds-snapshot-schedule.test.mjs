import assert from "node:assert/strict";
import test from "node:test";
import { buildFullRaceRuntimeConfig, buildOddsSnapshotSchedule } from "../../odds-snapshot-schedule.mjs";

const race = (track, number, time, date = "2026-09-26") => ({
  id: `${date}-${track}-${String(number).padStart(2, "0")}R`,
  bundleId: `${date}-${track}-${String(number).padStart(2, "0")}R`,
  track,
  number,
  time,
});

test("full-race runtime is built from every same-day signal without narrowing the list", () => {
  const races = Array.from({ length: 12 }, (_, index) => [
    race("中山", index + 1, "09:45"),
    race("阪神", index + 1, "10:00"),
  ]).flat();
  const config = buildFullRaceRuntimeConfig({
    raceDate: "2026-09-26",
    allRaceSignals: { date: "2026-09-26", raceCount: 24, races },
  });

  assert.equal(config.expectedRaceCount, 24);
  assert.equal(config.bundles.length, 24);
  assert.ok(config.bundles.includes("2026-09-26-阪神-12R"));
  assert.equal(config.allowMissingPastRuns, true);
});

test("full-race runtime fails closed for stale or duplicated signals", () => {
  const signals = { date: "2026-09-22", races: [race("中山", 1, "09:45", "2026-09-22")] };
  assert.throws(() => buildFullRaceRuntimeConfig({ raceDate: "2026-09-26", allRaceSignals: signals }), /do not match/);
  assert.throws(() => buildFullRaceRuntimeConfig({
    raceDate: "2026-09-22",
    allRaceSignals: { ...signals, races: [...signals.races, ...signals.races] },
  }), /duplicate/);
});

test("snapshot windows run once seven minutes before the earliest 1R and 6R", () => {
  const schedule = buildOddsSnapshotSchedule({
    raceDate: "2026-09-26",
    races: [race("中山", 1, "09:45"), race("阪神", 1, "10:00"), race("中山", 6, "12:40"), race("阪神", 6, "12:55")],
  });

  assert.deepEqual(schedule.map(({ id, anchorRace, triggerTime }) => ({ id, anchorRace, triggerTime })), [
    { id: "before-1R", anchorRace: "中山1R", triggerTime: "2026-09-26T00:38:00.000Z" },
    { id: "before-6R", anchorRace: "中山6R", triggerTime: "2026-09-26T03:33:00.000Z" },
  ]);
});

test("full-race snapshots retain explicit withdrawn slots without narrowing the schedule", () => {
  const bundle = "2026-09-26-阪神-10R";
  const sourceConfig = { raceDate: "2026-09-26", bundles: [bundle],
    excludedHorseNumbersByBundle: { [bundle]: [6] }, officialWithdrawals: [{ horseNumber: 6 }] };
  const allRaceSignals = { date: "2026-09-26", races: [race("阪神", 1, "09:45"), race("阪神", 10, "15:00")] };
  const config = buildFullRaceRuntimeConfig({ raceDate: "2026-09-26", allRaceSignals, sourceConfig });
  assert.equal(config.bundles.length, 2);
  assert.deepEqual(config.excludedHorseNumbersByBundle, { [bundle]: [6] });
  config.excludedHorseNumbersByBundle[bundle].push(7);
  assert.deepEqual(sourceConfig.excludedHorseNumbersByBundle[bundle], [6]);
});

test("snapshot withdrawal metadata fails closed for stale dates, unknown races or invalid slots", () => {
  const bundle = "2026-09-26-阪神-10R";
  const allRaceSignals = { date: "2026-09-26", races: [race("阪神", 10, "15:00")] };
  for (const sourceConfig of [
    { raceDate: "2026-09-25" },
    { raceDate: "2026-09-26", excludedHorseNumbersByBundle: [] },
    { raceDate: "2026-09-26", excludedHorseNumbersByBundle: { wrong: [6] } },
    ...[[0], [19], [6, 6], [6.5], "6"].map(numbers => ({ raceDate: "2026-09-26", excludedHorseNumbersByBundle: { [bundle]: numbers } })),
  ]) assert.throws(() => buildFullRaceRuntimeConfig({ raceDate: "2026-09-26", allRaceSignals, sourceConfig }), /Withdrawal/);
});
