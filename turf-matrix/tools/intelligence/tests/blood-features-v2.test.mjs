import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBloodEvidenceV2,
  confidenceFromSample,
  detectPedigreeCrosses,
  pedigreeFeatureEntries,
} from "../blood-features.mjs";
import { buildBloodProfile, buildPedigreeAnalysis, scoreBlood } from "../blood-ai.mjs";
import { buildRaceContext } from "../race-context.mjs";

const crossEntries = [
  { name: "Sunday Silence", normalizedName: "sundaysilence", generation: 3, branch: "sire.sire.sire", side: "sire" },
  { name: "Sunday Silence", normalizedName: "sundaysilence", generation: 4, branch: "dam.sire.dam.sire", side: "dam" },
  { name: "Northern Dancer", normalizedName: "northerndancer", generation: 4, branch: "sire.dam.sire.sire", side: "sire" },
  { name: "Northern Dancer", normalizedName: "northerndancer", generation: 5, branch: "dam.dam.sire.dam.sire", side: "dam" },
];

test("Blood v2 detects cross patterns across paternal and maternal branches", () => {
  const crosses = detectPedigreeCrosses(crossEntries);
  assert.deepEqual(crosses.map((cross) => [cross.ancestor, cross.pattern]), [
    ["Sunday Silence", "3x4"],
    ["Northern Dancer", "4x5"],
  ]);
});

test("Blood v2 detects a 4x4 cross", () => {
  const crosses = detectPedigreeCrosses([
    { name: "Mr. Prospector", normalizedName: "mrprospector", generation: 4, branch: "sire.sire.dam.sire", side: "sire" },
    { name: "Mr Prospector", normalizedName: "mrprospector", generation: 4, branch: "dam.sire.sire.dam", side: "dam" },
  ]);

  assert.equal(crosses.length, 1);
  assert.equal(crosses[0].ancestor, "Mr Prospector");
  assert.equal(crosses[0].pattern, "4x4");
});

test("Blood v2 does not call duplicates on one side a cross", () => {
  const crosses = detectPedigreeCrosses([
    { name: "Halo", normalizedName: "halo", generation: 3, branch: "sire.sire.sire", side: "sire" },
    { name: "Halo", normalizedName: "halo", generation: 4, branch: "sire.dam.sire.sire", side: "sire" },
  ]);
  assert.equal(crosses.length, 0);
});

test("Blood v2 confidence follows the documented sample bands", () => {
  assert.equal(confidenceFromSample(100), "A");
  assert.equal(confidenceFromSample(50), "B");
  assert.equal(confidenceFromSample(20), "C");
  assert.equal(confidenceFromSample(10), "D");
  assert.equal(confidenceFromSample(9), "Low");
});

test("Court Alisian-style basic pedigree remains partial and gets horse-specific evidence", () => {
  const horse = {
    horseName: "コートアリシアン",
    currentRace: { raceDate: "2026-08-22", course: "新潟", surface: "芝", distance: 1600 },
    pedigree: {
      sire: "サートゥルナーリア",
      dam: "コートシャルマン",
      broodmareSire: "ハーツクライ",
      damDam: "コートアウト",
      sireSire: "ロードカナロア",
      sireDam: "シーザリオ",
      ancestors: [
        { generation: 1, branch: "sire", name: "サートゥルナーリア" },
        { generation: 1, branch: "dam", name: "コートシャルマン" },
        { generation: 2, branch: "dam.sire", name: "ハーツクライ" },
        { generation: 2, branch: "dam.dam", name: "コートアウト" },
      ],
      source: { completeness: "basic-4-line" },
    },
  };
  const context = buildRaceContext(horse.currentRace);
  const profile = buildBloodProfile(horse, context);
  const v2 = buildBloodEvidenceV2({ horse, context, profile, bloodScore: profile.score });

  assert.equal(v2.identity.pairLabel, "サートゥルナーリア × ハーツクライ");
  assert.equal(v2.completeness.status, "partial");
  assert.equal(v2.crossStatus, "unavailable");
  assert.match(v2.summary, /サートゥルナーリア × ハーツクライ/);
  assert.match(v2.summary, /切れ味/);
  assert.equal(v2.sireProfile.status, "curated");
  assert.deepEqual(v2.sireProfile.ancestry, ["ロードカナロア", "シーザリオ"]);
  assert.match(v2.summary, /新潟芝1600m/);
  assert.match(v2.summary, /取得済みの基本血統/);
  assert.equal(v2.completeness.label, "基本血統取得済み");
  assert.equal(v2.confidenceGrade, "D");
  assert.ok(v2.evidence.some((item) => item.type === "sire"));
  assert.ok(v2.evidence.some((item) => item.type === "broodmareSire"));
});

