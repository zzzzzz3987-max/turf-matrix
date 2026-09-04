import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildPedigreeFamilyPublicLines,
  buildPedigreePublicConditionSummary,
  buildPedigreePublicBreakdown,
  buildPedigreePublicOverview,
  buildHorseRiskFlags,
  buildRacePublicConclusion,
  buildStablePatternPublicView,
  buildHorsePublicView,
  publicConditionFit,
  publicScoreBand,
  publicTrainingHeadline,
  sanitizePublicText,
} from "../../../src/lib/public-view-model.js";
import {
  selectPublicValueEvidenceHorse,
  selectPublicValueHorse,
} from "../../../src/lib/public-role-selection.js";

const raceHorse = ({ id, name, number, score, popularity, factors = {}, value }) => ({
  id,
  name,
  number,
  tmIndex: score,
  popularity,
  analysis: {
    factorsDetail: {
      ...Object.fromEntries(Object.entries(factors).map(([key, factorScore]) => [key, { score: factorScore }])),
      value: value ?? { eligible: false, marketGap: 0 },
    },
  },
});

test("public copy removes internal evidence and acquisition wording", () => {
  const source = "取得済み14祖先からDeep Impact系を確認。12走・11頭を参照。Confidence D。今回の芝1600mは標準評価。";
  const result = sanitizePublicText(source);

  assert.equal(result, "今回の芝1600mは標準評価。");
  assert.doesNotMatch(result, /取得|参照|Confidence|Evidence|TARGET/);
});

test("score bands and condition labels share one public scale", () => {
  assert.equal(publicScoreBand(67).label, "標準");
  assert.equal(publicConditionFit(67), "標準");
  assert.equal(publicScoreBand(82).label, "強み");
  assert.equal(publicConditionFit(82), "非常に合う");
});

test("training headline explains a positive final work inside a standard total", () => {
  const result = publicTrainingHeadline({
    grade: "C",
    details: { final: { score: 76 } },
  });

  assert.equal(result, "最終追い切りは良好。調教全体は標準評価です。");
});

test("stable pattern public view explains sample, hit rate, and stable baseline difference", () => {
  const result = buildStablePatternPublicView({
    match: true,
    sampleSize: 18,
    hitRate: 0.444,
    baselineHitRate: 0.302,
    text: "最終ウッド・加速ラップへの合致度100%（収縮後複勝率44.4%、n=18、厩舎基準30.2%）",
  });

  assert.equal(result.headline, "最終ウッド・加速ラップに100%合致");
  assert.deepEqual(result.metrics, [
    { label: "過去例", value: "18件" },
    { label: "3着内率", value: "44.4%" },
    { label: "通常時との差", value: "+14.2pt" },
  ]);
  assert.doesNotMatch(JSON.stringify(result), /収縮|Confidence|Evidence|n=/);
});

test("stable pattern public view reads the currently published stable-factor shape", () => {
  const result = buildStablePatternPublicView({
    status: "照合済",
    degree: 0.75,
    label: "最終坂路・1F12.8以内・加速の好走時パターンへの合致度75%（収縮後複勝率33.3%、n=21、厩舎基準25.0%）",
  });

  assert.equal(result.headline, "最終坂路・1F12.8以内・加速の好走時パターンに75%合致");
  assert.deepEqual(result.metrics, [
    { label: "過去例", value: "21件" },
    { label: "3着内率", value: "33.3%" },
    { label: "通常時との差", value: "+8.3pt" },
  ]);
});

