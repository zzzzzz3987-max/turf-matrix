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
  isPublicFactorEvaluated,
  publicScoreBand,
  publicTrainingHeadline,
  publicFactorExplanation,
  sanitizePublicText,
} from "../../../src/lib/public-view-model.js";
import {
  selectPublicValueEvidenceHorse,
  selectPublicValueHorse,
} from "../../../src/lib/public-role-selection.js";

test("factor explanations describe the evidence and remove scoring formulas", () => {
  const course = publicFactorExplanation({ key: "course", components: {
    sameCourse: { score: 72, count: 2 },
    sameSurface: { score: 68, count: 5 },
    courseType: { score: 70, count: 8 },
  } });
  assert.match(course, /今回と同じコースを2走/);
  assert.match(course, /同じ芝・ダートを5走/);
  assert.doesNotMatch(course, /%|点/);

  const blood = publicFactorExplanation({ key: "blood", calculation: {
    baseScore: 70, statisticsAdjustment: 2, individualProfileAdjustment: -1,
  } });
  assert.match(blood, /父・母父の特徴/);
  assert.match(blood, /今回の距離・コース・馬場/);

  const training = publicFactorExplanation({ key: "training", calculation: {
    baseScore: 74, stablePatternAdjustment: 1, goodRunAdjustment: 0, videoAdjustment: 3,
  } });
  assert.match(training, /最終追い切りと一週前の内容/);
  assert.match(training, /時計・ラップ・本数/);

  const trainingWeights = publicFactorExplanation({ key: "training", calculation: {
    baseScore: 71, stablePatternAdjustment: 0, goodRunAdjustment: 0, videoAdjustment: 0,
  }, components: { phaseQuality: 75, recentBest: 70, consistency: 68, volume: 60, freshness: 80 } });
  assert.match(trainingWeights, /最終追い切りと一週前の内容/);
  assert.doesNotMatch(trainingWeights, /62%|6%/);

  const load = publicFactorExplanation({ key: "load", status: "active", score: 71, adjustment: 1, relativeKg: -0.5 });
  assert.match(load, /基準より0.5kg軽く/);
  assert.match(load, /過去の負担実績も踏まえてプラス評価/);
  assert.doesNotMatch(load, /65＋補正/);
  const bias = publicFactorExplanation({ key: "trackBias", status: "pending" });
  assert.match(bias, /当日のレース傾向がまだ分からない/);
  assert.doesNotMatch(bias, /指数補正|Evidence|Confidence/);
  const distance = publicFactorExplanation({
    key: "distance",
    summary: "1800mは非根幹距離。前走1600mから200m延長。",
    evidence: ["1800m前後の経験 8走"],
    components: {
      proximity: { score: 74 },
      cadence: { adjustment: 2, sampleCount: 6 },
      direction: { adjustment: 2, label: "延長への好材料あり" },
    },
  });
  assert.match(distance, /1800m前後を8走経験/);
  assert.match(distance, /距離変更（延長）への対応もプラス材料/);
  assert.doesNotMatch(distance, /非根幹|\+2点|延長への好材料あり/);
});

test("full course explanation leads with scored race-record evidence, not venue copy", () => {
  const horse = {
    currentRace: { course: "中山", surface: "ダ", distance: 1800 },
    analysis: { course: { geometryFit: { label: "右回り・内回り・短い直線・急坂", scoreConnected: false } } },
    pastRuns: [
      { course: "中山", surface: "ダ", distance: 1800, finishPosition: 2 },
      { course: "中山", surface: "芝", distance: 1800, finishPosition: 1 },
      { course: "東京", surface: "ダ", distance: 1700, finishPosition: 3 },
      { course: "東京", surface: "ダ", distance: 1600, finishPosition: 4 },
      { course: "中京", surface: "ダ", distance: 1800, finishPosition: 2 },
    ],
  };
  const text = publicFactorExplanation({ key: "course", score: 71 }, { horse });
  assert.match(text, /このコース点には、同コース・同じダート・坂コースでの着順と着差/);
  assert.match(text, /同じダート4走で3着以内3回・坂コース（中山・中京）3走で3着以内3回/);
  assert.match(text, /中山での直接実績は2走、3着以内2回/);
  assert.match(text, /コース点には加えていません/);
  assert.doesNotMatch(text, /今回の舞台は/);
  assert.doesNotMatch(text, /1800m前後/);
});

