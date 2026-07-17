import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { dataMode, weekData } from "./data/week-data-loader.js";
import {
  Sparkles, Zap, Ruler, Activity, Dumbbell, Timer, Home, LayoutGrid, Dna,
  TrendingUp, MessageSquare, Clock, BadgeCheck, ChevronDown, ChevronLeft, X,
  Star, Map, Route, ChevronRight,
} from "lucide-react";

/* =====================================================================
 * TURF MATRIX β (v0.3) — AI Racing Intelligence Platform
 * ---------------------------------------------------------------------
 * ■ 3層完全分離(毎週の運営はデータ層だけを触る):
 *
 *   [DATA]  WEEK_DATA        … 週次データ。マーカー間を丸ごと差し替えるだけ。
 *                              手動貼り付け or `node update-data.mjs` で注入。
 *   [LOGIC] lib/logic        … 期待値・推定勝率・血統指数・Rank・信頼度など
 *                              全て純関数。データから毎回自動計算(手入力不要)。
 *   [UI]    components/pages … データ形式にのみ依存。毎週触らない。
 *
 * ■ 運用フロー(READMEに詳細):
 *   JRA-VAN Data Lab. → (Claude/任意ツールで整形) → week-data.json
 *     → node update-data.mjs → デプロイ
 *
 * ■ 自動計算される項目(JSONに書く必要がない):
 *   期待値 / 推定勝率 / レース内Rank / S〜Dティア / 血統指数 /
 *   レース単位の分析信頼度 / トップの分析頭数・レース数
 * ===================================================================== */

/* =====================================================================
 * [1] lib/types — 型定義(JSDoc)
 * ---------------------------------------------------------------------
 * @typedef {Object} Factor        ファクター指数 (0-100)
 *   ability 能力 / distance 距離適性 / lap ラップ適性 / training 調教 /
 *   trainingLap 調教ラップ / stable 厩舎勝負調教パターン / frame 枠順
 *
 * @typedef {Object} PedigreeLine  { role, name, note }  4ライン(父系/母父系/母母父系/牝系)
 * @typedef {Object} Pedigree
 *   @property {PedigreeLine[]} lines
 *   @property {Object} scores  … course/distance/going/lap/family/speed/stamina/burst/sustain (0-100)
 *
 * @typedef {Object} TrainingEval
 *   grade A-D / oneWeek{score,text}(主要評価) / final{status,text}(確認材料) /
 *   stablePattern{match,text}
 *
 * @typedef {Object} Analysis
 *   tags[] / factors / pros[] / cons[] / insight[](3行) / commentary /
 *   frameEval{score,text} / trainingEval / pedigree / confidence high|mid|low
 *
 * @typedef {Object} Horse
 *   id / number / name / jockey / popularity / odds / aiScore / comment / analysis
 *
 * @typedef {Object} Race
 *   id / track / number / name / grade? / time / surface / distance /
 *   going / fieldSize / horses[]
 *
 * 将来拡張(スキーマ予約): RaceArchive { raceId, analyzedAt, result, review, roiNote }
 *   … 検証・回顧・回収率の透明化に使用
 * ===================================================================== */


/* =====================================================================
 * [2] lib/logic — 分析ロジック(全て純関数・データから自動計算)
 * ---------------------------------------------------------------------
 * 分析ポリシー: 人気順の後追いはしない。
 * 期待値 = 推定勝率 × 単勝オッズ をAI指数から独立に算出し、
 * 混戦(指数が拮抗)時ほど中位指数×高オッズの馬が浮上する設計。
 * ===================================================================== */

/** AI指数からレース内の推定勝率を算出(指数のべき乗シェア) */
const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);
const isEvaluatedHorse = (horse) => isFiniteNumber(horse?.aiScore);
const displayScore = (value) => (isFiniteNumber(value) ? value : "未評価");
const displayOdds = (value) => (isFiniteNumber(value) && value > 0 ? value.toFixed(1) : "発売前");
const displayPopularity = (value) => (isFiniteNumber(value) && value > 0 ? `${value}` : "発売前");
const displayRaceValue = (value, fallback = "取得待ち") => (value == null || value === "" ? fallback : value);
const isPendingText = (value) => {
  const text = String(value ?? "").trim();
  return !text || text === "取得待ち" || /^\?+$/.test(text);
};
const displayHorseName = (horse) => (isPendingText(horse?.name) ? horse?.currentRace?.horseName ?? "取得待ち" : horse.name);
const displayJockeyName = (horse) => (isPendingText(horse?.jockey) ? horse?.currentRace?.jockey ?? "取得待ち" : horse.jockey);
const WEEK_PREPARING_TEXT = "今週のレースは準備中です";
const oddsStatusLabel = (status) => ({
  active: "最終更新",
  preodds: "発売前",
  missing: "取得待ち",
  closed: "締切",
  partial: "一部取得",
}[status] ?? "取得待ち");
const formatOddsUpdatedAt = (value, status) => {
  if (status !== "active" || !value) return oddsStatusLabel(status);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return oddsStatusLabel(status);
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
};

const winProbability = (horse, field, k = 7) => {
  if (!isEvaluatedHorse(horse) || !field?.every(isEvaluatedHorse)) return null;
  const w = (h) => Math.pow(h.aiScore / 100, k);
  const total = field.reduce((s, h) => s + w(h), 0);
  return w(horse) / total;
};

/** 期待値評価: { prob, ev, verdict } */
const evaluateValue = (horse, field) => {
  if (!isEvaluatedHorse(horse) || !isFiniteNumber(horse?.odds) || horse.odds <= 0) return null;
  const prob = winProbability(horse, field);
  if (prob == null) return null;
  const ev = prob * horse.odds;
  const verdict =
    ev >= 1.15 ? { label: "妙味あり", tone: "blue" }
    : ev >= 0.95 ? { label: "中立", tone: "gray" }
    : { label: "過剰人気気味", tone: "gray" };
  return { prob, ev, verdict };
};

/** 血統指数 = 9項目の平均 */
const pedigreeIndex = (pedigree) => {
  if (!pedigree?.scores) return null;
  const v = Object.values(pedigree.scores);
  return Math.round(v.reduce((a, b) => a + b, 0) / v.length);
};

/** レース内Rank(AI指数順) { horseId: rank } */
const rankByScore = (horses) =>
  Object.fromEntries(
    [...horses].filter(isEvaluatedHorse).sort((a, b) => b.aiScore - a.aiScore).map((h, i) => [h.id, i + 1])
  );

/** レース単位の分析信頼度(全馬の信頼度の加重平均) */
const raceConfidence = (horses) => {
  if (!horses?.length) return "low";
  if (!horses.every((h) => h.analysis?.confidence)) return null;
  const weight = { high: 3, mid: 2, low: 1 };
  const avg = horses.reduce((s, h) => s + weight[h.analysis.confidence], 0) / horses.length;
  return avg >= 2.5 ? "high" : avg >= 1.8 ? "mid" : "low";
};

/** TM INDEX ティア */
const scoreTier = (v) =>
  !isFiniteNumber(v) ? { label: "未評価", text: "分析準備中" }
  :
  v >= 90 ? { label: "S", text: "TOP評価" }
  : v >= 80 ? { label: "A", text: "有力評価" }
  : v >= 70 ? { label: "B", text: "標準評価" }
  : v >= 60 ? { label: "C", text: "割引評価" }
  : { label: "D", text: "厳しい評価" };

/** TM VALUE: 期待値の5段階(1.00が損益分岐) */
const valueStars = (ev) =>
  !isFiniteNumber(ev) ? 0 :
  ev >= 1.3 ? 5 : ev >= 1.15 ? 4 : ev >= 1.0 ? 3 : ev >= 0.85 ? 2 : 1;

/** 分析信頼度の5段階(レベル + 調教評価の裏付けで加点) */
const confidenceStars = (a) => {
  if (!a?.confidence) return 0;
  const base = { high: 4, mid: 3, low: 2 }[a.confidence];
  return Math.min(5, base + (a.trainingEval?.grade === "A" ? 1 : 0));
};

/** AI指数の内訳(ファクター×重みの寄与。合計との差は「総合補正」として明示) */
const BREAKDOWN_DEFS = [
  { label: "能力", calc: (f) => f.ability * 0.3 },
  { label: "コース適性", calc: (f) => f.course * 0.08 },
  { label: "距離適性", calc: (f) => f.distance * 0.12 },
  { label: "展開", calc: (f) => f.pace * 0.1 },
  { label: "ラップ", calc: (f) => f.lap * 0.08 },
  { label: "調教", calc: (f) => f.training * 0.12 + f.trainingLap * 0.05 },
  { label: "血統", calc: (_f, ped) => ped * 0.1 },
  { label: "厩舎・枠順", calc: (f) => f.stable * 0.03 + f.frame * 0.02 },
];
const scoreBreakdown = (horse) => {
  if (!isEvaluatedHorse(horse) || !horse.analysis?.factors || !horse.analysis?.pedigree) return null;
  const f = horse.analysis.factors;
  const ped = pedigreeIndex(horse.analysis.pedigree);
  const items = BREAKDOWN_DEFS.map((d) => ({ label: d.label, value: Math.round(d.calc(f, ped)) }));
  const adjust = horse.aiScore - items.reduce((s, i) => s + i.value, 0);
  return { items, adjust };
};

/** 週次データの検証(差し替えミスの検出。エラーはconsoleとUIバナーに出る) */
const FACTOR_KEYS = ["ability", "distance", "lap", "training", "trainingLap", "stable", "frame", "course", "pace"];
const validateWeekData = (db) => {
  const errors = [];
  if (!db?.meta?.date) errors.push("meta.date がありません");
  for (const r of db?.races ?? []) {
    for (const k of ["id", "track", "number", "surface", "distance"])
      if (r[k] == null) errors.push(`${r.id || "?"}: ${k} が欠落`);
    if ((r.horses?.length ?? 0) !== r.fieldSize)
      errors.push(`${r.id}: fieldSize(${r.fieldSize}) と horses数(${r.horses?.length ?? 0}) が不一致`);
    for (const h of r.horses ?? []) {
      const a = h.analysis;
      if (!a) { errors.push(`${h.id}: analysis が欠落`); continue; }
      for (const k of FACTOR_KEYS) if (a.factors?.[k] == null) errors.push(`${h.id}: factors.${k} が欠落`);
      if (!a.insight?.length) errors.push(`${h.id}: insight が空`);
      if (!a.confidenceReasons?.length) errors.push(`${h.id}: confidenceReasons が空(信頼度には理由が必須)`);
      if (!a.pedigree?.lines?.length || !a.pedigree?.scores) errors.push(`${h.id}: pedigree が欠落`);
    }
  }
  return errors;
};

const GRADE_WEIGHT = { "GⅠ": 50, GI: 50, "GⅡ": 45, GII: 45, "GⅢ": 40, GIII: 40 };
const gradeScore = (grade) => GRADE_WEIGHT[String(grade ?? "").trim()] ?? (String(grade ?? "").includes("G") ? 35 : 0);
const isSpecialRace = (race) =>
  race?.category === "special" ||
  race?.raceType === "special" ||
  race?.isSpecial === true ||
  /特別|ステークス|S$|賞|記念/.test(String(race?.name ?? ""));

const selectFeaturedRace = (db) => {
  const races = db?.races ?? [];
  if (!races.length) return null;

  const explicit = races.find((race) => race.id === db?.meta?.featuredRaceId);
  if (explicit) return explicit;

  const flagged = races.find((race) => race.featured === true || race.isFeatured === true);
  if (flagged) return flagged;

  return [...races].sort((a, b) => {
    const score = (race) =>
      (race.featuredPriority ?? 0) +
      gradeScore(race.grade) +
      (isSpecialRace(race) ? 10 : 0) +
      ((race.horses?.length ?? 0) > 0 ? Math.max(...race.horses.map((h) => h.aiScore ?? 0)) / 100 : 0);
    return score(b) - score(a) || (b.number ?? 0) - (a.number ?? 0);
  })[0];
};

const normalizeAnalysis = (analysis) => ({
  ...analysis,
  factorsDetail: analysis?.factorsDetail ?? {},
  verdict: analysis?.verdict ?? { status: "missing", label: null, summary: null, evidence: [] },
  topSignal: analysis?.topSignal ?? { status: "missing", label: null, summary: null },
});

const cleanText = (value, fallback) => {
  const text = String(value ?? "").trim();
  if (!text || /^\?+$/.test(text)) return fallback;
  return text;
};

