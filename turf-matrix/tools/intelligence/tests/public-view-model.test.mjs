import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildHorseRiskFlags,
  buildRacePublicConclusion,
  buildHorsePublicView,
  publicConditionFit,
  publicScoreBand,
  publicTrainingHeadline,
  sanitizePublicText,
} from "../../../src/lib/public-view-model.js";

const raceHorse = ({ id, name, number, score, popularity, factors, value }) => ({
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

  assert.deepEqual(result.map((flag) => flag.label), ["斤量注意", "距離延長", "最終追い注意"]);
  assert.match(result[0].detail, /2kg重い/);
  assert.match(result[1].detail, /1600mから400m延長/);
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
      raceHorse({ id: "d", name: "注意馬", number: 4, score: 72, popularity: 2, factors: { ability: 62, pace: 58 } }),
    ],
  });

  assert.equal(result.favorite.horse.id, "a");
  assert.equal(result.challenger.horse.id, "b");
  assert.equal(result.value.horse.id, "c");
  assert.equal(result.danger.horse.id, "d");
  assert.equal(result.key.value, "ハイペース × 前有利");
  assert.match(result.challenger.note, /コース91で本命を上回る/);
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