test("full blood explanation connects sire traits to samples without overstating them", () => {
  const horse = {
    currentRace: { surface: "ダ", distance: 1800 },
    analysis: { pedigree: {
      identity: { sire: "父名", broodmareSire: "母父名" },
      sireProfile: { traits: ["持続力", "中距離性能"] },
      broodmareSireProfile: { traits: ["瞬発力", "スピード"] },
      statistics: [
        { entityType: "sire", name: "父名", sampleSize: 4, uniqueHorseCount: 2, top3: 3, hitRate: 0.75,
          horseContributions: { A: { sampleSize: 3 } } },
        { entityType: "broodmareSire", name: "母父名", sampleSize: 20, uniqueHorseCount: 8, top3: 7, hitRate: 0.35 },
      ],
      componentDetails: { goingFit: { status: "reference_only", label: "重への血統適合" } },
    } },
  };
  const text = publicFactorExplanation({ key: "blood" }, { horse });
  assert.match(text, /父父名は持続力・中距離性能が持ち味/);
  assert.match(text, /母父母父名は瞬発力・スピードで補います/);
  assert.match(text, /4走・2頭、3着以内3回（複勝率75%）/);
  assert.match(text, /一頭の成績に偏るため参考扱い/);
  assert.match(text, /重馬場への血統適性は裏づけデータがなく、中立扱い/);
});

test("ability, recent-form, and pace explanations stay specific without exposing formulas", () => {
  const ability = publicFactorExplanation({ key: "ability", components: [], calculation: { components: [
    { key: "distance", label: "距離一致", score: 80, share: 0.38, contribution: 30.4 },
    { key: "peer", label: "同走馬", score: 54, share: 0.27, contribution: 18.9 },
  ] } });
  assert.match(ability, /今回に近い距離の実績が強み/);
  assert.match(ability, /直接対戦の内容は慎重評価/);
  assert.doesNotMatch(ability, /構成比|%|点×/);

  const form = publicFactorExplanation({ key: "form", calculation: {
    centralScore: 72, localScore: 60, runs: [{
      text: "中山記念",
      weightedScore: 75,
      classAdjustment: 5,
      distanceAdjustment: 4,
      components: { finish: 80, margin: 74, closing: 70 },
    }],
  } });
  assert.match(form, /評価材料は「中山記念」/);
  assert.doesNotMatch(form, /平均72|85%|着順80点/);

  const pace = publicFactorExplanation({ key: "pace", calculation: {
    method: "想定ペースとの脚質相性", expectedPace: "ハイ", style: "差し",
    paceAdjustment: 4, courseAdjustment: 2,
  } });
  assert.match(pace, /ハイペース想定/);
  assert.match(pace, /展開面でプラス/);
  assert.doesNotMatch(pace, /基準72|補正\+4点/);
});

test("ability explanation cites horse-specific head-to-head and close-margin evidence", () => {
  const ability = publicFactorExplanation({ key: "ability", components: [
    { key: "baseAbility", score: 76 },
  ], evidence: [
    "東京でレオンティウスと直接対戦。全2頭も評価",
    "直近で0.5秒差以内 1走",
    "最速材料 東京 33.7",
  ] });

  assert.match(ability, /東京でレオンティウスと直接対戦/);
  assert.match(ability, /上がり最速の材料は東京・33\.7秒/);
  assert.doesNotMatch(ability, /直近で0\.5秒差以内/);
});

test("ability explanation leads with concrete facts when component scores are unavailable", () => {
  const ability = publicFactorExplanation({ key: "ability", evidence: [
    "東京でレオンティウスと直接対戦。全2頭も評価",
    "最速材料 東京 33.7",
    "直近1走の着順・着差・クラス・上がりから算出",
  ] });
  assert.match(ability, /東京でレオンティウスと直接対戦/u);
  assert.match(ability, /上がり最速は東京・33\.7秒/u);
  assert.doesNotMatch(ability, /能力材料が強み/u);
});