const normalizeWeekData = (db) => {
  const featuredRace = selectFeaturedRace(db);
  return {
    ...db,
    meta: {
      ...db.meta,
      venue: cleanText(db.meta?.venue, "開催場未設定"),
      featuredRaceId: db.meta?.featuredRaceId ?? featuredRace?.id ?? null,
    },
    dailySummary: {
      text: cleanText(db.dailySummary?.text, "週次データを読み込みました。"),
      highlights: (db.dailySummary?.highlights ?? []).filter((item) => !/^\?+$/.test(String(item ?? "").trim())),
    },
    races: (db.races ?? []).map((race) => ({
      ...race,
      track: cleanText(race.track, "開催場未設定"),
      name: cleanText(race.name, `${cleanText(race.track, "Race")}${race.number ?? ""}R`),
      category: race.category ?? (gradeScore(race.grade) ? "grade" : isSpecialRace(race) ? "special" : "race"),
      featuredRace: race.id === featuredRace?.id,
      displayTarget: race.displayTarget ?? true,
      horses: (race.horses ?? []).map((horse) => ({
        ...horse,
        analysis: normalizeAnalysis(horse.analysis ?? {}),
      })),
    })),
  };
};

const WEEK_DATA = normalizeWeekData(weekData);
const IS_INTELLIGENCE_PENDING = WEEK_DATA.meta?.intelligenceLayerConnected === false;
const DATA_ERRORS = dataMode === "candidate" || IS_INTELLIGENCE_PENDING ? [] : validateWeekData(WEEK_DATA);
if (DATA_ERRORS.length) console.warn("[TURF MATRIX] week-data 検証警告:", DATA_ERRORS);

/* =====================================================================
 * [3] lib/dataProvider — データ取得層
 * ---------------------------------------------------------------------
 * UIはこの層の関数のみを呼ぶ。全関数async。
 * Data Lab / API / DB へ差し替える場合はこのブロックの中身だけを置換する。
 *   例: getRace(id) → fetch(`/api/races/${id}`).then(r => r.json())
 * ===================================================================== */
const simulateLatency = (data, ms = 120) =>
  new Promise((resolve) => setTimeout(() => resolve(data), ms));

const dataProvider = {
  async getMeta() {
    // 集計値はデータから自動算出(毎週の手入力を無くす)
    const raceCount = WEEK_DATA.races.length;
    const horseCount = WEEK_DATA.races.reduce((s, r) => s + r.horses.length, 0);
    return simulateLatency({ ...WEEK_DATA.meta, raceCount, horseCount }, 60);
  },
  async getDailySummary() {
    return simulateLatency(WEEK_DATA.dailySummary);
  },
  async getRaces() {
    const list = WEEK_DATA.races.filter((r) => r.displayTarget !== false).map((r) => {
      const top = [...r.horses].filter(isEvaluatedHorse).sort((a, b) => b.aiScore - a.aiScore)[0];
      return {
        ...r,
        horses: undefined,
        topHorse: top
          ? {
              name: top.name,
              aiScore: top.aiScore,
              popularity: top.popularity,
              odds: top.odds,
              ev: evaluateValue(top, r.horses)?.ev ?? null,
              available: true,
            }
          : { name: WEEK_PREPARING_TEXT, aiScore: null, available: false },
        confidence: raceConfidence(r.horses),
      };
    });
    return simulateLatency(list);
  },
  async getRace(raceId) {
    const race = WEEK_DATA.races.find((r) => r.id === raceId) || null;
    return simulateLatency(race);
  },
  async getFeaturedHorses() {
    if (dataMode === "candidate" || IS_INTELLIGENCE_PENDING) {
      const derived = WEEK_DATA.races
        .flatMap((race) =>
          (race.horses ?? [])
            .filter(isEvaluatedHorse)
            .map((horse) => ({
              id: `${race.id}-${horse.id}`,
              raceId: race.id,
              horseId: horse.id,
              horse,
              raceLabel: `${race.track}${race.number}R`,
              note: horse.analysis?.verdict?.summary ?? horse.comment ?? "TARGET実データから算出した上位シグナルです。",
              ev: evaluateValue(horse, race.horses)?.ev ?? null,
            }))
        )
        .sort((a, b) => b.horse.aiScore - a.horse.aiScore)
        .slice(0, 3);
      return simulateLatency(derived);
    }
    const items = WEEK_DATA.featured.flatMap((f) => {
      const race = WEEK_DATA.races.find((r) => r.id === f.raceId);
      const horse = race?.horses?.find((h) => h.id === f.horseId);
      if (!race || !horse) return [];
      return [{
        ...f,
        horse,
        raceLabel: `${race.track}${race.number}R`,
        ev: evaluateValue(horse, race.horses)?.ev,
      }];
    });
    return simulateLatency(items);
  },
  async getIndexRanking(limit = 5) {
    const all = WEEK_DATA.races.flatMap((r) =>
      (r.horses ?? []).map((h) => ({ horse: h, raceId: r.id, raceLabel: `${r.track}${r.number}R` }))
    ).filter((item) => isEvaluatedHorse(item.horse));
    all.sort((a, b) => b.horse.aiScore - a.horse.aiScore);
    return simulateLatency(all.slice(0, limit));
  },
};

/* =====================================================================
 * [4] lib/format — 表示定義・ユーティリティ
 * ===================================================================== */
const FACTOR_DEFS = [
  { key: "ability", label: "能力", icon: Zap },
  { key: "course", label: "コース適性", icon: Map },
  { key: "distance", label: "距離適性", icon: Ruler },
  { key: "pace", label: "展開", icon: Route },
  { key: "lap", label: "ラップ適性", icon: Activity },
  { key: "pedigree", label: "血統", icon: Dna, derived: true },
  { key: "training", label: "調教", icon: Dumbbell },
  { key: "trainingLap", label: "調教ラップ", icon: Timer },
  { key: "stable", label: "厩舎パターン", icon: Home },
  { key: "frame", label: "枠順", icon: LayoutGrid },
];

/* ファクター比較テーブルの行(「どの馬がどこで優れているか」を3秒で) */
const COMPARE_DEFS = [
  { key: "ability", label: "能力" },
  { key: "course", label: "コース適性" },
  { key: "distance", label: "距離適性" },
  { key: "pace", label: "展開" },
  { key: "ev", label: "期待値", type: "ev" },
  { key: "training", label: "調教" },
  { key: "pedigree", label: "血統", type: "pedigree" },
];

const PEDIGREE_SCORE_DEFS = [
  { key: "course", label: "コース" },
  { key: "distance", label: "距離" },
  { key: "going", label: "馬場" },
  { key: "lap", label: "ラップ" },
  { key: "family", label: "近親実績" },
  { key: "speed", label: "スピード" },
  { key: "stamina", label: "スタミナ" },
  { key: "burst", label: "瞬発力" },
  { key: "sustain", label: "持続力" },
];

const CONFIDENCE = {
  high: { label: "High", dots: 3, note: "データ量・再現性とも十分" },
  mid: { label: "Mid", dots: 2, note: "一部ファクターの根拠が限定的" },
  low: { label: "Low", dots: 1, note: "データ不足のため振れ幅が大きい" },
};

const SORT_OPTIONS = [
  { key: "score", label: "AI指数" },
  { key: "ev", label: "期待値" },
  { key: "number", label: "馬番" },
  { key: "popularity", label: "人気" },
];

/* TM FACTORS v1: 将来の analysis.factors[key] との対応表 */
const TM_FACTOR_DEFS = [
  {
    key: "blood",
    label: "Blood",
    score: 82,
    maxScore: 100,
    stars: 4,
    summary: "血統背景と距離適性の噛み合い",
    evidence: "pedigree.lines / pedigree.scores を接続予定",
    status: "missing",
  },
  {
    key: "training",
    label: "Training",
    score: 91,
    maxScore: 100,
    stars: 5,
    summary: "追い切り内容と上昇度の強さ",
    evidence: "trainingEval / factors.training を接続予定",
    status: "missing",
  },
  {
    key: "course",
    label: "Course",
    score: 78,
    maxScore: 100,
    stars: 4,
    summary: "コース形態と過去傾向への適合",
    evidence: "factors.course / 距離条件を接続予定",
    status: "missing",
  },
  {
    key: "pace",
    label: "Pace",
    score: 68,
    maxScore: 100,
    stars: 3,
    summary: "想定ラップと脚質の相性",
    evidence: "factors.pace / factors.lap を接続予定",
    status: "missing",
  },
  {
    key: "stable",
    label: "Stable",
    score: 74,
    maxScore: 100,
    stars: 4,
    summary: "厩舎パターンと仕上げ精度",
    evidence: "factors.stable / stablePattern を接続予定",
    status: "missing",
  },
  {
    key: "form",
    label: "Form",
    score: 80,
    maxScore: 100,
    stars: 4,
    summary: "近走内容と状態面の安定感",
    evidence: "analysis.tags / comment / confidenceReasons を接続予定",
    status: "missing",
  },
  {
    key: "value",
    label: "Value",
    score: 88,
    maxScore: 100,
    stars: 5,
    summary: "市場評価とのギャップ",
    evidence: "evaluateValue のEV結果を接続予定",
    status: "missing",
  },
];

const sortHorses = (horses, sortKey, evMap) => {
  const arr = [...horses];
  if (sortKey === "score") arr.sort((a, b) => (b.aiScore ?? -1) - (a.aiScore ?? -1) || a.number - b.number);
  if (sortKey === "ev") arr.sort((a, b) => (evMap[b.id]?.ev ?? 0) - (evMap[a.id]?.ev ?? 0));
  if (sortKey === "number") arr.sort((a, b) => a.number - b.number);
  if (sortKey === "popularity") arr.sort((a, b) => (a.popularity ?? 999) - (b.popularity ?? 999) || a.number - b.number);
  return arr;
};

const scoreTone = (v) => (!isFiniteNumber(v) ? "text-gray-300" : "text-slate-950");
const evTone = (ev) => (ev >= 1.15 ? "text-teal-600" : ev >= 0.95 ? "text-slate-900" : "text-gray-500");
const confidenceMeta = (level) => CONFIDENCE[level] ?? { label: "未評価", dots: 0, note: "分析準備中" };

const commandFactors = (horse, ev) => {
  if (!horse.analysis?.factors || !horse.analysis?.pedigree) {
    return [
      { key: "blood", label: "Blood AI", value: null, status: horse.pedigreeRaw ? "取得済み" : "未取得" },
      { key: "training", label: "Training AI", value: null, status: horse.dataStatus?.training === "active" ? "取得済み" : "調教データ不足" },
      { key: "course", label: "Course AI", value: null, status: "分析準備中" },
      { key: "pace", label: "Pace AI", value: null, status: "分析準備中" },
      { key: "stable", label: "Stable AI", value: null, status: "分析準備中" },
      { key: "form", label: "Form AI", value: null, status: horse.pastRuns?.length ? "過去走取得済み" : "未取得" },
      { key: "value", label: "Value AI", value: null, status: "オッズ取得待ち" },
    ];
  }
  const factors = horse.analysis.factors;
  const valueScore = ev ? Math.max(35, Math.min(96, Math.round(ev.ev * 72))) : 50;
  return [
    { key: "blood", label: "Blood AI", value: pedigreeIndex(horse.analysis.pedigree) },
    { key: "training", label: "Training AI", value: factors.training },
    { key: "course", label: "Course AI", value: Math.round((factors.course + factors.distance) / 2) },
    { key: "pace", label: "Pace AI", value: factors.pace },
    { key: "stable", label: "Stable AI", value: factors.stable },
    { key: "form", label: "Form AI", value: Math.round((factors.ability + factors.lap) / 2) },
    { key: "value", label: "Value AI", value: valueScore },
  ];
};