test("pedigree breakdown turns component scores into readable drill-down rows", () => {
  const result = buildPedigreePublicBreakdown({
    identity: { sire: "アルアイン", broodmareSire: "アドマイヤコジーン" },
    sireProfile: {
      summary: "父アルアインは高速馬場と瞬発力が持ち味。",
      ancestry: ["ディープインパクト", "ドバイマジェスティ"],
      traits: ["高速馬場", "瞬発力"],
    },
    broodmareSireProfile: {
      summary: "母父アドマイヤコジーンがスピードを補う。",
      ancestry: ["Cozzene", "アドマイヤマカディ"],
      traits: ["スピード"],
    },
    componentDetails: {
      sireTrait: { score: 67 },
      broodmareSire: { score: 68 },
      distanceFit: { score: 68, label: "1000mへの血統適合" },
      courseFit: { score: 67, label: "新潟への血統適合" },
      goingFit: { score: 71, label: "良馬場への血統適合" },
    },
    statistics: [
      { entityType: "sire", name: "アルアイン", sampleSize: 46, uniqueHorseCount: 18, winRate: 0.1957, hitRate: 0.5652 },
      { entityType: "broodmareSire", name: "アドマイヤコジーン", sampleSize: 44, uniqueHorseCount: 17, winRate: 0.1364, hitRate: 0.3409 },
    ],
    strengths: [
      { roles: ["父"], text: "父系から高速馬場での加速力を評価。", caution: ["消耗戦では持続力の確認が必要。"] },
      { roles: ["母父"], text: "母父から短距離スピードを補完。" },
      { roles: ["父", "母父"], text: "1000mで必要な先行スピードを評価。", fit: ["短距離"] },
    ],
    traits: [
      { label: "スピード", score: 83 },
      { label: "瞬発力", score: 82 },
    ],
    raceBias: {
      summary: "新潟の長い直線で加速力を生かしやすい構成。",
      courseMatched: [{ label: "Deep Impact系", note: "長い直線での加速を評価。" }],
    },
  });

  assert.deepEqual(result.map((row) => row.label), ["父", "母父", "距離", "コース"]);
  assert.equal(result[0].name, "アルアイン");
  assert.deepEqual(result[0].metrics, [
    { label: "対象", value: "46走・18頭" },
    { label: "勝率", value: "19.6%" },
    { label: "複勝率", value: "56.5%" },
  ]);
  assert.deepEqual(result[0].sections.map((section) => section.label), ["父のタイプ", "父側の3代構成", "今回条件で見る点", "産駒成績", "点数の見方", "慎重に見る点"]);
  assert.match(result[0].sections.find((section) => section.label === "父のタイプ")?.text ?? "", /高速馬場と瞬発力/);
  assert.match(result[0].sections.find((section) => section.label === "慎重に見る点")?.text ?? "", /消耗戦/);
  assert.match(result[2].summary, /1000m|スピード83/);
  assert.deepEqual(result[2].metrics, [
    { label: "スピード", value: "83" },
    { label: "瞬発力", value: "82" },
  ]);
  assert.ok(result.every((row) => row.sections.length > 0));
  assert.deepEqual(result[3].points, ["Deep Impact系"]);
});

test("public sire profile and exact three-generation structure replace bare parent-name copy", () => {
  const source = JSON.parse(readFileSync(new URL("../../../tools/week-data.json", import.meta.url), "utf8"));
  const horse = source.races.flatMap((race) => race.horses ?? []).find((runner) => {
    const rows = buildPedigreePublicBreakdown(runner.analysis?.pedigree, runner.pedigree);
    const sire = rows.find((row) => row.key === "sireTrait");
    return sire?.points?.length >= 3
      && sire.metrics?.length === 3
      && sire.sections?.some((section) => section.label === "父のタイプ")
      && sire.sections?.some((section) => section.label === "父側の3代構成");
  });
  assert.ok(horse);

  const rows = buildPedigreePublicBreakdown(horse.analysis.pedigree, horse.pedigree);
  const overview = buildPedigreePublicOverview(horse.analysis.pedigree, horse.analysis.factorsDetail?.blood?.score ?? 68);
  const sire = rows.find((row) => row.key === "sireTrait");
  assert.ok(sire);
  assert.match(overview ?? "", new RegExp(horse.pedigree.sire));
  assert.ok(sire.points.every((point) => overview.includes(point)));
  assert.doesNotMatch(JSON.stringify(sire), /伝える特徴/);
  assert.match(sire.sections.find((section) => section.label === "父のタイプ")?.text ?? "", new RegExp(horse.pedigree.sire));
  assert.match(sire.sections.find((section) => section.label === "父側の3代構成")?.text ?? "", /側.*×.*側/);
  assert.deepEqual(sire.metrics.map((metric) => metric.label), ["対象", "勝率", "複勝率"]);

  const family = buildPedigreeFamilyPublicLines(horse.analysis.pedigree, horse.pedigree);
  assert.deepEqual(family.map((line) => line.role), ["母", "母父", "母母"]);
  assert.match(family[0].note, new RegExp(horse.pedigree.dam));
  assert.match(family[1].note, new RegExp(horse.pedigree.broodmareSire));
  assert.ok(family.every((line) => !/伝える特徴|参照|Confidence/.test(line.note)));
});

