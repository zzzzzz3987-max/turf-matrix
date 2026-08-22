import assert from "node:assert/strict";
import test from "node:test";

import { buildRaceContext } from "../race-context.mjs";
import { buildBloodProfile, resolveRuleMatches } from "../blood-ai.mjs";
import { findCourseSireEvidence } from "../dictionaries/course-sire-evidence.mjs";

test("Ibis course context uses the reusable Niigata straight 1000m profile", () => {
  const context = buildRaceContext({ course: "新潟", surface: "芝", distance: 1000 });
  assert.equal(context.profile, "新潟芝1000m直線");
  assert.equal(context.traits.speed, 1);
  assert.equal(context.styleBias.includes("先行"), true);
  assert.equal(context.bloodBiasIds.includes("mr_prospector"), true);
});

test("Queen Stakes course context uses the reusable Sapporo turf 1800m profile", () => {
  const context = buildRaceContext({ course: "札幌", surface: "芝", distance: 1800 });
  assert.equal(context.profile, "札幌芝1800m");
  assert.equal(context.traits.power, 0.92);
  assert.equal(context.bloodFitTags.includes("洋芝"), true);
  assert.equal(context.bloodBiasIds.includes("harbinger"), true);
});

test("course sire evidence exposes observed records without converting them into a score", () => {
  const evidence = findCourseSireEvidence({ course: "新潟", surface: "芝", distance: 1000, sire: "ビッグアーサー" });
  assert.equal(evidence.starts, 34);
  assert.equal(evidence.wins, 5);
  assert.equal(evidence.hitRate, 0.294);
  assert.equal(evidence.status, "reference-only");
  assert.equal("score" in evidence, false);
});

test("course sire evidence stays missing when the source table has no matching sire", () => {
  const evidence = findCourseSireEvidence({ course: "札幌", surface: "芝", distance: 1800, sire: "未登録種牡馬" });
  assert.equal(evidence, null);
});

for (const pedigree of [
  { sire: "ニューイヤーズデイ", sireSire: "Street Cry" },
  { sire: "タワーオブロンドン", sireSire: "Raven's Pass" },
  { sire: "Charlatan", sireSire: "Speightstown", broodmareSire: "Unbridled's Song" },
]) {
  test(`foreign intermediate ancestors resolve to a reusable root: ${pedigree.sire}`, () => {
    const context = buildRaceContext({ course: "中京", surface: "ダート", distance: 1200 });
    const profile = buildBloodProfile({
      horseName: "外国血統検証馬",
      currentRace: { course: "中京", surface: "ダート", distance: 1200 },
      pedigree,
    }, context);
    assert.equal(profile.rawMatches.some((match) => match.id === "mr_prospector_bridge"), true);
    assert.equal(profile.matches.length, 0);
    assert.equal(profile.coverage > 0, true);
  });
}

test("Hennessy sprint blood is recognized as direct paternal evidence at Niigata 1000m", () => {
  const context = buildRaceContext({ course: "新潟", surface: "芝", distance: 1000 });
  const profile = buildBloodProfile({
    horseName: "検証馬A",
    currentRace: { course: "新潟", surface: "芝", distance: 1000 },
    pedigree: {
      sire: "アジアエクスプレス",
      sireSire: "ヘニーヒューズ",
      dam: "検証母",
      broodmareSire: "ディープインパクト",
      damDam: "検証母母",
      ancestors: [],
    },
  }, context);
  assert.ok(profile.components.paternal > 50);
  assert.ok(profile.courseMatches.some((match) => match.id === "hennessy_sprint"));
});

test("Taiki Shuttle and Cozzene lines are recognized without horse-specific overrides", () => {
  const context = buildRaceContext({ course: "新潟", surface: "芝", distance: 1000 });
  const profile = buildBloodProfile({
    horseName: "検証馬B",
    currentRace: { course: "新潟", surface: "芝", distance: 1000 },
    pedigree: {
      sire: "レッドスパーダ",
      sireSire: "タイキシャトル",
      dam: "検証母",
      broodmareSire: "アドマイヤコジーン",
      damDam: "検証母母",
      ancestors: [],
    },
  }, context);
  assert.ok(profile.components.paternal > 50);
  assert.ok(profile.components.maternal > 50);
  assert.ok(profile.courseMatches.some((match) => match.id === "taiki_shuttle_sprint"));
  assert.ok(profile.courseMatches.some((match) => match.id === "grey_sovereign"));
});