test("ability explanation names calculation-only components instead of calling them generic ability material", () => {
  const ability = publicFactorExplanation({ key: "ability", calculation: { components: [
    { key: "closing", score: 89 },
    { key: "relations", score: 58.6 },
  ] }, evidence: [
    "東京でレオンティウスと直接対戦。全2頭も評価",
    "最速材料 東京 33.7",
  ] });
  assert.match(ability, /上がり性能が強み/u);
  assert.match(ability, /相手関係は慎重評価/u);
  assert.doesNotMatch(ability, /能力材料/u);
});

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

test("training headline clarifies the role of each workout", () => {
  const result = publicTrainingHeadline({
    grade: "C",
    details: { final: { score: 76 } },
  });

  assert.equal(result, "調教全体は標準。最終追い切りを含む調整過程と、時計・ラップ・本数を合わせて評価しています。");
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
  assert.match(result[0].sections.find((section) => section.label === "父のタイプ")?.text ?? "", /高速馬場・瞬発力/);
  assert.match(result[0].sections.find((section) => section.label === "慎重に見る点")?.text ?? "", /消耗戦/);
  assert.match(result[2].summary, /1000m|スピード83/);
  assert.deepEqual(result[2].metrics, [
    { label: "スピード", value: "83" },
    { label: "瞬発力", value: "82" },
  ]);
  assert.ok(result.every((row) => row.sections.length > 0));
  assert.deepEqual(result[3].points, ["Deep Impact系"]);
});

