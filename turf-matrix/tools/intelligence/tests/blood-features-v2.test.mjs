import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBloodEvidenceV2,
  confidenceFromSample,
  detectPedigreeCrosses,
  pedigreeFeatureEntries,
} from "../blood-features.mjs";
import {
  buildBloodProfile,
  buildIndividualProfileFit,
  buildPedigreeAnalysis,
  nearestAncestorProfile,
  scoreBlood,
} from "../blood-ai.mjs";
import { buildRaceContext } from "../race-context.mjs";
import {
  FOREIGN_SIRE_PROFILE_CANDIDATES,
  SIRE_PROFILES,
  findSireProfile,
} from "../dictionaries/sire-profile-dictionary.mjs";

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
  assert.equal(v2.summary.includes("未登録"), false);
  assert.equal(v2.summary.includes("未取得"), false);
  assert.equal(v2.summary.includes("クロスは未確定"), false);
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

test("Blood v2 scoring remains deterministic after individual profile integration", () => {
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

test("individual pedigree profiles are unique, aliased, and have complete trait vectors", () => {
  const ids = SIRE_PROFILES.map((profile) => profile.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(SIRE_PROFILES.every((profile) =>
    profile.names.length
    && profile.traits.length
    && profile.scoreApplied === true
    && ["speed", "power", "stamina", "sustain"].every((key) => Number.isFinite(profile.traitVector?.[key]))
  ));
  assert.equal(findSireProfile("Heart's Cry")?.id, "hearts_cry");
  assert.equal(findSireProfile("ロードカナロア")?.id, "lord_kanaloa");
  assert.equal(findSireProfile("Bricks and Mortar")?.id, "bricks_and_mortar");
});

test("sourced foreign profiles are complete and resolve both direct pedigree roles", () => {
  assert.equal(FOREIGN_SIRE_PROFILE_CANDIDATES.length, 7);
  assert.ok(FOREIGN_SIRE_PROFILE_CANDIDATES.every((profile) =>
    profile.sourceRefs?.length
    && profile.sourceRefs.every((source) => source.startsWith("https://"))
  ));
  assert.equal(findSireProfile("シスキン")?.id, "siskin");
  assert.equal(findSireProfile("Practical Joke")?.id, "practical_joke");

  const fit = buildIndividualProfileFit({
    pedigree: { sire: "Nashville", broodmareSire: "War Pass" },
  }, buildRaceContext({ course: "中京", surface: "芝", distance: 1200 }));
  assert.deepEqual(fit.evidence.map((item) => item.profileId), ["nashville", "war_pass"]);
});

test("foreign profiles preserve their documented surface and distance concepts", () => {
  const compatibility = (name, race) => buildIndividualProfileFit(
    { pedigree: { sire: name } },
    buildRaceContext(race)
  ).evidence.find((item) => item.role === "sire")?.compatibility;

  assert.ok(
    compatibility("Siskin", { course: "東京", surface: "芝", distance: 1600 })
      > compatibility("Siskin", { course: "東京", surface: "ダート", distance: 2400 })
  );
  assert.ok(
    compatibility("Mitole", { course: "中京", surface: "ダート", distance: 1200 })
      > compatibility("Mitole", { course: "中京", surface: "芝", distance: 2400 })
  );
  assert.ok(
    compatibility("Mineshaft", { course: "中京", surface: "ダート", distance: 2000 })
      > compatibility("Mineshaft", { course: "中京", surface: "芝", distance: 1200 })
  );
});

test("foreign profile scoring ignores odds, popularity, and finish position", () => {
  const context = buildRaceContext({ course: "中京", surface: "ダート", distance: 1400 });
  const pedigree = { sire: "Jack Christopher", broodmareSire: "Practical Joke" };
  const first = buildIndividualProfileFit({ pedigree, odds: 1.4, popularity: 1, finishPosition: 1 }, context);
  const second = buildIndividualProfileFit({ pedigree, odds: 99.9, popularity: 16, finishPosition: 16 }, context);
  assert.deepEqual(second, first);
});

test("an individual sprint profile fits a sprint context better than a long-distance context", () => {
  const horse = {
    currentRace: { sire: "ビッグアーサー", broodmareSire: "ハーツクライ" },
    pedigree: { sire: "ビッグアーサー", broodmareSire: "ハーツクライ" },
  };
  const sprint = buildIndividualProfileFit(horse, buildRaceContext({ course: "中京", surface: "芝", distance: 1200 }));
  const long = buildIndividualProfileFit(horse, buildRaceContext({ course: "中京", surface: "芝", distance: 3000 }));
  const sprintSire = sprint.evidence.find((item) => item.role === "sire");
  const longSire = long.evidence.find((item) => item.role === "sire");

  assert.ok(sprintSire.compatibility > longSire.compatibility);
  assert.ok(Math.abs(sprint.adjustment) <= 1.5);
  assert.ok(Math.abs(long.adjustment) <= 1.5);
});

test("ancestor profile fallback uses only the nearest registered ancestor with the actual generation weight", () => {
  const horse = {
    currentRace: { raceDate: "2026-08-30", course: "新潟", surface: "芝", distance: 2000 },
    pedigree: {
      sire: "ワールドエース",
      broodmareSire: "未登録母父",
      ancestors: [
        { generation: 2, branch: "sire.sire", name: "ディープインパクト" },
        { generation: 3, branch: "sire.sire.sire", name: "サンデーサイレンス" },
      ],
    },
  };
  const context = buildRaceContext(horse.currentRace);
  const nearest = nearestAncestorProfile(horse, "sire");
  const current = buildIndividualProfileFit(horse, context);
  const candidate = buildIndividualProfileFit(horse, context, { ancestorFallback: true });
  const inherited = candidate.evidence.filter((item) => item.sourceType === "ancestor_profile_fallback");

  assert.equal(nearest.name, "ディープインパクト");
  assert.equal(current.evidence.length, 0);
  assert.equal(inherited.length, 1);
  assert.equal(inherited[0].branch, "sire.sire");
  assert.equal(inherited[0].weight, 0.12);
  assert.ok(Math.abs(inherited[0].impact) <= 1.5 * 0.12);
});

test("a direct profile is never replaced or duplicated by ancestor fallback", () => {
  const horse = {
    currentRace: { raceDate: "2026-08-30", course: "新潟", surface: "芝", distance: 2000 },
    pedigree: {
      sire: "サートゥルナーリア",
      broodmareSire: "ハーツクライ",
      ancestors: [
        { generation: 2, branch: "sire.sire", name: "ロードカナロア" },
        { generation: 3, branch: "dam.sire.sire", name: "サンデーサイレンス" },
      ],
    },
  };
  const context = buildRaceContext(horse.currentRace);
  const current = buildIndividualProfileFit(horse, context);
  const candidate = buildIndividualProfileFit(horse, context, { ancestorFallback: true });

  assert.deepEqual(candidate, current);
  assert.equal(candidate.evidence.some((item) => item.sourceType === "ancestor_profile_fallback"), false);
});

test("production Blood exposes inherited ancestor evidence without market inputs", () => {
  const base = {
    currentRace: { raceDate: "2026-08-30", course: "新潟", surface: "芝", distance: 2000 },
    pedigree: {
      sire: "ワールドエース",
      broodmareSire: "未登録母父",
      ancestors: [
        { generation: 2, branch: "sire.sire", name: "ディープインパクト" },
      ],
    },
  };
  const context = buildRaceContext(base.currentRace);
  const plain = buildBloodProfile(base, context);
  const withMarket = buildBloodProfile({ ...base, odds: 1.2, popularity: 1 }, context);
  const evidence = buildBloodEvidenceV2({ horse: base, context, profile: plain, bloodScore: plain.score });

  assert.equal(withMarket.score, plain.score);
  assert.ok(plain.individualProfileEvidence.some((item) => item.sourceType === "ancestor_profile_fallback"));
  assert.ok(evidence.evidence.some((item) =>
    item.type === "ancestorProfile" && item.label.includes("ディープインパクト") && item.weight === 0.12
  ));
});

test("a curated broodmare-sire profile contributes a bounded disclosed adjustment", () => {
  const horse = {
    currentRace: { raceDate: "2026-08-29", course: "新潟", surface: "芝", distance: 1600 },
    pedigree: {
      sire: "サートゥルナーリア",
      sireSire: "ロードカナロア",
      sireDam: "シーザリオ",
      dam: "検証母",
      broodmareSire: "ハーツクライ",
      damDam: "検証母母",
      ancestors: [],
    },
  };
  const context = buildRaceContext(horse.currentRace);
  const before = scoreBlood(horse, context);
  const analysis = buildPedigreeAnalysis(horse, before, context);
  const after = scoreBlood(horse, context);
  const fit = buildIndividualProfileFit(horse, context);

  assert.equal(after, before);
  assert.ok(Math.abs(fit.adjustment) <= 1.5);
  assert.equal(analysis.broodmareSireProfile.id, "hearts_cry");
  assert.match(analysis.headline, /母父ハーツクライ/);
  assert.match(analysis.headline, /持続力/);
  assert.match(analysis.headline, /個別プロフィール適合/);
  assert.ok(analysis.evidenceV2.some((item) =>
    item.type === "broodmareSireProfile" && item.scoreApplied === true && Number.isFinite(item.impact)
  ));
});

test("an unregistered broodmare sire falls back to its recorded parents without an unmatched label", () => {
  const horse = {
    currentRace: { raceDate: "2026-08-29", course: "新潟", surface: "芝", distance: 1600 },
    pedigree: {
      sire: "サートゥルナーリア",
      sireSire: "ロードカナロア",
      sireDam: "シーザリオ",
      dam: "検証母",
      broodmareSire: "検証母父",
      damDam: "検証母母",
      ancestors: [
        { generation: 2, branch: "dam.sire", name: "検証母父" },
        { generation: 3, branch: "dam.sire.sire", name: "ディープインパクト" },
        { generation: 3, branch: "dam.sire.dam", name: "検証母父母" },
      ],
    },
  };
  const context = buildRaceContext(horse.currentRace);
  const score = scoreBlood(horse, context);
  const analysis = buildPedigreeAnalysis(horse, score, context);

  assert.equal(analysis.broodmareSireProfile.status, "ancestry_fallback");
  assert.match(analysis.broodmareSireProfile.summary, /ディープインパクト × 検証母父母/);
  assert.doesNotMatch(analysis.headline, /未照合/);
  assert.equal(analysis.broodmareSireProfile.scoreApplied, false);
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

test("pairing statistics remain reference-only in Blood evidence", () => {
  const horse = {
    currentRace: { course: "東京", surface: "芝", distance: 1600 },
    pedigree: { sire: "キズナ", broodmareSire: "ハーツクライ" },
  };
  const context = buildRaceContext(horse.currentRace);
  const profile = buildBloodProfile(horse, context);
  const reference = {
    version: "blood-pairing-reference-v1",
    status: "reference_only",
    scoreApplied: false,
    pairing: {
      label: "キズナ × ハーツクライ",
      fallbackLevel: "父×母父",
      status: "active",
      scope: "保有データ全体",
      sampleSize: 20,
      uniqueHorseCount: 10,
      hitRate: 0.45,
      shrunkHitRate: 0.38,
      baselineHitRate: 0.3,
      scoreApplied: false,
      sourceType: "approved_pairing_reference",
      evaluationCutoff: "20260831",
    },
    crosses: [],
  };
  const evidence = buildBloodEvidenceV2({
    horse,
    context,
    profile,
    bloodScore: profile.score,
    pairingReference: reference,
  });
  const pairing = evidence.evidence.find((item) => item.type === "pairing");

  assert.equal(evidence.score, profile.score);
  assert.equal(evidence.pairingReference.scoreApplied, false);
  assert.equal(pairing.sample, 20);
  assert.equal(pairing.impact, 0);
  assert.equal(pairing.scoreApplied, false);
  assert.equal(evidence.unavailable.includes("pairing_statistics"), false);
});