test("new graded-race blood rules recognize reusable sire lines without horse-name overrides", () => {
  const cases = [
    { course: "新潟", distance: 1000, sire: "ビッグアーサー", sireSire: "サクラバクシンオー", expected: "princely_gift_sprint" },
    { course: "新潟", distance: 1000, sire: "Practical Joke", sireSire: "Into Mischief", expected: "harlan_speed" },
    { course: "新潟", distance: 1000, sire: "フォーウィールドライブ", sireSire: "American Pharoah", expected: "american_pharoah_speed" },
    { course: "新潟", distance: 1000, sire: "ナダル", sireSire: "Blame", expected: "blame_arch_power" },
    { course: "札幌", distance: 1800, sire: "サトノクラウン", sireSire: "Marju", expected: "last_tycoon_marju" },
    { course: "札幌", distance: 1800, sire: "キタサンブラック", sireSire: "ブラックタイド", expected: "kitasan_black" },
    { course: "札幌", distance: 1800, sire: "ホークビル", sireSire: "Kitten's Joy", expected: "european_stamina" },
    { course: "札幌", distance: 1800, sire: "スクリーンヒーロー", sireSire: "グラスワンダー", expected: "roberto" },
    { course: "新潟", distance: 1000, sire: "アメリカンペイトリオット", sireSire: "War Front", expected: "danzig" },
    { course: "新潟", distance: 1000, sire: "ロジャーバローズ", sireSire: "ディープインパクト", expected: "deep_impact" },
    { course: "新潟", distance: 1000, sire: "イスラボニータ", sireSire: "フジキセキ", expected: "isla_bonita" },
    { course: "札幌", distance: 1800, sire: "サートゥルナーリア", sireSire: "ロードカナロア", expected: "kingmambo" },
    { course: "札幌", distance: 1800, sire: "Saxon Warrior", sireSire: "ディープインパクト", expected: "deep_impact" },
    { course: "札幌", distance: 1800, sire: "ダイワメジャー", sireSire: "サンデーサイレンス", expected: "daiwa_major", backgroundOnly: true },
    { course: "札幌", distance: 1800, sire: "ネオユニヴァース", sireSire: "サンデーサイレンス", expected: "neo_universe" },
    { course: "札幌", distance: 1800, sire: "マンハッタンカフェ", sireSire: "サンデーサイレンス", expected: "manhattan_cafe", backgroundOnly: true },
    { course: "札幌", distance: 1800, sire: "モーリス", sireSire: "スクリーンヒーロー", expected: "maurice" },
  ];

  for (const item of cases) {
    const context = buildRaceContext({ course: item.course, surface: "芝", distance: item.distance });
    const profile = buildBloodProfile({
      horseName: "辞書検証馬",
      currentRace: { course: item.course, surface: "芝", distance: item.distance },
      pedigree: {
        sire: item.sire,
        sireSire: item.sireSire,
        dam: "検証母",
        broodmareSire: "未登録母父",
        damDam: "検証母母",
        ancestors: [],
      },
    }, context);
    assert.ok(profile.components.paternal > 50, `${item.sire} paternal component`);
    const expectedMatches = item.backgroundOnly ? profile.backgroundMatches : profile.matches;
    assert.ok(expectedMatches.some((match) => match.id === item.expected), `${item.sire} rule match`);
    if (item.backgroundOnly) {
      assert.ok(!profile.matches.some((match) => match.id === item.expected), `${item.sire} remains reference-only`);
    }
  }
});

test("graded-race broodmare sire aliases resolve to established reusable lines", () => {
  const cases = [
    { broodmareSire: "Tale of Ekati", expected: "storm_cat" },
    { broodmareSire: "Canadian Frontier", expected: "mr_prospector" },
    { broodmareSire: "パイロ", expected: "seattle_slew_ap_indy" },
    { broodmareSire: "マヤノトップガン", expected: "roberto" },
    { broodmareSire: "Siyouni", expected: "northern_dancer" },
    { broodmareSire: "Sea The Stars", expected: "sea_the_stars" },
    { broodmareSire: "ロージズインメイ", expected: "roses_in_may" },
    { broodmareSire: "Tizway", expected: "tizway_in_reality", backgroundOnly: true },
  ];

  for (const item of cases) {
    const context = buildRaceContext({ course: "検証", surface: "芝", distance: 1800 });
    const profile = buildBloodProfile({
      horseName: "母父辞書検証馬",
      currentRace: { course: "検証", surface: "芝", distance: 1800 },
      pedigree: {
        sire: "未登録父",
        dam: "検証母",
        broodmareSire: item.broodmareSire,
        damDam: "検証母母",
        ancestors: [],
      },
    }, context);
    assert.ok(profile.components.maternal > 50, `${item.broodmareSire} maternal component`);
    const scoredMatches = [...profile.matches, ...profile.femaleMatches];
    const expectedMatches = item.backgroundOnly ? profile.backgroundMatches : scoredMatches;
    assert.ok(
      expectedMatches.some((match) => match.id === item.expected),
      `${item.broodmareSire} rule match`,
    );
    if (item.backgroundOnly) {
      assert.ok(
        !scoredMatches.some((match) => match.id === item.expected),
        `${item.broodmareSire} remains reference-only`,
      );
    }
  }
});