/* カスタムフック: PC(≥768px)判定 — シート/インライン展開の切替に使用 */
const useIsDesktop = () => {
  const [isDesktop, setIsDesktop] = useState(
    typeof window !== "undefined" ? window.matchMedia("(min-width: 768px)").matches : false
  );
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const handler = (e) => setIsDesktop(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return isDesktop;
};

const usePrefersReducedMotion = () => {
  const [reduced, setReduced] = useState(
    typeof window !== "undefined" ? window.matchMedia("(prefers-reduced-motion: reduce)").matches : false
  );
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = (e) => setReduced(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return reduced;
};

/* =====================================================================
 * [5] components — UI部品
 * ===================================================================== */

const Num = ({ children, className = "" }) => (
  <span className={`tm-num tabular-nums ${className}`}>{children}</span>
);

const AnimatedIndexValue = ({ value, className = "" }) => {
  const reducedMotion = usePrefersReducedMotion();
  const target = isFiniteNumber(value) ? value : null;
  const [displayValue, setDisplayValue] = useState(target ?? displayScore(value));

  useEffect(() => {
    if (target == null || reducedMotion) {
      setDisplayValue(target ?? displayScore(value));
      return undefined;
    }

    let frameId;
    const duration = 700;
    const startedAt = performance.now();
    const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

    const tick = (now) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      setDisplayValue(Math.round(target * easeOutCubic(progress)));
      if (progress < 1) frameId = requestAnimationFrame(tick);
    };

    setDisplayValue(0);
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [reducedMotion, target, value]);

  return <Num className={className}>{displayValue}</Num>;
};

const IndexUnderline = () => <span className="tm-index-underline mt-3 block" aria-hidden="true" />;

const Badge = ({ children, className = "" }) => (
  <span className={className}>{children}</span>
);

const MetricCard = ({ label, value, className = "", valueClassName = "", labelClassName = "" }) => (
  <div className={className}>
    <Num className={valueClassName}>{value}</Num>
    <span className={labelClassName}>{label}</span>
  </div>
);

const GLASS = {
  surface:
    "rounded-[2rem] border border-gray-200 bg-white shadow-sm",
  inner:
    "rounded-[1.35rem] border border-gray-200 bg-white shadow-sm",
  interactive:
    "transition-all duration-200 hover:-translate-y-0.5 hover:border-gray-200 hover:bg-white hover:shadow-sm active:translate-y-0 active:shadow-sm",
  padding: "p-6 sm:p-7",
};

const GlassPanel = ({ children, className = "" }) => (
  <div className={`${GLASS.surface} ${GLASS.padding} ${className}`}>
    {children}
  </div>
);

const PlatformBadge = () => (
  <Badge className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[10px] font-semibold text-slate-600 shadow-sm sm:gap-2 sm:px-3 sm:py-1.5 sm:text-[11px]">
    <span className="h-1.5 w-1.5 rounded-full bg-gray-300" />
    <span>
      <span className="hidden sm:inline">AI Racing </span>
      <span className="sm:hidden">AI </span>
      Intelligence Platform
    </span>
    <span className="hidden text-slate-300 sm:inline">/</span>
    <span className="hidden sm:inline">β CSV Data</span>
  </Badge>
);

const Skeleton = ({ className = "" }) => (
  <div className={`animate-pulse rounded-lg bg-gray-100 ${className}`} />
);

const OFFICIAL_LOGO_SRC = "/logo-official.png";

const OfficialLogo = ({ className = "" }) => (
  <span className={`block text-[15px] font-bold tracking-[0.24em] text-[#111827] ${className}`}>
    TURF <span className="text-[#00A9D6]">MATRIX</span>
  </span>
);

const Header = ({ onHome, meta }) => (
  <header className="sticky top-0 z-40 border-b border-[#E5E7EB] bg-white/70 backdrop-blur-xl">
    <div className="mx-auto flex h-11 max-w-5xl items-center justify-between px-2.5 sm:px-5">
      <button onClick={onHome} className="flex min-w-0 items-center" aria-label="トップへ戻る">
        <OfficialLogo />
      </button>
      <div className="flex items-center gap-2 text-[11px] font-semibold text-[#9AA4B2]">
        {meta ? (
          <span>
            β v0.3 <span className="text-[#CBD5E1]">・</span> {meta.dateLabel ?? ""}
          </span>
        ) : null}
      </div>
    </div>
  </header>
);

const Footer = () => (
  <footer className="mt-20 border-t border-gray-200 bg-white">
    <div className="mx-auto max-w-5xl px-5 py-12">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="text-sm font-bold tracking-tight text-gray-900">
          TURF <span className="text-slate-700">MATRIX</span>
        </span>
        <PlatformBadge />
      </div>
      <p className="mt-4 max-w-2xl text-xs leading-relaxed text-gray-500">
        本サービスは分析情報の提供を目的としており、的中や利益を保証するものではありません。
        馬券の購入はご自身の判断と責任でお願いします。20歳未満の方は馬券を購入できません。
      </p>
      <p className="mt-2 max-w-2xl text-xs leading-relaxed text-gray-500">
        分析ポリシー: 人気を後追いする評価は行いません。AIは能力・血統・調教・ラップ・オッズ妙味などから
        期待値を独立に算出します。
      </p>
      <p className="mt-2 text-xs text-gray-500">
        β版のため、一部AI分析項目は準備中です。過去分析ログ(検証・回顧・回収率の透明化)は今後のバージョンで公開予定です。
      </p>
      <p className="mt-6 text-[11px] text-gray-500">© 2026 TURF MATRIX — AI Racing Intelligence Platform</p>
    </div>
  </footer>
);

/* ---- AnimatedBar: マウント時に0→値へ伸びる共通バー ---- */
const AnimatedBar = ({ value, delay = 0, trackClass = "bg-[#F3F4F6]", fillClass = "bg-[#2D7BFF]", heightClass = "h-1.5" }) => {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 40);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className={`${heightClass} flex-1 overflow-hidden rounded-full ${trackClass}`}>
      <div
        className={`tm-bar h-full rounded-full ${fillClass}`}
        style={{ width: mounted ? `${value}%` : "0%", transitionDelay: `${delay}ms` }}
      />
    </div>
  );
};

/* ---- FactorBar: 横バー(レーダーチャートは不採用) ---- */
const FactorBar = ({ icon: Icon, label, value, delay = 0 }) => (
  <div className="flex items-center gap-3.5">
    <span className="flex w-24 shrink-0 items-center gap-1.5 text-xs text-gray-500">
      {Icon && <Icon size={12} strokeWidth={1.75} className="shrink-0 text-gray-300" />}
      {label}
    </span>
    <AnimatedBar value={value} delay={delay} />
    <Num className={`w-9 shrink-0 text-right text-[13px] font-semibold ${scoreTone(value)}`}>{value}</Num>
  </div>
);

const TagList = ({ tags }) => (
  <div className="flex flex-wrap gap-1.5">
    {tags.map((t) => (
      <span
        key={t}
        className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[11px] font-medium text-gray-600"
      >
        {t}
      </span>
    ))}
  </div>
);

/* ---- 5段階スター(信頼度 / TM VALUEで共用) ---- */
const StarRating = ({ value, size = 12, className = "" }) => (
  <span className={`inline-flex items-center gap-0.5 ${className}`} aria-label={`5段階中${value}`}>
    {[1, 2, 3, 4, 5].map((i) => (
      <Star
        key={i}
        size={size}
        strokeWidth={1.5}
        className={i <= value ? "fill-emerald-500 text-emerald-500" : "fill-gray-200 text-gray-200"}
      />
    ))}
  </span>
);
const starText = (n) => "★".repeat(n) + "☆".repeat(5 - n);

const TMFactorsCard = () => (
  <div className={`mt-4 ${GLASS.inner} p-4`}>
    <div className="flex items-start justify-between gap-3">
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">TM FACTORS v1</div>
        <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
          TM INDEXを7つの視点で整理します。
        </p>
      </div>
        <span className="shrink-0 rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-500">
        Data pending
      </span>
    </div>
    <div className="mt-4 grid gap-2.5 md:grid-cols-2">
      {TM_FACTOR_DEFS.map((factor) => (
        <div key={factor.key} className="rounded-2xl border border-gray-200 bg-white p-3 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[12px] font-semibold text-slate-900">{factor.label}</div>
              <div className="mt-1 flex items-center gap-2">
                <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-slate-800/80"
                    style={{ width: `${Math.min(100, (factor.score / factor.maxScore) * 100)}%` }}
                  />
                </div>
                <StarRating value={factor.stars} size={9} />
              </div>
            </div>
            <Num className="shrink-0 text-[22px] font-bold leading-none text-slate-900">{factor.score}</Num>
          </div>
          <p className="mt-2 line-clamp-2 text-[11px] leading-relaxed text-gray-500">{factor.summary}</p>
        </div>
      ))}
    </div>
  </div>
);

