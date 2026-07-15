import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildAnalysis } from "../index.mjs";
import { calibrateRaceIntelligence } from "../field-calibration.mjs";
import { BLOODLINE_RULES } from "../dictionaries/bloodline-dictionary.mjs";
import { COURSE_BIAS_PROFILES } from "../dictionaries/course-bias-dictionary.mjs";
import { FEMALE_LINE_RULES } from "../dictionaries/female-line-dictionary.mjs";
import { TRAINING_THRESHOLDS } from "../dictionaries/training-thresholds.mjs";
import { validateIntelligenceOutput } from "../output-contract.mjs";
import { selectFeaturedRace } from "../race-selector.mjs";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const TOOLS_DIR = join(TEST_DIR, "..", "..");
const officialText = readFileSync(join(TOOLS_DIR, "week-data.json"), "utf8");
const official = JSON.parse(officialText);
const mojibakePattern = /譛|繧|邉|隱|陦|蠑|荳|縺|逶|髯|蜿|鬥|雎|蟇/;

test("production data satisfies the shared output contract", () => {
  const result = validateIntelligenceOutput(official);
  assert.deepEqual(result.errors, []);
  assert.equal(result.valid, true);
});

test("stale 七夕賞 production data has been removed", () => {
  assert.equal(officialText.includes("七夕賞"), false);
  assert.equal(officialText.includes("2026-07-12"), false);
});

test("published intelligence text contains no mojibake markers", () => {
  assert.equal(mojibakePattern.test(officialText), false);
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

test("Stage 1.5 analysis produces readable evidence for each core module", () => {
  const horse = {
    horseName: "テストホース",
    horseNumber: 3,
    trainer: "テスト厩舎",
    dataStatus: { training: "active" },
    currentRace: {
      course: "福島",
      surface: "芝",
      distance: 2000,
      raceName: "テスト重賞",
      grade: "G3",
      stableSide: "美",
    },
    odds: { zi: 108, winOdds: 8.5, popularity: 5, status: "active" },
    pastRuns: [
      { course: "中山", raceName: "日経賞G2", grade: "G2", surface: "芝", distance: 2500, finishPosition: 3, fieldSize: 15, margin: 0.3, last3F: 34.8, popularity: 6, passingOrder: [4, 4, 3, 3] },
      { course: "福島", raceName: "福島民報杯", surface: "芝", distance: 2000, finishPosition: 1, fieldSize: 16, margin: 0.0, last3F: 35.1, popularity: 3, passingOrder: [3, 3, 2, 1] },
    ],
    training: {
      slope: [{ date: "2026.7.9", "4F": 49.8, "3F": 36.0, "2F": 24.0, "1F": 12.3, lap: { lap4: 13.8, lap3: 12.0, lap2: 11.7, lap1: 12.3 } }],
      wood: [],
    },
    pedigree: {
      sire: "キングカメハメハ",
      dam: "テストマザー",
      broodmareSire: "ロベルト",
      damDam: "テスト牝系",
      ancestors: [{ name: "Kingmambo" }, { name: "Sunday Silence" }],
    },
  };

  const result = buildAnalysis(horse);
  const text = JSON.stringify(result);

  assert.equal(mojibakePattern.test(text), false);
  assert.ok(Number.isFinite(result.tmIndex));
  assert.ok(Number.isFinite(result.tmValue));
  assert.ok(result.analysis.factorsDetail.form.summary.includes("直近"));
  assert.ok(result.analysis.factorsDetail.blood.summary.includes("系"));
  assert.ok(result.analysis.factorsDetail.training.summary.includes("調教時計"));
  assert.ok(result.analysis.factorsDetail.course.summary.includes("福島芝2000m"));
  assert.ok(result.analysis.factorsDetail.pace.summary.includes("傾向"));
  assert.ok(result.analysis.factorsDetail.value.summary.includes("単勝"));
  assert.ok(result.analysis.indexContributions.length >= 3);
});

test("race calibration adds deterministic relative ranks", () => {
  const race = calibrateRaceIntelligence({
    id: "test-race",
    horses: [
      { id: "a", number: 1, name: "A", tmIndex: 78, analysis: { verdict: { evidence: [] }, topSignal: {} } },
      { id: "b", number: 2, name: "B", tmIndex: 84, analysis: { verdict: { evidence: [] }, topSignal: {} } },
      { id: "c", number: 3, name: "C", tmIndex: 71, analysis: { verdict: { evidence: [] }, topSignal: {} } },
    ],
  });

  const byName = Object.fromEntries(race.horses.map((horse) => [horse.name, horse]));
  assert.equal(byName.B.analysis.relative.rank, 1);
  assert.equal(byName.A.analysis.relative.rank, 2);
  assert.equal(byName.C.analysis.relative.rank, 3);
  assert.equal(byName.B.analysis.topSignal.label, "Top Signal");
  assert.ok(byName.A.analysis.verdict.evidence.some((item) => item.includes("レース内順位")));
});

test("knowledge dictionaries are populated and readable", () => {
  const dictionaryText = JSON.stringify({ BLOODLINE_RULES, COURSE_BIAS_PROFILES, FEMALE_LINE_RULES, TRAINING_THRESHOLDS });
  assert.equal(mojibakePattern.test(dictionaryText), false);
  assert.ok(BLOODLINE_RULES.length >= 5);
  assert.ok(FEMALE_LINE_RULES.length >= 4);
  assert.ok(COURSE_BIAS_PROFILES.some((profile) => profile.key === "fukushima_turf_2000"));
  assert.ok(COURSE_BIAS_PROFILES.some((profile) => profile.key === "kokura_turf_2000"));
  assert.ok(COURSE_BIAS_PROFILES.some((profile) => profile.key === "niigata_turf_2000_outer"));
  assert.ok(COURSE_BIAS_PROFILES.every((profile) => profile.sourceRefs?.length));
  assert.ok(COURSE_BIAS_PROFILES.every((profile) => profile.styleBias?.length));
  assert.ok(COURSE_BIAS_PROFILES.every((profile) => profile.bloodBias?.length));
  assert.ok(COURSE_BIAS_PROFILES.every((profile) => profile.bloodFitTags?.length));
  assert.ok(COURSE_BIAS_PROFILES.every((profile) => profile.bloodBiasIds?.every((id) => BLOODLINE_RULES.some((rule) => rule.id === id))));
  assert.ok(TRAINING_THRESHOLDS.slope.miho["1F"] > 0);
  assert.ok(TRAINING_THRESHOLDS.slope.ritto["1F"] > 0);
});