test("reference-only child rule does not displace its scored parent rule", () => {
  const context = buildRaceContext({ course: "札幌", surface: "芝", distance: 1800 });
  const profile = buildBloodProfile({
    horseName: "参照専用検証馬",
    currentRace: { course: "札幌", surface: "芝", distance: 1800 },
    pedigree: {
      sire: "ダイワメジャー",
      sireSire: "サンデーサイレンス",
      dam: "検証母",
      broodmareSire: "未登録母父",
      damDam: "検証母母",
      ancestors: [],
    },
  }, context);

  assert.ok(profile.matches.some((match) => match.id === "sunday_silence"));
  assert.ok(profile.backgroundMatches.some((match) => match.id === "daiwa_major"));
  assert.ok(!profile.matches.some((match) => match.id === "daiwa_major"));
});

test("a fifth-generation match remains a signal without moving Blood score", () => {
  const context = buildRaceContext({ course: "新潟", surface: "芝", distance: 1000 });
  const neutral = buildBloodProfile({
    currentRace: { course: "新潟", surface: "芝", distance: 1000 },
    pedigree: { sire: "Unknown Sire", dam: "Unknown Dam", broodmareSire: "Unknown BMS", damDam: "Unknown Second Dam", ancestors: [] },
  }, context);
  const distant = buildBloodProfile({
    currentRace: { course: "新潟", surface: "芝", distance: 1000 },
    pedigree: {
      sire: "Unknown Sire",
      dam: "Unknown Dam",
      broodmareSire: "Unknown BMS",
      damDam: "Unknown Second Dam",
      ancestors: [{ generation: 5, branch: "sire.sire.sire.sire.sire", name: "Kingmambo" }],
    },
  }, context);
  assert.ok(distant.backgroundMatches.some((match) => match.id === "kingmambo"));
  assert.ok(distant.backgroundMatches.some((match) => match.reason === "distant-signal-only"));
  assert.ok(Math.abs(distant.score - neutral.score) <= 1);
});

test("a direct sire match moves score without a missing-data step change", () => {
  const context = buildRaceContext({ course: "新潟", surface: "芝", distance: 1000 });
  const baseHorse = {
    currentRace: { course: "新潟", surface: "芝", distance: 1000 },
    pedigree: { sire: "Unknown Sire", dam: "Unknown Dam", broodmareSire: "Unknown BMS", damDam: "Unknown Second Dam", ancestors: [] },
  };
  const neutral = buildBloodProfile(baseHorse, context);
  const matched = buildBloodProfile({ ...baseHorse, pedigree: { ...baseHorse.pedigree, sire: "Princely Gift" } }, context);
  assert.ok(matched.score > neutral.score);
  assert.ok(matched.score - neutral.score <= 3);
  assert.ok(matched.coverage > neutral.coverage);
});

test("unmatched pedigree stays neutral while coverage and confidence decline", () => {
  const context = buildRaceContext({ course: "札幌", surface: "芝", distance: 1800 });
  const profile = buildBloodProfile({
    currentRace: { course: "札幌", surface: "芝", distance: 1800 },
    pedigree: { sire: "Unknown Sire", dam: "Unknown Dam", broodmareSire: "Unknown BMS", damDam: "Unknown Second Dam", ancestors: [] },
  }, context);
  assert.equal(profile.score, 65);
  assert.equal(profile.coverage, 0);
  assert.equal(profile.confidence, "low");
});