test("Blood v2 expands an unregistered sire through recorded parents before line fallback", () => {
  const horse = {
    currentRace: { raceDate: "2026-08-22", course: "新潟", surface: "芝", distance: 1600 },
    pedigree: {
      sire: "未登録種牡馬",
      sireSire: "父父テスト",
      sireDam: "父母テスト",
      dam: "テスト母",
      broodmareSire: "テスト母父",
      ancestors: [],
    },
  };
  const context = buildRaceContext(horse.currentRace);
  const profile = buildBloodProfile(horse, context);
  const v2 = buildBloodEvidenceV2({ horse, context, profile, bloodScore: profile.score });

  assert.equal(v2.sireProfile.status, "ancestry_fallback");
  assert.match(v2.sireProfile.summary, /父父テスト × 父母テスト/);
  assert.match(v2.sireProfile.summary, /祖先構成をEvidenceとして保持/);
});

test("Blood v2 turns recorded ancestry rules into a specific sire explanation", () => {
  const horse = {
    currentRace: { raceDate: "2026-08-22", course: "新潟", surface: "芝", distance: 1600 },
    pedigree: {
      sire: "テスト種牡馬",
      sireSire: "ディープインパクト",
      sireDam: "テスト父母",
      dam: "テスト母",
      broodmareSire: "ハーツクライ",
      ancestors: [],
    },
  };
  const context = buildRaceContext(horse.currentRace);
  const profile = buildBloodProfile(horse, context);
  const v2 = buildBloodEvidenceV2({ horse, context, profile, bloodScore: profile.score });

  assert.match(v2.sireProfile.summary, /Deep Impact系/);
  assert.doesNotMatch(v2.sireProfile.summary, /固有プロフィールは未登録/);
  assert.ok(v2.sireProfile.traits.length > 0);
});

test("Blood v2 evidence does not alter the production Blood score", () => {
  const horse = {
    currentRace: { raceDate: "2026-08-22", course: "新潟", surface: "芝", distance: 1600 },
    pedigree: {
      sire: "サートゥルナーリア",
      dam: "コートシャルマン",
      broodmareSire: "ハーツクライ",
      damDam: "コートアウト",
      ancestors: [],
    },
  };
  const context = buildRaceContext(horse.currentRace);
  const before = scoreBlood(horse, context);
  const analysis = buildPedigreeAnalysis(horse, before, context);
  const after = scoreBlood(horse, context);
  assert.equal(after, before);
  assert.equal(analysis.version, "blood-evidence-v2");
  assert.equal(analysis.identity.pairLabel, "サートゥルナーリア × ハーツクライ");
});

test("pedigree feature extraction is deterministic", () => {
  const horse = {
    pedigree: {
      sire: "Kingmambo",
      dam: "Test Dam",
      broodmareSire: "Heart's Cry",
      ancestors: [{ generation: 3, branch: "sire.sire.sire", name: "Northern Dancer" }],
    },
  };
  assert.deepEqual(pedigreeFeatureEntries(horse), pedigreeFeatureEntries(horse));
});
