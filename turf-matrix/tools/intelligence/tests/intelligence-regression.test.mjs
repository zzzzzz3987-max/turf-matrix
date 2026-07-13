import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { validateIntelligenceOutput } from "../output-contract.mjs";
import { selectFeaturedRace } from "../race-selector.mjs";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const TOOLS_DIR = join(TEST_DIR, "..", "..");
const officialText = readFileSync(join(TOOLS_DIR, "week-data.json"), "utf8");
const official = JSON.parse(officialText);

test("production data satisfies the shared output contract", () => {
  const result = validateIntelligenceOutput(official);
  assert.deepEqual(result.errors, []);
  assert.equal(result.valid, true);
});

test("stale 七夕賞 production data has been removed", () => {
  assert.equal(officialText.includes("七夕賞"), false);
  assert.equal(officialText.includes("2026-07-12"), false);
});

test("featured race selection follows the current production payload", () => {
  const selected = selectFeaturedRace(official);
  if (!official.races.length) {
    assert.equal(selected, null);
    assert.equal(official.meta.featuredRaceId, null);
    return;
  }
  assert.ok(selected);
  assert.equal(selected.id, official.meta.featuredRaceId);
});

test("all published intelligence scores stay bounded", () => {
  const horses = official.races.flatMap((race) => race.horses ?? []);
  assert.ok(horses.every((horse) => Number.isFinite(horse.tmIndex)));
  assert.ok(horses.every((horse) => horse.tmIndex >= 0 && horse.tmIndex <= 100));
});

test("empty production state is explicit and contains no fabricated runners", () => {
  if (official.races.length) return;
  assert.equal(official.meta.dataStatus, "missing");
  assert.equal(official.intelligenceLayerConnected, false);
  assert.deepEqual(official.featured, []);
});