const AbilityBreakdownCard = ({ detail }) => {
  const components = detail?.components ?? [];
  if (!detail || !components.length) return null;

  return (
    <div className={`mt-4 ${GLASS.inner} p-4`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Ability Detail</div>
          <p className="mt-1 text-[11px] leading-relaxed text-gray-500">{detail.summary}</p>
        </div>
        <Num className={`shrink-0 text-[22px] font-bold leading-none ${scoreTone(detail.score)}`}>{detail.score}</Num>
      </div>
      <div className="mt-4 grid gap-2.5 md:grid-cols-2">
        {components.map((component) => (
          <div key={component.key} className="rounded-2xl border border-gray-200 bg-white p-3 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[12px] font-semibold text-slate-900">{component.label}</div>
                <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-gray-500">{component.summary}</p>
              </div>
              <Num className={`shrink-0 text-[18px] font-bold leading-none ${scoreTone(component.score)}`}>
                {isFiniteNumber(component.score) ? component.score : "—"}
              </Num>
            </div>
            {isFiniteNumber(component.score) && (
              <div className="mt-2">
                <AnimatedBar value={component.score} trackClass="bg-gray-100" />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

const CONF_STARS = { high: 4, mid: 3, low: 2 };
const ConfidenceIndicator = ({ level }) => {
  const c = CONFIDENCE[level];
  return (
    <div className="flex items-center gap-1.5" title={c.note}>
      <span className="text-[11px] text-gray-500">分析信頼度</span>
      <StarRating value={CONF_STARS[level]} size={10} />
      <span className="text-[11px] font-medium text-gray-700">{c.label}</span>
    </div>
  );
};

const SectionLabel = ({ icon: Icon, children }) => (
  <h4 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
    {Icon && <Icon size={12} strokeWidth={1.75} className="shrink-0 text-teal-500/60" />}
    {children}
  </h4>
);

const ProsConsList = ({ pros, cons }) => (
  <div className="grid gap-5 sm:grid-cols-2">
    <div>
      <SectionLabel>評価ポイント</SectionLabel>
      <ul className="mt-2 space-y-2">
        {pros.map((p, i) => (
          <li key={i} className="flex gap-2 text-[13px] leading-relaxed text-gray-700">
            <span className="mt-0.5 shrink-0 font-semibold text-emerald-600">＋</span>
            {p}
          </li>
        ))}
      </ul>
    </div>
    <div>
      <SectionLabel>注意ポイント</SectionLabel>
      <ul className="mt-2 space-y-2">
        {cons.map((c, i) => (
          <li key={i} className="flex gap-2 text-[13px] leading-relaxed text-gray-700">
            <span className="mt-0.5 shrink-0 font-semibold text-gray-500">−</span>
            {c}
          </li>
        ))}
      </ul>
    </div>
  </div>
);

/* ---- ファクター比較テーブル: 横=馬 / 縦=ファクター、行ごとの上位だけを静かに強調 ---- */
const ComparisonTable = ({ horses, evMap, onSelect }) => {
  const sorted = [...horses].sort((a, b) => b.aiScore - a.aiScore);
  const cellValue = (d, h) =>
    d.type === "ev"
      ? evMap[h.id]?.ev ?? 0
      : d.type === "pedigree"
        ? pedigreeIndex(h.analysis.pedigree)
        : h.analysis.factors[d.key];
  const rowLeaders = useMemo(() => {
    const leaders = {};
    for (const d of COMPARE_DEFS) {
      const values = sorted
        .map((h) => ({ id: h.id, value: cellValue(d, h) }))
        .filter((item) => Number.isFinite(item.value));
      const ordered = values.sort((a, b) => b.value - a.value);
      leaders[d.key] = new Set(ordered.slice(0, d.type === "ev" ? 1 : 2).map((item) => item.id));
    }
    return leaders;
  }, [sorted, evMap]);
  return (
    <section className="mt-7">
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-slate-400">Runner Matrix</div>
          <h2 className="mt-1 text-[18px] font-bold tracking-tight text-slate-950">ファクター比較</h2>
        </div>
        <span className="hidden text-right text-[11px] text-slate-400 md:block">行ごとの上位のみ強調</span>
      </div>
      <div className="mt-5 grid gap-3 md:hidden">
        {sorted.map((h) => {
          const factors = commandFactors(h, evMap[h.id]);
          return (
            <button
              key={h.id}
              onClick={() => onSelect(h)}
              className={`${GLASS.surface} ${GLASS.interactive} p-4 text-left`}
              aria-label={`${h.name}の詳細`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-2xl border border-gray-200 bg-white">
                      <Num className="text-[12px] font-bold text-slate-600">{h.number}</Num>
                    </span>
                    <span className="truncate text-[16px] font-bold text-slate-950">{h.name}</span>
                  </div>
                  <div className="mt-1.5 text-[11px] font-medium text-slate-400">
                    {h.jockey} ・ <Num>{h.popularity}</Num>人気
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">TM INDEX</div>
                  <Num className={`mt-1 block text-[36px] font-bold leading-none ${scoreTone(h.aiScore)}`}>
                    {h.aiScore}
                  </Num>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                {factors.map((f) => (
                  <div key={f.key} className="rounded-[1.15rem] border border-gray-200 bg-white p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-semibold text-slate-400">{f.label}</span>
                      <Num className="text-[14px] font-bold text-slate-800">{f.value}</Num>
                    </div>
                    <div className="mt-2 h-1 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-slate-700/75" style={{ width: `${f.value}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </button>
          );
        })}
      </div>
      <div className={`mt-4 hidden overflow-x-auto ${GLASS.surface} p-0 md:block`}>
        <table
          className="border-collapse text-center"
          style={{ minWidth: `${112 + sorted.length * 76}px`, width: "100%" }}
        >
          <thead>
            <tr className="border-b border-gray-200">
              <th className="sticky left-0 z-10 bg-white px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-400">
              </th>
              {sorted.map((h) => (
                <th key={h.id} className="px-2 py-3">
                  <button
                    onClick={() => onSelect(h)}
                    className="mx-auto flex w-full flex-col items-center gap-1.5"
                    aria-label={`${h.name}の詳細`}
                  >
                    <span className="text-[10px] font-semibold text-slate-300">
                      <Num>{h.number}</Num>
                    </span>
                    <span className="w-[68px] truncate text-[10px] font-semibold leading-tight text-slate-700">
                      {h.name}
                    </span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {COMPARE_DEFS.map((d) => (
              <tr key={d.key} className="border-b border-gray-100 last:border-b-0">
                <th className="sticky left-0 z-10 whitespace-nowrap bg-white px-4 py-3 text-left text-[11px] font-medium text-slate-500">
                  {d.label}
                </th>
                {sorted.map((h) => {
                  const v = cellValue(d, h);
                  const highlighted = rowLeaders[d.key]?.has(h.id);
                  const isEvBreakout = d.type === "ev" && v >= 1.15;
                  return (
                    <td key={h.id} className="px-1 py-1">
                      <div
                        className={`mx-auto flex h-9 min-w-[68px] items-center justify-center rounded-lg ${
                          highlighted ? "bg-teal-50" : "bg-transparent"
                        }`}
                      >
                        <Num
                          className={`text-[13px] ${
                            isEvBreakout
                              ? "font-bold text-[#00A9B8]"
                              : highlighted
                                ? "font-bold text-slate-950"
                                : "font-medium text-slate-500"
                          }`}
                        >
                          {d.type === "ev" ? v.toFixed(2) : v}
                        </Num>
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[11px] text-gray-500">
        期待値は推定勝率×単勝オッズ(1.00が損益分岐)。<span className="font-semibold text-[#00A9B8]">1.15以上のみ点灯</span> — 色は意味があるときだけ。
      </p>
    </section>
  );
};

/* ---- 期待値評価: 人気ではなく期待値で読む、というサービス思想の中核カード ---- */
const ValueCard = ({ ev, rank, popularity }) => {
  if (!ev) return null;
  const vs = valueStars(ev.ev);
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 md:p-5">
      <div className="flex items-center justify-between">
        <SectionLabel icon={TrendingUp}>TM Value — 期待値評価</SectionLabel>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
            ev.verdict.tone === "blue" ? "bg-white text-teal-700 ring-1 ring-gray-200" : "bg-gray-100 text-gray-500"
          }`}
        >
          {ev.verdict.label}
        </span>
      </div>
      <div className="mt-3 flex items-center gap-2.5">
        <StarRating value={vs} size={18} />
        <Num className="text-[13px] font-bold text-gray-900">{vs}.0</Num>
        <span className="text-[11px] text-gray-500">/ 5</span>
      </div>
      <div className="mt-4 flex flex-wrap items-end gap-x-7 gap-y-3 border-t border-gray-100 pt-3.5">
        <div>
          <Num className={`block text-[24px] font-bold leading-none tracking-tight ${evTone(ev.ev)}`}>
            {ev.ev.toFixed(2)}
          </Num>
          <span className="mt-1.5 block text-[10px] text-gray-500">単勝期待値</span>
        </div>
        <div>
          <Num className="block text-[16px] font-semibold leading-none text-gray-800">
            {(ev.prob * 100).toFixed(1)}%
          </Num>
          <span className="mt-1.5 block text-[10px] text-gray-500">推定勝率</span>
        </div>
        <div>
          <span className="block text-[13px] font-semibold leading-none text-gray-800">
            指数<Num>{rank}</Num>位 / <Num>{popularity}</Num>人気
          </span>
          <span className="mt-1.5 block text-[10px] text-gray-500">市場評価との乖離</span>
        </div>
      </div>
      <p className="mt-3.5 text-[11px] leading-relaxed text-gray-500">
        推定勝率 × 単勝オッズで算出。<span className="font-medium text-gray-500">1.00が損益分岐の目安</span>です。
        本サービスは人気ではなく、期待値を分析します。
      </p>
    </div>
  );
};

/* ---- 血統評価: 4ライン分析(父系/母父系/母母父系/牝系) ---- */
const PedigreeCard = ({ pedigree }) => {
  const idx = pedigreeIndex(pedigree);
  const structure = pedigree?.structure ?? {};
  const raceBias = pedigree?.raceBias;
  const strengthLabel = (score) => (score >= 86 ? "強み" : score >= 76 ? "標準以上" : "補助材料");
  const focusScores = [
    { key: "stamina", label: "スタミナ" },
    { key: "sustain", label: "持続力" },
    { key: "speed", label: "スピード" },
    { key: "burst", label: "瞬発力" },
  ];
  const lineGroups = [
    { label: "父系", value: structure.sireLine },
    { label: "母系", value: structure.damLine },
    { label: "母父", value: structure.bmsLine },
    { label: "牝系", value: structure.familyLine },
  ];

  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-4 md:p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <SectionLabel icon={Dna}>血統評価(4ライン)</SectionLabel>
          <p className="mt-1.5 text-[11px] leading-relaxed text-gray-500">
            {pedigree.headline ?? "4代血統から父系・母系・母父・牝系を分解し、距離適性や持続力の補助評価に接続。"}
          </p>
        </div>
        <span className="flex shrink-0 items-baseline gap-1">
          <Num className={`text-sm font-semibold ${scoreTone(idx)}`}>{idx}</Num>
          <span className="text-[10px] text-gray-500">血統指数</span>
        </span>
      </div>

      {raceBias ? (
        <div className="mt-4 rounded-lg border border-gray-200 bg-white px-3 py-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[12px] font-semibold text-slate-900">血統適合</span>
            <span className="text-[10px] font-semibold text-teal-700">{raceBias.grade}</span>
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">{raceBias.summary}</p>
          {raceBias.matched?.length ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {raceBias.matched.map((item) => (
                <span key={item.key} className="rounded-full border border-gray-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-600">
                  {item.label}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {pedigree.strengths?.length ? (
        <div className="mt-4 grid gap-2">
          {pedigree.strengths.map((item) => (
            <div key={item.label} className="rounded-lg border border-gray-200 bg-white px-3 py-2.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[12px] font-semibold text-slate-900">{item.label}</span>
                <span className="text-[10px] font-semibold text-slate-600">{strengthLabel(item.score)}</span>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{item.text}</p>
            </div>
          ))}
        </div>
      ) : null}

      <div className="mt-4 grid grid-cols-2 gap-2.5">
        {focusScores.map((d, i) => (
          <div key={d.key} className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
            <div className="flex items-baseline justify-between">
              <span className="text-[10px] font-semibold tracking-wide text-gray-500">{d.label}</span>
              <Num className={`text-[15px] font-semibold ${scoreTone(pedigree.scores[d.key])}`}>
                {pedigree.scores[d.key]}
              </Num>
            </div>
            <div className="mt-2 flex">
              <AnimatedBar
                value={pedigree.scores[d.key]}
                delay={i * 45}
                heightClass="h-1"
                trackClass="bg-gray-200/70"
              />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 space-y-2.5">
        {pedigree.lines.map((l) => (
          <div key={l.role} className="rounded-lg border border-gray-200 bg-white p-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[10px] font-semibold tracking-wide text-gray-500">{l.role}</span>
              <span className="min-w-0 truncate text-right text-[12px] font-semibold text-gray-900">{l.name}</span>
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-gray-500">{l.note}</p>
          </div>
        ))}
      </div>

      {lineGroups.some((group) => group.value?.length) ? (
        <div className="mt-4 border-t border-gray-200/70 pt-3.5">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] font-semibold tracking-wide text-gray-500">4代接続</span>
            <span className="text-[10px] text-gray-500">
              {structure.ancestorCount ?? "-"} 要素 / {structure.completeness ?? "一部取得"}
            </span>
          </div>
          <div className="grid gap-2">
            {lineGroups.map((group) =>
              group.value?.length ? (
                <div key={group.label} className="flex gap-2 text-[11px] leading-relaxed">
                  <span className="w-9 shrink-0 font-semibold text-gray-500">{group.label}</span>
                  <span className="min-w-0 text-gray-600">{group.value.slice(0, 5).join(" → ")}</span>
                </div>
              ) : null
            )}
          </div>
        </div>
      ) : null}

      <div className="mt-4 grid grid-cols-3 gap-x-4 gap-y-3 border-t border-gray-200/70 pt-3.5">
        {PEDIGREE_SCORE_DEFS.map((d, i) => (
          <div key={d.key}>
            <div className="flex items-baseline justify-between">
              <span className="text-[10px] text-gray-500">{d.label}</span>
              <Num className={`text-[12px] font-semibold ${scoreTone(pedigree.scores[d.key])}`}>
                {pedigree.scores[d.key]}
              </Num>
            </div>
            <div className="mt-1 flex">
              <AnimatedBar
                value={pedigree.scores[d.key]}
                delay={i * 40}
                heightClass="h-1"
                trackClass="bg-gray-200/70"
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

/* ---- 調教評価カード: 「一週前重視・最終追いは確認材料」の思想を文言で明示 ---- */
const formatTrainingPoint = (item) => {
  if (!item) return "時計未取得";
  const type = item.type === "wood" ? "ウッド" : "坂路";
  const course = item.course ? `${item.course}` : type;
  return `${item.date ?? "日付不明"} ${course} 4F${item.f4 ?? "-"} / 1F${item.f1 ?? "-"}`;
};

const TrainingEvalCard = ({ evalData }) => {
  const details = evalData.details ?? {};
  const strengths = details.strengths ?? [];
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-4 md:p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <SectionLabel icon={Dumbbell}>調教評価</SectionLabel>
          <p className="mt-1.5 text-[11px] leading-relaxed text-gray-500">
            坂路/ウッドの基準時計、終い1F、加速ラップ、最終追切を分けて評価。
          </p>
        </div>
        <span className="flex shrink-0 items-baseline gap-1">
          <Num className="text-lg font-semibold text-gray-900">{evalData.grade}</Num>
          <span className="text-[10px] text-gray-500">総合</span>
        </span>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <div className="rounded-lg border border-gray-200 bg-white p-2.5">
          <div className="text-[10px] font-semibold text-gray-500">時計本数</div>
          <Num className="mt-1 block text-[16px] font-bold text-slate-900">{details.count ?? 0}</Num>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-2.5">
          <div className="text-[10px] font-semibold text-gray-500">終い基準</div>
          <Num className="mt-1 block text-[16px] font-bold text-emerald-600">{details.fastFinish ?? 0}</Num>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-2.5">
          <div className="text-[10px] font-semibold text-gray-500">加速ラップ</div>
          <Num className="mt-1 block text-[16px] font-bold text-emerald-600">{details.accelCount ?? 0}</Num>
        </div>
      </div>

      <div className="mt-3 space-y-3">
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-semibold text-gray-900">調教の強み</span>
              <span className="rounded bg-teal-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">主要評価</span>
            </div>
            <Num className={`text-sm font-semibold ${scoreTone(evalData.oneWeek.score)}`}>
              {evalData.oneWeek.score}
            </Num>
          </div>
          <div className="mt-2 space-y-1.5">
            {strengths.length ? strengths.map((text) => (
              <div key={text} className="text-[12px] leading-relaxed text-gray-600">・{text}</div>
            )) : (
              <p className="text-[12px] leading-relaxed text-gray-600">{evalData.oneWeek.text}</p>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-medium text-gray-700">最終追切</span>
              <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">確認材料</span>
            </div>
            <span className="text-[12px] font-medium text-gray-600">{evalData.final.status}</span>
          </div>
          <p className="mt-1.5 text-[12px] leading-relaxed text-gray-600">{evalData.final.text}</p>
          {details.final ? (
            <div className="mt-2 rounded-md bg-gray-50 px-2.5 py-2 text-[11px] text-gray-500">
              {formatTrainingPoint(details.final)}
            </div>
          ) : null}
          {details.lightAfterFinal ? (
            <div className="mt-2 rounded-md bg-amber-50/70 px-2.5 py-2 text-[11px] text-amber-700">
              直前軽め: {formatTrainingPoint(details.lightAfterFinal)}
            </div>
          ) : null}
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-medium text-gray-700">ベスト時計</span>
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                evalData.stablePattern.match ? "bg-white text-teal-700 ring-1 ring-gray-200" : "bg-gray-100 text-gray-500"
              }`}
            >
              {evalData.stablePattern.match ? "強調材料" : "参考材料"}
            </span>
          </div>
          <p className="mt-1.5 text-[12px] leading-relaxed text-gray-600">{evalData.stablePattern.text}</p>
          {details.best ? (
            <div className="mt-2 rounded-md bg-gray-50 px-2.5 py-2 text-[11px] text-gray-500">
              {formatTrainingPoint(details.best)}
            </div>
          ) : null}
        </div>
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-gray-500">
        評価方針: 軽めの時計を平均せず、基準を超えた時計・終いの反応・加速ラップを重視します。
      </p>
    </div>
  );
};

/* ---- 馬詳細の中身(モバイルシート / PCインライン展開で共有) ---- */
const StatusChip = ({ children, tone = "slate" }) => (
  <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${
    tone === "ok"
      ? "border-gray-200 bg-white text-emerald-700"
      : tone === "wait"
        ? "border-gray-200 bg-white text-amber-700"
        : "border-gray-200 bg-white text-slate-500"
  }`}>
    {children}
  </span>
);

const HorseDataPreviewContent = ({ horse }) => {
  const current = horse.currentRace ?? {};
  const pastRuns = horse.pastRuns ?? [];
  const slope = horse.training?.slope ?? [];
  const wood = horse.training?.wood ?? [];
  const pedigree = horse.pedigreeRaw;
  const trainingMissing = horse.dataStatus?.training === "missing";

  return (
    <div className="space-y-5">
      <GlassPanel>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Current Race</div>
            <h3 className="mt-2 text-[18px] font-bold text-slate-950">{displayHorseName(horse)}</h3>
          </div>
          <StatusChip tone="wait">AI分析準備中</StatusChip>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 text-[12px] md:grid-cols-4">
          {[
            ["馬番", current.horseNumber],
            ["性齢", current.sexAge],
            ["斤量", current.carriedWeight],
            ["騎手", current.jockey],
            ["調教師", `${current.stableSide ?? ""}${current.trainer ?? ""}`],
            ["レース", `${current.course ?? ""}${current.raceNo ?? ""}R`],
            ["条件", `${current.surface ?? ""}${current.distance ?? ""}m`],
            ["オッズ", "発売前"],
          ].map(([label, value]) => (
            <div key={label} className={`${GLASS.inner} p-3`}>
              <div className="text-[10px] font-semibold text-slate-400">{label}</div>
              <div className="mt-1 font-bold text-slate-900">{displayRaceValue(value)}</div>
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <StatusChip tone="ok">過去走 {pastRuns.length}件</StatusChip>
          <StatusChip tone={trainingMissing ? "wait" : "ok"}>
            {trainingMissing ? "調教データ不足" : `調教 ${slope.length + wood.length}件`}
          </StatusChip>
          <StatusChip tone={pedigree ? "ok" : "wait"}>{pedigree ? "4代血統取得済み" : "血統未取得"}</StatusChip>
          <StatusChip tone="wait">TM INDEX 未評価</StatusChip>
          <StatusChip tone="wait">TM VALUE 未評価</StatusChip>
        </div>
      </GlassPanel>

      <GlassPanel>
        <SectionLabel icon={Activity}>Past Runs</SectionLabel>
        <div className="mt-4 space-y-2">
          {pastRuns.slice(0, 8).map((run, index) => (
            <div key={`${run.date}-${run.raceName}-${index}`} className="grid grid-cols-[5.5rem_1fr_auto] gap-3 rounded-2xl border border-gray-200 bg-white px-3 py-2 text-[12px]">
              <Num className="text-slate-500">{run.date}</Num>
              <span className="min-w-0 truncate font-semibold text-slate-800">{run.course} {run.raceName}</span>
              <span className="text-right text-slate-500">{run.surface}<Num>{run.distance}</Num>m / <Num>{run.finishPosition}</Num>着</span>
            </div>
          ))}
        </div>
      </GlassPanel>

      <GlassPanel>
        <SectionLabel icon={Dumbbell}>Training</SectionLabel>
        {trainingMissing ? (
          <p className="mt-3 text-[13px] text-slate-500">TARGETに調教データがありません。</p>
        ) : (
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {slope.slice(0, 3).map((item, index) => (
              <div key={`slope-${index}`} className={`${GLASS.inner} p-3 text-[12px]`}>
                <div className="font-bold text-slate-900">坂路 {item.date}</div>
                <div className="mt-1 text-slate-500">4F <Num>{item["4F"]}</Num> / 1F <Num>{item["1F"]}</Num></div>
              </div>
            ))}
            {wood.slice(0, 3).map((item, index) => (
              <div key={`wood-${index}`} className={`${GLASS.inner} p-3 text-[12px]`}>
                <div className="font-bold text-slate-900">{item.course} {item.date}</div>
                <div className="mt-1 text-slate-500">6F <Num>{item.times?.["6F"] ?? "—"}</Num> / 1F <Num>{item.times?.["1F"] ?? "—"}</Num></div>
              </div>
            ))}
          </div>
        )}
      </GlassPanel>

      <GlassPanel>
        <SectionLabel icon={Dna}>Pedigree</SectionLabel>
        {pedigree ? (
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {[
              ["父", pedigree.sire],
              ["母", pedigree.dam],
              ["母父", pedigree.broodmareSire],
              ["牝系", pedigree.damDam],
            ].map(([label, value]) => (
              <div key={label} className={`${GLASS.inner} p-3 text-[12px]`}>
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">{label}</div>
                <div className="mt-1 font-bold text-slate-900">{value ?? "未取得"}</div>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-[13px] text-slate-500">血統データ未取得</p>
        )}
      </GlassPanel>
    </div>
  );
};

const HorseDetailContent = ({ horse, rank, fieldSize, ev, compactHeader = false, skipLeadInsight = false }) => {
  const a = horse.analysis;
  if (!isEvaluatedHorse(horse) || !a?.factors) return <HorseDataPreviewContent horse={horse} />;
  const tier = scoreTier(horse.aiScore);
  const bd = scoreBreakdown(horse);
  const insights = skipLeadInsight ? a.insight.slice(1) : a.insight;
  return (
    <div className="space-y-7">
      {/* TM INDEX — 指数のブランドブロック */}
      <GlassPanel className="relative overflow-hidden">
        <div className="relative">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">
            {compactHeader ? "TM INDEX Evidence" : "TURF MATRIX INDEX"}
          </span>
          {ev && (
            <span className="flex items-center gap-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">TM Value</span>
              <StarRating value={valueStars(ev.ev)} size={11} />
            </span>
          )}
        </div>
        <div className={compactHeader ? "mt-3 flex flex-wrap items-center gap-2" : "mt-3 flex items-end justify-between gap-4"}>
          {!compactHeader && (
            <div className="flex items-baseline gap-2">
              <Num className={`text-[52px] font-bold leading-none tracking-tight md:text-[56px] ${scoreTone(horse.aiScore)}`}>
                {horse.aiScore}
              </Num>
              <span className="text-xs text-gray-500">/ 100</span>
            </div>
          )}
          <div className="flex flex-col items-end gap-1.5 pb-1">
            {rank != null && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-600">
                Rank <Num className="font-bold text-teal-600">{rank}</Num>
                <span className="text-gray-500">/ {fieldSize}頭</span>
              </span>
            )}
            <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[11px] font-medium text-gray-600">
              <Num className="font-bold text-slate-950">
                {tier.label}
              </Num>
              {tier.text}
            </span>
          </div>
        </div>

        {/* なぜこの指数なのか — 内訳の開示 */}
        <div className={`mt-4 ${GLASS.inner} p-4`}>
          <div className="flex items-baseline justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">指数の根拠</span>
            <span className="text-[10px] text-gray-500">ファクター × 重みの寄与</span>
          </div>
          <div className="mt-2.5 grid grid-cols-2 gap-x-6 gap-y-1.5 md:grid-cols-4">
            {bd.items.map((it) => (
              <div key={it.label} className="flex items-baseline justify-between text-[12px]">
                <span className="text-gray-500">{it.label}</span>
                <Num className="font-semibold text-gray-800">+{it.value}</Num>
              </div>
            ))}
          </div>
          <div className="mt-2.5 space-y-1 border-t border-gray-100 pt-2">
            <div className="flex items-baseline justify-between text-[12px]">
              <span className="text-gray-500">総合補正(相手関係など)</span>
              <Num className="text-gray-500">{bd.adjust >= 0 ? `+${bd.adjust}` : bd.adjust}</Num>
            </div>
            <div className="flex items-baseline justify-between text-[12px]">
              <span className="font-medium text-gray-700">合計 TM INDEX</span>
              <Num className="font-bold text-gray-900">{horse.aiScore}</Num>
            </div>
          </div>
        </div>

        <TMFactorsCard />

        <AbilityBreakdownCard detail={a.factorsDetail?.ability} />

        {/* 信頼度は必ず理由とセットで */}
        <div className={`mt-3 ${GLASS.inner} p-4`}>
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">分析信頼度</span>
            <span className="flex items-center gap-1.5">
              <StarRating value={confidenceStars(a)} size={11} />
              <span className="text-[11px] font-medium text-gray-700">{CONFIDENCE[a.confidence].label}</span>
            </span>
          </div>
          <ul className="mt-2 space-y-1">
            {(a.confidenceReasons ?? [CONFIDENCE[a.confidence].note]).map((t, i) => (
              <li key={i} className="flex gap-2 text-[12px] leading-relaxed text-gray-600">
                <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-gray-300" />
                {t}
              </li>
            ))}
          </ul>
        </div>
        </div>
      </GlassPanel>

      {/* AI Insight — AIが今回最も伝えたいこと */}
      {insights.length > 0 && (
        <GlassPanel className="relative overflow-hidden">
          <div className="relative">
          <div className="flex items-center gap-1.5">
            <Sparkles size={13} strokeWidth={1.75} className="text-slate-400" />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              {skipLeadInsight ? "AI Insight Details" : "AI Insight"}
            </span>
          </div>
          <ul className="mt-3 space-y-2">
            {insights.map((t, i) => (
              <li key={i} className="flex gap-2.5 text-[13px] leading-relaxed text-gray-700">
                <span className="mt-[8px] h-1 w-1 shrink-0 rounded-full bg-slate-300" />
                {t}
              </li>
            ))}
          </ul>
          </div>
        </GlassPanel>
      )}

      {/* 期待値評価(自動計算) */}
      <ValueCard ev={ev} rank={rank} popularity={horse.popularity} />

      <TagList tags={a.tags} />

      {/* 横バー型ファクター(血統は9項目から自動算出) */}
      <div>
        <SectionLabel icon={Activity}>ファクター指数</SectionLabel>
        <div className="mt-4 space-y-3">
          {FACTOR_DEFS.map((f, i) => (
            <FactorBar
              key={f.key}
              icon={f.icon}
              label={f.label}
              value={f.derived ? pedigreeIndex(a.pedigree) : a.factors[f.key]}
              delay={i * 60}
            />
          ))}
        </div>
      </div>

      {/* 血統評価(4ライン) */}
      <PedigreeCard pedigree={a.pedigree} />

      <ProsConsList pros={a.pros} cons={a.cons} />

      {/* AI総評 */}
      <div>
        <SectionLabel icon={MessageSquare}>AI総評</SectionLabel>
        <p className="mt-2.5 text-[13px] leading-[1.95] text-gray-700">{a.commentary}</p>
      </div>

      {/* 枠順評価 */}
      <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-4 md:p-5">
        <div className="flex items-center justify-between">
          <SectionLabel icon={LayoutGrid}>枠順評価</SectionLabel>
          <Num className={`text-sm font-semibold ${scoreTone(a.frameEval.score)}`}>{a.frameEval.score}</Num>
        </div>
        <div className="mt-2.5 flex">
          <AnimatedBar value={a.frameEval.score} trackClass="bg-gray-200/70" />
        </div>
        <p className="mt-2.5 text-[12px] leading-relaxed text-gray-600">{a.frameEval.text}</p>
      </div>

      <TrainingEvalCard evalData={a.trainingEval} />
    </div>
  );
};

/* ---- モバイル: ボトムシート ----
 * スクロール対策:
 *  - 100vh問題: max-heightをdvh(fallback vh)で指定(.tm-sheet)
 *  - iOS慣性スクロール: -webkit-overflow-scrolling:touch(.tm-sheet)
 *  - 背面スクロール連鎖: overscroll-behavior:contain(.tm-sheet)
 *  - iOS Safariのbodyスクロール貫通: position:fixedロック + 位置復元
 */
const BottomSheet = ({ horse, rank, fieldSize, ev, onClose }) => {
  const sheetRef = useRef(null);
  const sheetBodyRef = useRef(null);
  const touchStartYRef = useRef(0);

  /* bodyスクロールロック(iOS対応: position:fixed方式 + スクロール位置復元) */
  useEffect(() => {
    const y = window.scrollY;
    const { style } = document.body;
    const htmlStyle = document.documentElement.style;
    const prev = {
      position: style.position, top: style.top, left: style.left,
      right: style.right, width: style.width, overflow: style.overflow,
      overscrollBehavior: style.overscrollBehavior,
      touchAction: style.touchAction,
    };
    const prevHtml = {
      overflow: htmlStyle.overflow,
      overscrollBehavior: htmlStyle.overscrollBehavior,
      touchAction: htmlStyle.touchAction,
    };
    const keepTouchInsideSheetBody = (e) => {
      const sheet = sheetRef.current;
      const sheetBody = sheetBodyRef.current;
      if (!sheet || !sheet.contains(e.target)) {
        e.preventDefault();
        return;
      }

      if (!sheetBody || !sheetBody.contains(e.target)) {
        e.preventDefault();
        return;
      }

      const currentY = e.touches?.[0]?.clientY ?? touchStartYRef.current;
      const deltaY = currentY - touchStartYRef.current;
      const atTop = sheetBody.scrollTop <= 0;
      const atBottom = sheetBody.scrollTop + sheetBody.clientHeight >= sheetBody.scrollHeight - 1;

      if ((atTop && deltaY > 0) || (atBottom && deltaY < 0)) {
        e.preventDefault();
      }
    };
    const rememberTouchStart = (e) => {
      touchStartYRef.current = e.touches?.[0]?.clientY ?? 0;
    };
    style.position = "fixed";
    style.top = `-${y}px`;
    style.left = "0";
    style.right = "0";
    style.width = "100%";
    style.overflow = "hidden";
    style.overscrollBehavior = "none";
    htmlStyle.overflow = "hidden";
    htmlStyle.overscrollBehavior = "none";
    document.addEventListener("touchstart", rememberTouchStart, { passive: true });
    document.addEventListener("touchmove", keepTouchInsideSheetBody, { passive: false });
    return () => {
      document.removeEventListener("touchstart", rememberTouchStart);
      document.removeEventListener("touchmove", keepTouchInsideSheetBody);
      Object.assign(style, prev);
      Object.assign(htmlStyle, prevHtml);
      window.scrollTo(0, y);
    };
  }, []);

  /* Escで閉じる */
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!horse) return null;
  const insightLead = horse.analysis?.insight?.[0];
  const command = commandFactors(horse, ev);
  const confidence = confidenceMeta(horse.analysis?.confidence);

  const modal = (
    <div className="tm-modal-root fixed inset-0 z-[9999] overflow-hidden overscroll-none" role="dialog" aria-modal="true" aria-label={`${displayHorseName(horse)}の分析詳細`}>
      <div className="tm-fade absolute inset-0 bg-slate-900/15" onClick={onClose} />
      <div ref={sheetRef} className="tm-slideup tm-sheet absolute inset-x-0 bottom-0 flex flex-col overflow-hidden rounded-t-[2rem] border-t border-gray-200 bg-white shadow-sm">
        <div className="shrink-0 overflow-hidden border-b border-gray-200 bg-white px-5 pb-5 pt-2.5">
          <div className="relative">
            <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-gray-200" />
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="mb-3 text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-400">Top Signal</div>
                <div className="flex items-center gap-2">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-gray-200 bg-white shadow-sm">
                    <Num className="text-[15px] font-bold text-slate-700">{horse.number}</Num>
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-[15px] font-bold leading-tight tracking-tight text-slate-950">{displayHorseName(horse)}</div>
                    <div className="mt-1 text-[11px] font-medium text-slate-500">
                      {displayJockeyName(horse)} ・ 人気 <Num>{displayPopularity(horse.popularity)}</Num> ・ 単勝 <Num>{displayOdds(horse.odds)}</Num>
                    </div>
                  </div>
                </div>
              </div>
              <button
                onClick={onClose}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-gray-200 bg-white text-slate-500 shadow-sm transition-colors hover:bg-white hover:text-slate-600 active:bg-gray-100"
                aria-label="閉じる"
              >
                <X size={18} strokeWidth={1.75} />
              </button>
            </div>
          </div>
        </div>

        <div
          ref={sheetBodyRef}
          className="tm-sheet-body min-h-0 flex-1 overflow-y-auto px-5 pt-5"
          style={{ paddingBottom: "calc(3.5rem + env(safe-area-inset-bottom))" }}
        >
          <div className="grid grid-cols-[1fr_auto] gap-4">
            <div>
              <div className="text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-400">TM INDEX</div>
              <AnimatedIndexValue
                value={horse.aiScore}
                className={`mt-3 block text-[48px] font-bold leading-none tracking-tight ${scoreTone(horse.aiScore)}`}
              />
              {isEvaluatedHorse(horse) ? <IndexUnderline /> : null}
            </div>
            <div className="min-w-[112px] rounded-[1.35rem] border border-gray-200 bg-white px-3 py-3 text-right">
              <div className="text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-400">TM VALUE</div>
              <div className={`mt-2 text-[18px] ${ev && ev.ev >= 1.15 ? "font-bold text-slate-900" : "text-gray-500"}`}>
                {ev ? (
                  <>
                    EV <Num>{ev.ev.toFixed(2)}</Num>
                  </>
                ) : (
                  "未評価"
                )}
              </div>
              {rank != null && (
                <div className="mt-1 text-[10px] text-gray-500">
                  Rank <Num>{rank}</Num> / {fieldSize}頭
                </div>
              )}
            </div>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-3">
            <div className={`${GLASS.inner} p-3.5`}>
              <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-400">Confidence</div>
              <div className="mt-2 text-[13px] font-bold text-slate-900">{confidence.label}</div>
            </div>
            <div className={`${GLASS.inner} p-3.5`}>
              <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-400">AI Verdict</div>
              <div className="mt-2 text-[13px] font-bold text-slate-900">{isEvaluatedHorse(horse) ? (horse.aiScore >= 80 ? "Positive" : "Watch") : "分析準備中"}</div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            {command.map((f) => (
              <div key={f.key} className="rounded-2xl border border-gray-200 bg-white p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-semibold text-slate-400">{f.label}</span>
                  <Num className="text-[15px] font-bold text-slate-800">{f.value ?? f.status ?? "未評価"}</Num>
                </div>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-slate-800/80" style={{ width: `${f.value ?? 0}%` }} />
                </div>
              </div>
            ))}
          </div>

          {insightLead && (
            <div className="mt-4 flex gap-2 rounded-2xl border border-gray-200 bg-white px-3.5 py-3 text-[12px] leading-relaxed text-slate-600">
              <Sparkles size={14} strokeWidth={1.75} className="mt-[3px] shrink-0 text-slate-400" />
              <span className="line-clamp-2">{insightLead}</span>
            </div>
          )}

          <HorseDetailContent
            horse={horse}
            rank={rank}
            fieldSize={fieldSize}
            ev={ev}
            compactHeader
            skipLeadInsight
          />
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
};

/* ---- 出走馬の1行(クリックで詳細) ---- */
const HorseRow = ({ horse, rank, fieldSize, ev, expanded, onToggle, isDesktop }) => (
  <div className="border-b border-gray-200 last:border-b-0">
    <button
      onClick={onToggle}
      aria-expanded={expanded}
      className={`block w-full px-4 py-4 text-left transition-colors duration-150 hover:bg-gray-50 active:bg-gray-100/60 md:grid md:grid-cols-[2.5rem_1.4fr_1fr_4rem_4.5rem_4rem_1.6fr] md:items-center md:gap-x-3 md:px-5 md:py-3.5 ${
        expanded ? "bg-gray-50" : "bg-white"
      }`}
    >
      <span className="md:contents">
        <span className="flex items-start justify-between gap-3 md:contents">
          <span className="flex min-w-0 items-start gap-3 md:contents">
            {/* 馬番 */}
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-gray-200 bg-white shadow-sm md:h-8 md:w-8 md:rounded-xl">
              <Num className="text-[13px] font-semibold text-gray-700">{horse.number}</Num>
            </span>

            {/* 馬名 + (モバイル: 騎手/人気/オッズ) */}
            <span className="min-w-0 md:block">
              <span className="block truncate text-[16px] font-bold text-slate-950 md:text-[14px]">
                {displayHorseName(horse)}
              </span>
              <span className="mt-1 block text-[11px] text-gray-500 md:hidden">
                {displayJockeyName(horse)} ・ 人気 <Num>{displayPopularity(horse.popularity)}</Num> ・ 単勝 <Num>{displayOdds(horse.odds)}</Num>
              </span>
            </span>
          </span>

          {/* AI指数(モバイルでは右端の主役) */}
          <span className="shrink-0 text-right md:hidden">
            <span className="block text-[10px] font-medium uppercase tracking-wider text-gray-500 md:hidden">
              TM INDEX
            </span>
            <Num className={`block text-[28px] font-bold leading-none tracking-tight ${scoreTone(horse.aiScore)}`}>
              {displayScore(horse.aiScore)}
            </Num>
          </span>
        </span>

        <span className="mt-3 flex items-center justify-between gap-3 border-t border-gray-200 pt-3 md:hidden">
          <span className="min-w-0">
            <span className="block text-[10px] font-medium uppercase tracking-wider text-gray-500">TM VALUE</span>
            <span
              className={`mt-0.5 block text-[12px] ${
                ev && ev.ev >= 1.15 ? "font-semibold text-teal-600" : "text-gray-500"
              }`}
            >
              {ev ? (
                <>
                  EV <Num>{ev.ev.toFixed(2)}</Num> ・ {starText(valueStars(ev.ev))}
                </>
              ) : (
                "未評価"
              )}
            </span>
          </span>
          <span className="inline-flex shrink-0 items-center gap-0.5 text-[11px] font-medium text-teal-600">
            詳細を見る
            <ChevronRight size={12} strokeWidth={1.75} />
          </span>
        </span>

        <span className="mt-2 block truncate text-[12px] text-gray-500 md:hidden">{horse.comment}</span>
      </span>

      {/* PC列: 騎手 / 人気 / オッズ+EV */}
      <span className="hidden truncate text-[13px] text-gray-600 md:block">{displayJockeyName(horse)}</span>
      <span className="hidden text-right md:block">
        {isFiniteNumber(horse.popularity) && horse.popularity > 0 ? (
          <>
            <Num className="text-[13px] text-gray-600">{horse.popularity}</Num>
            <span className="text-[11px] text-gray-500">人気</span>
          </>
        ) : (
          <span className="text-[12px] text-gray-400">発売前</span>
        )}
      </span>
      <span className="hidden text-right md:block">
        <Num className="block text-[13px] text-gray-600">{displayOdds(horse.odds)}</Num>
        {ev && (
          <Num
            className={`block text-[10px] leading-tight ${
              ev.ev >= 1.15 ? "font-semibold text-teal-600" : "text-gray-500"
            }`}
          >
            EV {ev.ev.toFixed(2)}
          </Num>
        )}
      </span>

      {/* PC列: AI指数 */}
      <span className="hidden text-right md:block">
        <Num className={`text-[19px] font-bold ${scoreTone(horse.aiScore)}`}>{displayScore(horse.aiScore)}</Num>
      </span>

      {/* PC列: 短評 */}
      <span className="hidden items-center justify-between gap-2 md:flex">
        <span className="truncate text-[12px] text-gray-500">{horse.comment}</span>
        <ChevronDown
          size={14}
          strokeWidth={1.75}
          className={`shrink-0 text-gray-300 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
        />
      </span>
    </button>

    {/* PC: インライン展開 */}
    {isDesktop && expanded && (
      <div className="tm-fadein border-t border-gray-100 bg-gray-50/40 px-5 py-7">
        <div className="mx-auto max-w-3xl">
          <HorseDetailContent horse={horse} rank={rank} fieldSize={fieldSize} ev={ev} />
        </div>
      </div>
    )}
  </div>
);

/* =====================================================================
 * [6] pages
 * ===================================================================== */

/* ---- トップページ ---- */
const RaceSignalCard = ({ race, onOpen, variant = "compact" }) => {
  const score = race.topHorse.available ? displayScore(race.topHorse.aiScore) : "--";
  const ev = race.topHorse.ev;
  const signalLabel = race.topHorse.available
    ? race.topHorse.aiScore >= 80
      ? `${race.topHorse.name} ${score}`
      : race.topHorse.name
    : WEEK_PREPARING_TEXT;

  return (
    <button
      onClick={() => onOpen(race.id)}
      className="group relative w-full overflow-hidden rounded-[18px] border border-[#DDE3EA] bg-white px-6 py-5 text-left shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors hover:border-[#CBD5E1] active:bg-[#F8FAFC]"
    >
      <div className="relative">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-3">
              <Num className="text-[17px] font-bold leading-none text-[#050B1E]">
                {displayRaceValue(race.time, "取得待ち")}
              </Num>
              <span className="truncate text-[16px] font-bold leading-none text-[#050B1E]">{race.name}</span>
              {race.grade ? (
                <span className="shrink-0 rounded-md border border-[#BFDBFE] bg-white px-2 py-0.5 text-[10px] font-bold text-[#2D7BFF]">
                  {race.grade}
                </span>
              ) : (
                <span className="shrink-0 rounded-md border border-[#E5E7EB] bg-white px-2 py-0.5 text-[10px] font-bold text-[#94A3B8]">
                  特別
                </span>
              )}
            </div>
            <div className="mt-2 text-[11px] font-medium text-[#94A3B8]">
              {race.track}<Num>{race.number}</Num>R
              <span className="mx-2 text-[#CBD5E1]"> </span>
              {race.surface}<Num>{race.distance}</Num>m
              <span className="mx-1">・</span>
              {displayRaceValue(race.going, "良")}
              {isFiniteNumber(race.fieldSize) ? (
                <>
                  <span className="mx-1">・</span>
                  <Num>{race.fieldSize}</Num>頭
                </>
              ) : null}
            </div>
          </div>
          <ChevronRight size={15} strokeWidth={1.8} className="mt-0.5 shrink-0 text-[#CBD5E1] transition-transform group-hover:translate-x-0.5" />
        </div>

        {race.topHorse.available ? (
          <div className="mt-4 border-t border-[#EDF0F3] pt-4">
            <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#00A9B8]">
              {score !== "--" && score < 80 ? "VALUE" : "INDEX"}
            </span>
            <span className="ml-2 text-[12px] font-semibold text-[#050B1E]">
              {signalLabel}
              {isFiniteNumber(ev) ? <Num className="text-[#00A9B8]"> — EV {ev.toFixed(2)}</Num> : null}
            </span>
          </div>
        ) : null}
      </div>
    </button>
  );
};

const raceTimeValue = (race) => {
  const [hour, minute] = String(race?.time ?? "").split(":").map((part) => Number(part));
  if (Number.isFinite(hour) && Number.isFinite(minute)) return hour * 60 + minute;
  return 24 * 60 + Number(race?.number ?? 0);
};

const sortRaceByTime = (a, b) =>
  raceTimeValue(a) - raceTimeValue(b) ||
  String(a.track ?? "").localeCompare(String(b.track ?? ""), "ja") ||
  Number(a.number ?? 0) - Number(b.number ?? 0);

const HomePage = ({ onOpenRace }) => {
  const [meta, setMeta] = useState(null);
  const [summary, setSummary] = useState(null);
  const [races, setRaces] = useState(null);
  const [featured, setFeatured] = useState(null);
  const [ranking, setRanking] = useState(null);

  useEffect(() => {
    dataProvider.getMeta().then(setMeta);
    dataProvider.getDailySummary().then(setSummary);
    dataProvider.getRaces().then(setRaces);
    dataProvider.getFeaturedHorses().then(setFeatured);
    dataProvider.getIndexRanking(5).then(setRanking);
  }, []);
  const featuredRace = useMemo(() => {
    if (!races?.length) return null;
    const raceWithData = races.filter((race) => race.topHorse.available);
    if (!raceWithData.length) return races.find((race) => race.featuredRace) ?? [...races].sort(sortRaceByTime)[0];
    return raceWithData.find((race) => race.featuredRace) ?? [...raceWithData].sort((a, b) => (b.topHorse.aiScore ?? 0) - (a.topHorse.aiScore ?? 0))[0];
  }, [races]);
  const visibleRaceCards = useMemo(
    () => [...(races ?? [])].sort(sortRaceByTime),
    [races]
  );
  const raceGroups = useMemo(() => {
    const available = races ?? [];
    const trackOrder = [...new Set(available.map((race) => race.track))];
    const groupByTrack = (items) =>
      trackOrder
        .map((track) => ({
          track,
          races: items.filter((race) => race.track === track).sort((a, b) => a.number - b.number),
        }))
        .filter((group) => group.races.length > 0);
    const special = available.filter((race) => gradeScore(race.grade) === 0 && race.category === "special");
    const standard = available.filter((race) => gradeScore(race.grade) === 0 && race.category !== "special");

    return {
      graded: available
        .filter((race) => gradeScore(race.grade) > 0)
        .sort((a, b) => Number(b.featuredRace) - Number(a.featuredRace) || (a.time ?? "").localeCompare(b.time ?? "")),
      special,
      standard,
      specialByTrack: groupByTrack(special),
      standardByTrack: groupByTrack(standard),
    };
  }, [races]);

  return (
    <main className="mx-auto max-w-5xl px-2.5 sm:px-5">
      {/* Hero */}
      <section className="relative mt-7 overflow-hidden rounded-[18px] border border-[#DDE3EA] bg-white px-6 pb-7 pt-7 shadow-[0_1px_2px_rgba(15,23,42,0.04)] md:mt-8 md:px-7">
        <div className="relative">
          {featuredRace ? (
            <>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.34em] text-[#A6AFBE]">Featured Race</div>
                <div className="mt-3 flex flex-wrap items-center gap-2.5">
                  <h1 className="text-[23px] font-bold leading-none tracking-tight text-[#050B1E]">{featuredRace.name}</h1>
                  {featuredRace.grade ? (
                    <span className="rounded-md border border-[#BFDBFE] bg-white px-2.5 py-1 text-[11px] font-bold leading-none text-[#2D7BFF]">
                      {featuredRace.grade}
                    </span>
                  ) : null}
                  <span className="rounded-md border border-[#E2E8F0] bg-white px-2.5 py-1 text-[10px] font-bold leading-none text-[#64748B]">
                    {featuredRace.track}<Num>{featuredRace.number}</Num>R
                  </span>
                </div>
                <div className="mt-3 text-[13px] font-medium text-[#64748B]">
                  {featuredRace.surface}<Num>{featuredRace.distance}</Num>m
                  <span className="mx-1.5">・</span>
                  {displayRaceValue(featuredRace.going, "良")}
                  {isFiniteNumber(featuredRace.fieldSize) ? (
                    <>
                      <span className="mx-1.5">・</span>
                      <Num>{featuredRace.fieldSize}</Num>頭
                    </>
                  ) : null}
                  <span className="mx-1.5">・</span>
                  発走 <Num>{displayRaceValue(featuredRace.time, "取得待ち")}</Num>
                </div>
              </div>
              <div className="mt-7 flex items-end justify-between gap-5">
                <div className="min-w-0">
                  <div className="text-[10px] font-bold uppercase tracking-[0.28em] text-[#A6AFBE]">
                    {featuredRace.topHorse.available ? "TM INDEX" : "TM INDEX"}
                  </div>
                  {featuredRace.topHorse.available ? (
                    <div className="mt-2 truncate text-[15px] font-bold leading-none text-[#050B1E]">{featuredRace.topHorse.name}</div>
                  ) : null}
                  <div className="mt-4 flex items-end gap-1.5">
                    {featuredRace.topHorse.available ? (
                      <AnimatedIndexValue
                        value={featuredRace.topHorse.aiScore}
                        className="block text-[64px] font-bold leading-[0.82] tracking-tight text-[#050B1E]"
                      />
                    ) : (
                      <Num className="block text-[64px] font-bold leading-[0.82] tracking-tight text-gray-300">--</Num>
                    )}
                    {featuredRace.topHorse.available ? <span className="pb-1 text-[16px] font-bold text-[#CBD5E1]">/100</span> : null}
                  </div>
                  {featuredRace.topHorse.available ? null : (
                    <div className="mt-3 text-xs font-medium text-gray-400">出走馬データ取得後に算出します</div>
                  )}
                  {isFiniteNumber(featuredRace.topHorse.aiScore) ? <IndexUnderline /> : null}
                </div>
                {featuredRace.topHorse.available ? (
                <div className="pb-1 text-right">
                  <div className="text-[10px] font-bold uppercase tracking-[0.34em] text-[#00A9B8]">Top Signal : Value</div>
                  <div className="mt-2 max-w-[230px] text-[12px] font-semibold leading-relaxed text-[#050B1E]">
                    {isFiniteNumber(featuredRace.topHorse.popularity) && isFiniteNumber(featuredRace.topHorse.ev)
                      ? <>指数1位が<Num>{featuredRace.topHorse.popularity}</Num>人気に放置。 期待値 <Num>{featuredRace.topHorse.ev.toFixed(2)}</Num></>
                      : "指数上位のシグナルを表示します"}
                  </div>
                </div>
                ) : null}
              </div>
            </>
          ) : races ? (
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.34em] text-[#A6AFBE]">Featured Race</div>
              <div className="mt-4 text-[22px] font-bold leading-tight tracking-tight text-[#050B1E]">
                {WEEK_PREPARING_TEXT}
              </div>
              <div className="mt-8">
                <div className="text-[10px] font-bold uppercase tracking-[0.28em] text-[#A6AFBE]">TM INDEX</div>
                <Num className="mt-4 block text-[64px] font-bold leading-none tracking-tight text-[#CBD5E1]">
                  --
                </Num>
              </div>
            </div>
          ) : (
            <Skeleton className="mt-8 h-64" />
          )}
        </div>
      </section>

      {/* 今日のレース */}
      <section className="mt-12">
        <div className="flex items-end justify-between">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.34em] text-[#A6AFBE]">Race Intelligence</div>
            <h2 className="mt-1 text-[18px] font-bold tracking-tight text-[#050B1E]">今日のレース</h2>
          </div>
          <span className="text-[11px] font-semibold text-[#A6AFBE]">
            日曜・<Num>{races?.length ?? meta?.raceCount ?? 0}</Num>レース
          </span>
        </div>
        {races ? (
          races.length ? (
            <div className="mt-4 space-y-3">
              {visibleRaceCards.map((race) => (
                <RaceSignalCard key={race.id} race={race} onOpen={onOpenRace} />
              ))}
            </div>
          ) : (
            <div className="mt-5 rounded-[18px] border border-[#DDE3EA] bg-white p-6 text-[13px] font-medium text-[#A6AFBE]">
              {WEEK_PREPARING_TEXT}
            </div>
          )
        ) : (
          <div className="mt-5 grid gap-5 md:grid-cols-3">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-44" />)}
          </div>
        )}
      </section>

      {/* AI分析サマリー */}
      <section className="mt-16">
        <div className="flex items-end justify-between">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400">Daily Intelligence</div>
            <h2 className="mt-1 text-[18px] font-bold tracking-tight text-slate-950">AI分析サマリー</h2>
          </div>
        </div>
        <div className={`relative mt-4 overflow-hidden ${GLASS.surface} p-6`}>
          {summary ? (
            <div className="relative">
              <div className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[10px] font-semibold text-slate-500">
                <Sparkles size={11} strokeWidth={1.75} />
                AI Insight
              </div>
              <p className="mt-4 text-[13px] leading-[2] text-slate-700">{summary.text}</p>
              <ul className="mt-4 space-y-2 border-t border-gray-100 pt-4">
                {summary.highlights.map((h, i) => (
                  <li key={i} className="flex gap-2.5 text-[12px] leading-relaxed text-slate-600">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" />
                    {h}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="space-y-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          )}
        </div>
      </section>

      {/* 今日のAI注目馬 */}
      <section className="mt-14">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[15px] font-semibold text-gray-900">今日のAI注目馬</h2>
          <span className="text-[11px] text-gray-500">AIが特に伝えたい3頭</span>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {featured
            ? featured.length
              ? featured.map((f, i) => {
                const isMain = i === 0;
                return (
                  <button
                    key={f.horseId}
                    onClick={() => onOpenRace(f.raceId, f.horseId)}
                    className={`group ${GLASS.surface} ${GLASS.interactive} text-left ${
                      isMain ? "p-6 md:col-span-2 md:p-8" : "p-5 md:p-6"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Num className="text-[10px] font-bold tracking-[0.18em] text-teal-600">
                            PICK 0{i + 1}
                          </Num>
                          <span className="text-[11px] text-gray-500">{f.raceLabel}</span>
                        </div>
                        <div
                          className={`mt-1.5 font-bold tracking-tight text-gray-900 ${
                            isMain ? "text-[22px]" : "text-[15px]"
                          }`}
                        >
                          {displayHorseName(f.horse)}
                        </div>
                        <p
                          className={`text-gray-500 ${
                            isMain
                              ? "mt-2.5 max-w-md text-[13px] leading-relaxed"
                              : "mt-2 text-[12px] leading-relaxed"
                          }`}
                        >
                          {f.note}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <Num
                          className={`font-bold tracking-tight ${scoreTone(f.horse.aiScore)} ${
                            isMain ? "text-[52px] leading-none" : "text-[30px] leading-none"
                          }`}
                        >
                          {f.horse.aiScore}
                        </Num>
                        <div className="mt-1.5 text-[10px] uppercase tracking-wider text-gray-500">AI指数</div>
                        <span className="mt-1 flex items-center justify-end gap-1">
                          <StarRating value={valueStars(f.ev)} size={9} />
                        </span>
                        <Num className="mt-0.5 block text-[10px] text-gray-500">
                          {isFiniteNumber(f.ev) ? `EV ${f.ev.toFixed(2)}` : "EV 未評価"}
                        </Num>
                      </div>
                    </div>
                  </button>
                );
              })
              : (
                <div className={`${GLASS.surface} p-6 text-[13px] font-medium text-slate-400 md:col-span-2`}>
                  {WEEK_PREPARING_TEXT}
                </div>
              )
            : [0, 1, 2].map((i) => (
                <Skeleton key={i} className={i === 0 ? "h-36 md:col-span-2" : "h-28"} />
              ))}
        </div>
      </section>

      {/* AI指数ランキング */}
      <section className="mt-14">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[15px] font-semibold text-gray-900">AI指数ランキング</h2>
          <span className="text-[11px] text-gray-500">本日 全レース</span>
        </div>
        <div className={`mt-4 overflow-hidden ${GLASS.surface}`}>
          {ranking
            ? ranking.length
              ? ranking.map((item, i) => (
                <button
                  key={item.horse.id}
                  onClick={() => onOpenRace(item.raceId, item.horse.id)}
                  className="grid w-full grid-cols-[1.5rem_auto_1fr_2.5rem] items-center gap-3 border-b border-gray-100 px-4 py-3.5 text-left transition-colors duration-150 last:border-b-0 hover:bg-gray-50/70 active:bg-gray-100/60 md:px-5"
                >
                  <Num className={`text-[13px] font-bold ${i === 0 ? "text-slate-950" : "text-gray-500"}`}>
                    {i + 1}
                  </Num>
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-semibold text-gray-900">
                    {displayHorseName(item.horse)}
                    </span>
                    <span className="text-[11px] text-gray-500">{item.raceLabel}</span>
                  </span>
                  <span className="flex items-center">
                    <AnimatedBar value={item.horse.aiScore} delay={i * 70} />
                  </span>
                  <Num className={`text-right text-[15px] font-bold ${scoreTone(item.horse.aiScore)}`}>
                    {item.horse.aiScore}
                  </Num>
                </button>
              ))
              : (
                <div className="px-5 py-8 text-center text-[13px] font-medium text-slate-400">
                  {WEEK_PREPARING_TEXT}
                </div>
              )
            : [0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="m-3 h-10" />)}
        </div>
      </section>
    </main>
  );
};

/* ---- レース詳細ページ ---- */
const RacePage = ({ raceId, initialHorseId, onBack }) => {
  const [race, setRace] = useState(null);
  const [sortKey, setSortKey] = useState("score");
  const [expandedId, setExpandedId] = useState(null); // PC: インライン展開
  const [sheetHorse, setSheetHorse] = useState(null); // モバイル: ボトムシート
  const isDesktop = useIsDesktop();

  /* Rank・期待値はロジック層で自動計算(手入力不要) */
  const rankMap = useMemo(() => (race ? rankByScore(race.horses) : {}), [race]);
  const topIndexHorse = useMemo(
    () => (race ? [...race.horses].filter(isEvaluatedHorse).sort((a, b) => b.aiScore - a.aiScore)[0] : null),
    [race]
  );
  const evMap = useMemo(
    () =>
      race && race.horses.length
        ? Object.fromEntries(race.horses.map((h) => [h.id, evaluateValue(h, race.horses)]))
        : {},
    [race]
  );

  useEffect(() => {
    setRace(null);
    dataProvider.getRace(raceId).then((r) => {
      setRace(r);
      if (initialHorseId && r) {
        const h = r.horses.find((x) => x.id === initialHorseId);
        if (h) {
          if (window.matchMedia("(min-width: 768px)").matches) setExpandedId(h.id);
          else setSheetHorse(h);
        }
      }
    });
  }, [raceId, initialHorseId]);

  const handleToggle = useCallback(
    (horse) => {
      if (isDesktop) {
        setExpandedId((prev) => (prev === horse.id ? null : horse.id));
      } else {
        setSheetHorse(horse);
      }
    },
    [isDesktop]
  );

  const closeSheet = useCallback(() => setSheetHorse(null), []);

  return (
    <main className="mx-auto max-w-5xl px-5">
      {/* レースヘッダー */}
      <div className="pt-5 md:pt-6">
        <button
          onClick={onBack}
          className="-mx-2 -my-2 inline-flex min-h-10 items-center gap-1 rounded-lg px-2 py-2 text-[13px] font-medium text-gray-500 transition-colors hover:text-gray-900 active:bg-gray-100/60"
        >
          <ChevronLeft size={15} strokeWidth={1.75} />
          トップへ戻る
        </button>

        {race ? (
          <div className={`relative mt-4 overflow-hidden ${GLASS.surface} p-5 md:p-7`}>
            <div className="relative">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-gray-500 shadow-sm">
                    <Clock size={11} strokeWidth={1.75} />
                    <Num className="text-[12px] font-semibold text-slate-700">{displayRaceValue(race.time, "取得待ち")}</Num>
                  </span>
                  <span className="text-[13px] font-bold text-gray-900">
                    {race.track}
                    <Num>{race.number}</Num>R
                  </span>
                  {race.grade && (
                    <span className="rounded border border-gray-200 bg-white px-1.5 py-px text-[10px] font-bold leading-4 text-slate-500">
                      {race.grade}
                    </span>
                  )}
                </div>
                <h1 className="mt-3 text-[26px] font-bold leading-tight tracking-tight text-slate-950 md:text-[24px]">
                  {race.name}
                </h1>
              </div>
              <span className="mt-0.5 shrink-0 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[10px] font-semibold text-slate-600">
                分析済み
              </span>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] font-medium text-slate-500 md:gap-x-4">
              <span>
                {race.surface}
                <Num>{race.distance}</Num>m
              </span>
              <span>天候 {displayRaceValue(race.weather, "取得待ち")}</span>
              <span>馬場 {displayRaceValue(race.going, "取得待ち")}</span>
              {race.courseType ? <span>{race.courseType}コース</span> : null}
              <span>
                <Num>{race.fieldSize}</Num>頭
              </span>
            </div>
            <div className="mt-4 inline-flex items-center gap-2 rounded-2xl border border-gray-200 bg-white px-3 py-2 text-[11px] font-medium text-slate-500 shadow-sm">
              <span className="text-slate-400">単勝オッズ</span>
              <span className="h-1 w-1 rounded-full bg-slate-300" />
              <span>{oddsStatusLabel(race.oddsStatus)}</span>
              <Num className="font-semibold text-slate-700">{formatOddsUpdatedAt(race.oddsUpdatedAt, race.oddsStatus)}</Num>
            </div>
            {topIndexHorse && (
              <div className={`mt-5 ${GLASS.inner} p-4`}>
                <div className="flex items-end justify-between gap-3">
                  <div className="min-w-0">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">TM INDEX Top</span>
                    <span className="mt-1 block truncate text-[14px] font-bold text-slate-900">{displayHorseName(topIndexHorse)}</span>
                  </div>
                  <Num className="text-[38px] font-bold leading-none text-slate-950">
                      {topIndexHorse.aiScore}
                    </Num>
                </div>
              </div>
            )}
            </div>
          </div>
        ) : (
          <Skeleton className="mt-4 h-24" />
        )}
      </div>

      {/* ファクター比較(全馬横断) */}
      {race && race.horses.some(isEvaluatedHorse) && <ComparisonTable horses={race.horses} evMap={evMap} onSelect={handleToggle} />}

      {/* 並び替え(モバイル: 全幅・親指で押しやすい高さ) */}
      <div className="mt-8 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400">Runner Matrix</div>
          <h2 className="mt-1 text-[18px] font-bold tracking-tight text-slate-950">出走馬 AI分析</h2>
        </div>
        <div className="grid w-full grid-cols-4 rounded-2xl border border-gray-200 bg-white p-1 shadow-sm md:flex md:w-auto md:rounded-2xl md:p-1">
          {SORT_OPTIONS.map((o) => (
            <button
              key={o.key}
              onClick={() => setSortKey(o.key)}
              className={`rounded-lg px-2 py-2.5 text-[11px] font-semibold transition-colors duration-150 md:rounded-md md:px-3 md:py-1.5 ${
                sortKey === o.key
                  ? "bg-[#EAFBFA] text-[#00A9B8] shadow-sm ring-1 ring-[#BFEFED]"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {/* 出走馬一覧 */}
      <div className={`mt-4 overflow-hidden ${GLASS.surface}`}>
        {/* PC列ヘッダー */}
        <div className="hidden grid-cols-[2.5rem_1.4fr_1fr_4rem_4.5rem_4rem_1.6fr] gap-x-3 border-b border-gray-200 bg-gray-50/60 px-5 py-2 text-[10px] font-semibold uppercase tracking-wider text-gray-500 md:grid">
          <span>馬番</span>
          <span>馬名</span>
          <span>騎手</span>
          <span className="text-right">人気</span>
          <span className="text-right">単勝 / EV</span>
          <span className="text-right">AI指数</span>
          <span>短評</span>
        </div>

        {race
          ? race.horses.length
            ? sortHorses(race.horses, sortKey, evMap).map((h) => (
              <HorseRow
                key={h.id}
                horse={h}
                rank={rankMap[h.id]}
                fieldSize={race.fieldSize}
                ev={evMap[h.id]}
                expanded={expandedId === h.id}
                onToggle={() => handleToggle(h)}
                isDesktop={isDesktop}
              />
            ))
            : (
              <div className="px-5 py-10 text-center text-[13px] font-medium text-slate-400">
                {WEEK_PREPARING_TEXT}
              </div>
            )
          : [0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="m-3 h-14" />)}
      </div>

      <p className="mt-3 text-[11px] text-gray-500">
        {isDesktop ? "行をクリックすると分析詳細が展開されます。" : "馬をタップすると分析詳細が開きます。"}
        EVは推定勝率×単勝オッズの期待値(1.00が損益分岐の目安)です。
      </p>

      {/* モバイル: ボトムシート */}
      {!isDesktop && sheetHorse && (
        <BottomSheet
          horse={sheetHorse}
          rank={rankMap[sheetHorse.id]}
          fieldSize={race?.fieldSize}
          ev={evMap[sheetHorse.id]}
          onClose={closeSheet}
        />
      )}
    </main>
  );
};

/* =====================================================================
 * [7] App — 状態ベースの簡易ルーティング
 * 将来: Next.js の / と /race/[id] にそのまま対応
 * ===================================================================== */
export default function App() {
  const [route, setRoute] = useState({ page: "home" });
  const [meta, setMeta] = useState(null);

  useEffect(() => {
    dataProvider.getMeta().then(setMeta);
  }, []);

  const openRace = (raceId, horseId = null) => {
    setRoute({ page: "race", raceId, horseId, key: Date.now() });
    window.scrollTo(0, 0);
  };
  const goHome = () => {
    setRoute({ page: "home" });
    window.scrollTo(0, 0);
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#FAFAFA] text-gray-900 antialiased">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Noto+Sans+JP:wght@400;500;700&family=JetBrains+Mono:wght@500;600;700&display=swap');
        body, #root { font-family: 'Inter', 'Noto Sans JP', system-ui, sans-serif; }
        .tm-num { font-family: 'JetBrains Mono', ui-monospace, monospace; }
        .tm-bar { transition: width 800ms cubic-bezier(0.22, 1, 0.36, 1); }
        .tm-index-underline {
          width: 88px;
          height: 3px;
          border-radius: 2px;
          background: linear-gradient(90deg, #00C2B8, #2D7BFF, #22E6A2);
          transform: scaleX(0);
          transform-origin: left;
          animation: tm-index-underline 900ms cubic-bezier(.2,.8,.2,1) 300ms forwards;
        }
        button:focus-visible { outline: 2px solid rgba(15, 118, 110, 0.45); outline-offset: 2px; }
        .tm-modal-root {
          height: 100vh;
          height: 100dvh;
          contain: layout size style;
        }
        /* ボトムシートのスクロール対策(iOS Safari / Android Chrome) */
        .tm-sheet {
          height: 94vh;          /* 背面を少しだけ残しつつ、主情報を上へ出す */
          height: 94dvh;         /* 100vh問題の回避(動的ビューポート) */
          max-height: 94vh;      /* dvh非対応ブラウザ向けフォールバック */
          max-height: 94dvh;
          overscroll-behavior: contain;
        }
        .tm-sheet-body {
          -webkit-overflow-scrolling: touch;  /* iOS慣性スクロール */
          overscroll-behavior: contain;       /* 背面へのスクロール連鎖を遮断 */
          touch-action: pan-y;
        }
        @keyframes tm-slideup { from { transform: translateY(24px); opacity: 0.6; } to { transform: translateY(0); opacity: 1; } }
        @keyframes tm-fade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes tm-index-underline { from { transform: scaleX(0); } to { transform: scaleX(1); } }
        .tm-slideup { animation: tm-slideup 360ms cubic-bezier(.2,.8,.2,1); }
        .tm-fade { animation: tm-fade 300ms cubic-bezier(.2,.8,.2,1); }
        .tm-fadein { animation: tm-fade 240ms ease-out; }
        @media (prefers-reduced-motion: reduce) {
          .tm-slideup, .tm-fade, .tm-fadein, .tm-index-underline { animation: none; }
          .tm-index-underline { transform: scaleX(1); }
          .tm-bar { transition: none; }
        }
      `}</style>

      {DATA_ERRORS.length > 0 && (
        <div className="relative z-10 border-b border-amber-200 bg-amber-50 px-5 py-2 text-center text-[11px] text-amber-800">
          週次データの検証で <Num className="font-semibold">{DATA_ERRORS.length}</Num> 件の警告があります(開発者コンソール参照)
        </div>
      )}

      <div className="relative z-10">
        <Header onHome={goHome} meta={meta} />

        {route.page === "home" && <HomePage onOpenRace={openRace} />}
        {route.page === "race" && (
          <RacePage
            key={route.key}
            raceId={route.raceId}
            initialHorseId={route.horseId}
            onBack={goHome}
          />
        )}

        <Footer />
      </div>
    </div>
  );
}