test("horse public view keeps three strengths and translates a neutral low point", () => {
  const horse = {
    comment: "直近は重賞で3着。Confidence B。",
    analysis: {
      verdict: { summary: "能力上位。TARGETデータを参照。" },
      factorsDetail: {
        ability: { score: 84, summary: "近5走の相手関係を評価。" },
        course: { score: 80, summary: "今回コースへの適性が高い。" },
        distance: { score: 76, summary: "同距離で安定。" },
        blood: { score: 67, summary: "今回条件では標準評価。" },
      },
      cons: [],
    },
  };
  const result = buildHorsePublicView(horse);

  assert.deepEqual(result.strengths.map((factor) => factor.key), ["ability", "course", "distance"]);
  assert.equal(result.watchLabel, "確認ポイント");
  assert.equal(result.watchText, "今回条件では標準評価。");
  assert.doesNotMatch(result.headline, /TARGET|参照/);
});

test("horse risk flags use structured caution evidence in priority order", () => {
  const horse = {
    popularity: 3,
    currentRace: { distance: 2000 },
    pastRuns: [{ distance: 1600 }],
    analysis: {
      trainingEval: { grade: "C", details: { count: 27, final: { score: 61 } } },
      factorsDetail: {
        value: { indexRank: 2 },
        load: { adjustment: -2, relativeKg: 2 },
        distance: { score: 76 },
        pace: { score: 75 },
        trackBias: { adjustment: 0 },
        training: { score: 68, status: "active" },
        blood: { score: 69 },
      },
    },
  };
  const result = buildHorseRiskFlags(horse);

  assert.deepEqual(result.map((flag) => flag.label), ["斤量注意", "距離延長", "最終追い評価やや低め"]);
  assert.match(result[0].detail, /2kg重い/);
  assert.match(result[1].detail, /1600mから400m延長/);
  assert.match(result[2].detail, /調教総合68点に対し、最終追い切りは61点/);
});

test("low overall training explains what the caution is based on", () => {
  const result = buildHorseRiskFlags({
    analysis: {
      trainingEval: { grade: "D", details: { count: 12, final: { score: 66 } } },
      factorsDetail: {
        training: { score: 58, status: "active" },
      },
    },
  });

  assert.equal(result[0].label, "調教評価やや低め");
  assert.match(result[0].detail, /時計・終い・加速・本数/);
  assert.match(result[0].detail, /58点・D評価/);
});

test("horse risk flags do not invent warnings for neutral evidence", () => {
  const result = buildHorseRiskFlags({
    popularity: 2,
    currentRace: { distance: 1800 },
    pastRuns: [{ distance: 1800 }],
    analysis: {
      trainingEval: { grade: "B", details: { count: 18, final: { score: 74 } } },
      factorsDetail: {
        value: { indexRank: 2 },
        load: { adjustment: 0, relativeKg: 0 },
        distance: { score: 72 },
        pace: { score: 70 },
        trackBias: { adjustment: 0 },
        training: { score: 72, status: "active" },
        blood: { score: 67 },
      },
    },
  });

  assert.deepEqual(result, []);
});

test("missing training data is not presented as poor training", () => {
  const result = buildHorseRiskFlags({
    analysis: {
      trainingEval: { grade: "C", details: { count: 0, final: null } },
      factorsDetail: {
        training: { score: 60, status: "missing" },
      },
    },
  });

  assert.equal(result.some((flag) => flag.key === "training" || flag.key === "finalTraining"), false);
});

test("race conclusion selects each public role from fixed race data", () => {
  const result = buildRacePublicConclusion({
    raceContext: { paceScenario: { expectedPace: "ハイ" } },
    trackBias: { style: "front", strength: "strong" },
    horses: [
      raceHorse({ id: "a", name: "本命馬", number: 1, score: 82, popularity: 1, factors: { ability: 88, course: 70, distance: 80 } }),
      raceHorse({ id: "b", name: "逆転馬", number: 2, score: 80, popularity: 3, factors: { ability: 82, course: 91 } }),
      raceHorse({ id: "c", name: "穴馬", number: 3, score: 76, popularity: 6, factors: { distance: 86 }, value: { eligible: true, marketGap: 3 } }),
      raceHorse({ id: "d", name: "注意馬", number: 4, score: 72, popularity: 1, factors: { ability: 62, pace: 58 } }),
    ],
  });

  assert.equal(result.favorite.horse.id, "a");
  assert.equal(result.challenger.horse.id, "b");
  assert.equal(result.value.horse.id, "c");
  assert.equal(result.danger.horse.id, "d");
  assert.equal(result.key.value, "ハイペース × 前有利");
  assert.match(result.favorite.note, /地力の高さを高く評価。指数2位に2ポイント差/);
  assert.match(result.challenger.note, /今回コースへの適性は本命より高評価/);
  assert.match(result.value.note, /指数3位ながら6人気。今回距離への適性が人気以上の評価を支える/);
  assert.match(result.danger.note, /想定展開との相性の評価が伸びず、人気ほどの信頼は置きにくい/);
  assert.doesNotMatch(
    [result.favorite.note, result.challenger.note, result.value.note, result.danger.note].join(" "),
    /能力88|コース91|距離適性86|展開58|pt差/
  );
});