test("distant paternal ancestry is shown as lineage only, not as the sire's distance aptitude", () => {
  const result = buildPedigreePublicBreakdown({
    identity: { sire: "Nyquist", broodmareSire: "Tapit" },
    sireProfile: {
      summary: "父NyquistはUncle Mo × Seeking Gabrielle。父方祖先（Forestry）からStorm Cat系を確認。祖先の傾向を父Nyquist自身の得意距離とはみなさず、加点にも使いません。",
      ancestry: ["Uncle Mo", "Seeking Gabrielle"],
      traits: [],
    },
    broodmareSireProfile: { traits: [] },
    raceBias: {
      matched: [],
      backgroundMatches: [{
        label: "Storm Cat系",
        note: "北米型の先行スピードとパワーを補強。短距離では加速と速度維持を評価します。",
        fit: ["スピード", "パワー", "短距離"],
        hitEntries: [{ generation: 3, branch: "sire.dam.sire", name: "Forestry", role: "ancestor" }],
      }],
      femaleMatched: [],
      courseMatched: [],
    },
    componentDetails: { sireTrait: { score: 62 } },
    statistics: [],
    strengths: [],
  });

  const sire = result.find((row) => row.key === "sireTrait");
  const lineage = sire?.sections.find((section) => section.label === "父方祖先の役割")?.text ?? "";
  assert.match(lineage, /Forestry・3代目からStorm Cat系を確認/u);
  assert.match(lineage, /系統構成の記録にとどめ/u);
  assert.doesNotMatch(lineage, /短距離|スピード|パワー/u);
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

test("horse risk flags explain relative load caution and proven load history", () => {
  const horse = {
    popularity: 3,
    currentRace: { distance: 2000 },
    pastRuns: [{ distance: 1600 }],
    analysis: {
      trainingEval: { grade: "C", details: { count: 27, final: { score: 61 } } },
      factorsDetail: {
        value: { indexRank: 2 },
        load: {
          adjustment: -1,
          relativeKg: 2,
          carriedWeight: 55,
          sexAllowance: 2,
          comparableSuccessCount: 3,
          tolerance: { adjustment: 0, sampleCount: 3, unprovenHigh: false },
        },
        distance: { score: 76 },
        pace: { score: 75 },
        trackBias: { adjustment: 0 },
        training: { score: 68, status: "active" },
        blood: { score: 69 },
      },
    },
  };
  const result = buildHorseRiskFlags(horse);

  assert.deepEqual(result.map((flag) => flag.label), ["牝馬の相対負担", "距離延長", "最終追い評価やや低め"]);
  assert.match(result[0].detail, /今回も55kg/);
  assert.match(result[0].detail, /中央値より2kg重め/);
  assert.match(result[0].detail, /3着内3走/);
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

test("unassessed fallback scores are neither strengths nor risk flags", () => {
  for (const status of ["missing", "unavailable", "not_applicable", "pending", "monitor"]) {
    const factorsDetail = {
      ability: { score: 72, status: "active" },
      blood: { score: 95, status },
      distance: { score: 45, status },
      pace: { score: 45, status },
      training: { score: 60, status },
      trackBias: { score: 45, adjustment: -1, status },
      load: { score: 45, adjustment: -1, status },
    };
    const view = buildHorsePublicView({ analysis: { factorsDetail } });
    assert.deepEqual(view.factors.map((row) => row.key), ["ability"]);
    assert.deepEqual(view.strengths.map((row) => row.key), ["ability"]);
    assert.deepEqual(view.riskFlags, []);
    assert.equal(view.watchFactor, null);
  }
  assert.equal(isPublicFactorEvaluated({ score: 70, status: "partial" }), true);
  assert.equal(isPublicFactorEvaluated({ score: 70 }), true);
});

test("role explanations do not mistake unavailable training for the reason to oppose a favorite", () => {
  const horses = Array.from({ length: 6 }, (_, i) => raceHorse({
    id: String(i), name: "Horse" + i, number: i + 1, score: 85 - i,
    popularity: i === 5 ? 1 : i + 2, factors: { ability: 70, course: 71, pace: 72 },
  }));
  horses[5].analysis.factorsDetail.training = { status: "missing", score: 40 };
  const result = buildRacePublicConclusion({ horses });
  assert.equal(result.danger.horse.name, "Horse5");
  assert.doesNotMatch(result.danger.note, /調教/);
});

test("clock-only training warning does not claim visually poor movement", () => {
  const flags = buildHorseRiskFlags({ analysis: {
    factorsDetail: { training: { score: 70, status: "active" } },
    trainingEval: { grade: "B", details: { count: 2, final: { score: 60 } } },
  } });
  assert.match(flags[0].detail, /時計だけで状態不良とは判断しません/);
  assert.doesNotMatch(flags[0].detail, /動きは|仕上がりの上積み/);
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
  assert.match(result.danger.note, /想定展開との相性は慎重評価/);
  assert.match(result.danger.note, /消しの断定ではありません/);
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

test('danger copy retains strong condition evidence instead of implying a confident exclusion', () => {
  const result = buildRacePublicConclusion({ horses: [
    raceHorse({ id: 'a', number: 1, score: 85, popularity: 2 }),
    raceHorse({ id: 'b', number: 2, score: 83, popularity: 3 }),
    raceHorse({ id: 'c', number: 3, score: 81, popularity: 4 }),
    raceHorse({ id: 'd', number: 4, score: 78, popularity: 1, factors: { training: 56, distance: 77, course: 71 } }),
  ] });
  assert.match(result.danger.note, /調教内容は慎重評価/);
  assert.match(result.danger.note, /一方で今回距離への適性は強み/);
  assert.doesNotMatch(result.danger.note, /人気ほどの信頼は置きにくい/);
});

test('recent form weakness is not hidden behind market-only caution', () => {
  const result = buildRacePublicConclusion({ horses: [
    raceHorse({ id: 'a', number: 1, score: 85, popularity: 2 }),
    raceHorse({ id: 'b', number: 2, score: 83, popularity: 3 }),
    raceHorse({ id: 'c', number: 3, score: 81, popularity: 4 }),
    raceHorse({ id: 'd', number: 4, score: 78, popularity: 1, factors: { form: 56, course: 75, pace: 76 } }),
  ] });
  assert.match(result.danger.note, /近走内容は慎重評価/);
  assert.doesNotMatch(result.danger.note, /注意の中心は人気との評価差/);
});

test('value copy does not present a weak maximum factor as strong evidence', () => {
  const result = buildRacePublicConclusion({ horses: [
    raceHorse({ id: 'a', number: 1, score: 85, popularity: 1 }),
    raceHorse({ id: 'b', number: 2, score: 83, popularity: 2 }),
    raceHorse({ id: 'c', number: 3, score: 75, popularity: 9, factors: { ability: 61, course: 66 }, value: { eligible: true, marketGap: 6 } }),
  ] });
  assert.match(result.value.note, /強い好走材料は限定的/);
  assert.match(result.value.note, /地力の高さには注意/);
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
  assert.equal(first.danger.value, "該当馬なし");
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
