import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { validateIntelligenceOutput } from "../output-contract.mjs";
import { selectFeaturedRace } from "../race-selector.mjs";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const TOOLS_DIR = join(TEST_DIR, "..", "..");
const readJson = (name) => JSON.parse(readFileSync(join(TOOLS_DIR, name), "utf8"));
const official = readJson("week-data.json");
const candidate = readJson("week-data.candidate.json");

test("production intelligence output satisfies the shared contract", () => {
  const result = validateIntelligenceOutput(official);
  assert.deepEqual(result.errors, []);
  assert.equal(result.valid, true);
});

test("candidate and production data remain byte-for-byte identical", () => {
  const productionBytes = readFileSync(join(TOOLS_DIR, "week-data.json"));
  const candidateBytes = readFileSync(join(TOOLS_DIR, "week-data.candidate.json"));
  assert.equal(candidateBytes.equals(productionBytes), true);
});

test("featured race selector honors the production featuredRaceId", () => {
  const selected = selectFeaturedRace(official);
  assert.ok(selected);
  assert.equal(selected.id, official.meta.featuredRaceId);
});

test("all runners have bounded scores and a deterministic top signal", () => {
  const race = selectFeaturedRace(official);
  const evaluated = race.horses.filter((horse) => Number.isFinite(horse.tmIndex));
  const top = [...evaluated].sort((left, right) => right.tmIndex - left.tmIndex || left.number - right.number)[0];
  const candidateRace = selectFeaturedRace(candidate);
  const candidateTop = [...candidateRace.horses].sort(
    (left, right) => right.tmIndex - left.tmIndex || left.number - right.number
  )[0];

  assert.equal(evaluated.length, race.fieldSize);
  assert.ok(evaluated.every((horse) => horse.tmIndex >= 0 && horse.tmIndex <= 100));
  assert.equal(top.id, candidateTop.id);
  assert.equal(top.tmIndex, candidateTop.tmIndex);
});

test("partial training data stays isolated to the affected runner", () => {
  const race = selectFeaturedRace(official);
  const partial = race.horses.filter((horse) => horse.dataStatus?.training !== "active");
  const expected = (official.join?.failures ?? [])
    .filter((failure) => failure.missing?.includes("training"))
    .map((failure) => failure.horseName)
    .sort((left, right) => left.localeCompare(right, "ja"));
  const actual = partial.map((horse) => horse.name).sort((left, right) => left.localeCompare(right, "ja"));

  assert.deepEqual(actual, expected);
  assert.ok(partial.every((horse) => horse.pastRuns.length > 0));
  assert.ok(partial.every((horse) => horse.pedigree));
  assert.ok(partial.every((horse) => Number.isFinite(horse.tmIndex)));
});