test("same paternal branch adopts only one rule and keeps the others as background", () => {
  const context = buildRaceContext({ course: "新潟", surface: "芝", distance: 1000 });
  const profile = buildBloodProfile({
    currentRace: { course: "新潟", surface: "芝", distance: 1000 },
    pedigree: {
      sire: "Practical Joke",
      sireSire: "Into Mischief",
      dam: "Unknown Dam",
      broodmareSire: "Unknown BMS",
      damDam: "Unknown Second Dam",
      ancestors: [
        { generation: 3, branch: "sire.sire.sire", name: "Storm Cat" },
        { generation: 4, branch: "sire.sire.sire.sire", name: "Northern Dancer" },
      ],
    },
  }, context);
  const adoptedPaternal = profile.matches.filter((match) => match.hitEntries[0].branch.startsWith("sire"));
  assert.equal(adoptedPaternal.length, 1);
  assert.ok(profile.backgroundMatches.some((match) => match.id === "storm_cat"));
  assert.ok(profile.backgroundMatches.some((match) => match.id === "northern_dancer"));
});

test("the deepest rule wins when one ancestor matches parent and child line rules", () => {
  const entry = {
    branch: "sire.sire",
    name: "Shared Ancestor",
    roleLabel: "父父",
    scoreWeight: 0.12,
    coverageWeight: 0.12,
  };
  const common = {
    terms: ["Shared Ancestor"],
    fit: [],
    traits: { speed: 0.7, power: 0.7, stamina: 0.7, sustain: 0.7 },
    hitEntries: [entry],
    hits: [entry.name],
    roles: [entry.roleLabel],
    source: "bloodline",
  };
  const result = resolveRuleMatches([
    { ...common, id: "parent", label: "Parent", depth: 1 },
    { ...common, id: "child", label: "Child", depth: 3 },
  ], { traits: {}, bloodBiasIds: [], bloodMajorTags: [] });
  assert.equal(result.adopted.length, 1);
  assert.equal(result.adopted[0].id, "child");
  assert.ok(result.backgroundMatches.some((match) => match.id === "parent" && match.reason === "less-specific"));
});

test("a single generic fit tag does not create course match", () => {
  const profile = buildBloodProfile({
    currentRace: { course: "検証", surface: "芝", distance: 1800 },
    pedigree: { sire: "Kingmambo", dam: "Unknown Dam", broodmareSire: "Unknown BMS", damDam: "Unknown Second Dam", ancestors: [] },
  }, {
    traits: { speed: 0.7, power: 0.7, stamina: 0.6, sustain: 0.7 },
    bloodBiasIds: [],
    bloodMajorTags: ["パワー"],
  });
  assert.equal(profile.courseMatches.length, 0);
});

test("explicit blood bias id creates full course match", () => {
  const profile = buildBloodProfile({
    currentRace: { course: "検証", surface: "芝", distance: 1800 },
    pedigree: { sire: "Kingmambo", dam: "Unknown Dam", broodmareSire: "Unknown BMS", damDam: "Unknown Second Dam", ancestors: [] },
  }, {
    traits: { speed: 0.7, power: 0.7, stamina: 0.6, sustain: 0.7 },
    bloodBiasIds: ["kingmambo"],
    bloodMajorTags: [],
  });
  assert.equal(profile.courseMatches[0].courseMatchStrength, 1);
});

test("two major tag matches create partial course match", () => {
  const profile = buildBloodProfile({
    currentRace: { course: "検証", surface: "芝", distance: 2000 },
    pedigree: { sire: "Kingmambo", dam: "Unknown Dam", broodmareSire: "Unknown BMS", damDam: "Unknown Second Dam", ancestors: [] },
  }, {
    traits: { speed: 0.7, power: 0.7, stamina: 0.7, sustain: 0.7 },
    bloodBiasIds: [],
    bloodMajorTags: ["中距離", "パワー"],
  });
  assert.equal(profile.courseMatches[0].courseMatchStrength, 0.5);
});

test("A.P. Indy line is not a Niigata straight 1000m course match", () => {
  const context = buildRaceContext({ course: "新潟", surface: "芝", distance: 1000 });
  const profile = buildBloodProfile({
    currentRace: { course: "新潟", surface: "芝", distance: 1000 },
    pedigree: { sire: "A.P. Indy", dam: "Unknown Dam", broodmareSire: "Unknown BMS", damDam: "Unknown Second Dam", ancestors: [] },
  }, context);
  assert.equal(profile.courseMatches.some((match) => match.id === "seattle_slew_ap_indy"), false);
});