test("danger role requires a three-place gap between popularity and TM rank", () => {
  const result = buildRacePublicConclusion({
    horses: [
      raceHorse({ id: "a", name: "首位", number: 1, score: 82, popularity: 1 }),
      raceHorse({ id: "b", name: "次位", number: 2, score: 80, popularity: 3 }),
      raceHorse({ id: "c", name: "三位", number: 3, score: 78, popularity: 4 }),
      raceHorse({ id: "d", name: "二段差", number: 4, score: 76, popularity: 2 }),
    ],
  });

  assert.equal(result.danger.horse, null);
});

test("value evidence shadow chooses support from index ranks three to five", () => {
  const race = {
    horses: [
      raceHorse({ id: "a", name: "首位", number: 1, score: 82, popularity: 1 }),
      raceHorse({ id: "b", name: "次位", number: 2, score: 80, popularity: 2 }),
      raceHorse({ id: "c", name: "裏付け馬", number: 3, score: 78, popularity: 7, factors: { ability: 76, form: 75, training: 72, pace: 74 }, value: { eligible: true, marketGap: 4 } }),
      raceHorse({ id: "d", name: "乖離馬", number: 4, score: 76, popularity: 10, factors: { ability: 62, form: 61, training: 60, pace: 63 }, value: { eligible: true, marketGap: 6 } }),
      raceHorse({ id: "e", name: "五位", number: 5, score: 72, popularity: 11, factors: { ability: 90, form: 90 } }),
      raceHorse({ id: "f", name: "六位", number: 6, score: 70, popularity: 12, factors: { ability: 95, form: 95 }, value: { eligible: true, marketGap: 6 } }),
    ],
  };

  assert.equal(selectPublicValueHorse(race).id, "d");
  assert.equal(selectPublicValueEvidenceHorse(race).id, "c");
});

test("race conclusion does not invent value or danger selections", () => {
  const race = {
    horses: [
      raceHorse({ id: "a", name: "首位", number: 1, score: 80, popularity: 1, factors: { ability: 84 } }),
      raceHorse({ id: "b", name: "次位", number: 2, score: 78, popularity: 2, factors: { ability: 81 } }),
    ],
  };
  const first = buildRacePublicConclusion(race);
  const second = buildRacePublicConclusion(race);

  assert.equal(first.value.horse, null);
  assert.equal(first.danger.horse, null);
  assert.equal(first.danger.value, "大きな不安なし");
  assert.deepEqual(first, second);
});

test("current public horse views contain no internal copy markers", () => {
  const source = JSON.parse(readFileSync(new URL("../../../tools/week-data.json", import.meta.url), "utf8"));
  const horses = (source.races ?? []).flatMap((race) => race.horses ?? []);
  assert.ok(horses.length > 0);

  for (const horse of horses) {
    const publicView = JSON.stringify(buildHorsePublicView(horse));
    assert.doesNotMatch(publicView, /Confidence|Evidence|TARGET|参照|取得済み|未取得|監視|サンプル/);
  }
});

test("current race conclusions contain no internal copy markers", () => {
  const source = JSON.parse(readFileSync(new URL("../../../tools/week-data.json", import.meta.url), "utf8"));
  const conclusions = (source.races ?? []).map(buildRacePublicConclusion).filter(Boolean);
  assert.ok(conclusions.length > 0);

  for (const conclusion of conclusions) {
    assert.doesNotMatch(JSON.stringify(conclusion), /Confidence|Evidence|TARGET|参照|取得済み|未取得|監視|サンプル/);
  }
});

test("current pedigree breakdowns contain no internal acquisition wording", () => {
  const source = JSON.parse(readFileSync(new URL("../../../tools/week-data.json", import.meta.url), "utf8"));
  const breakdowns = (source.races ?? [])
    .flatMap((race) => race.horses ?? [])
    .map((horse) => buildPedigreePublicBreakdown(horse.analysis?.pedigree))
    .filter((rows) => rows.length);
  assert.ok(breakdowns.length > 0);

  for (const rows of breakdowns) {
    assert.doesNotMatch(JSON.stringify(rows), /Confidence|Evidence|TARGET|参照|取得済み|未取得|未照合|サンプル/);
  }
});
