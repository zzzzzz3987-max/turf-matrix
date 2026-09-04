import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { dataMode, loadWeekData } from "./data/week-data-loader.js";
import allRaceSignals from "../tools/all-race-signals.json";
import rolePerformance from "./data/public-role-performance.json";
import { isValueSignalEv, isValueSignalMetrics } from "./lib/value-rules.js";
import { shouldSkipWideForColdMarket } from "../tools/battle-ticket-selection.mjs";
import {
  buildPedigreeFamilyPublicLines,
  buildPedigreePublicConditionSummary,
  buildPedigreePublicBreakdown,
  buildPedigreePublicOverview,
  buildRacePublicConclusion,
  buildStablePatternPublicView,
  buildHorsePublicView as horseQuickRead,
  publicConditionFit,
  publicFactorSummary,
  publicHorseComment,
  publicScoreBand,
  publicTrainingGrade,
  publicTrainingHeadline,
  summarizePublicText,
} from "./lib/public-view-model.js";
import {
  Dumbbell, LayoutGrid, Dna, TrendingUp, Clock,
  ChevronDown, ChevronLeft, X, Star, ChevronRight,
  Target, ShieldAlert, KeyRound,
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
const displayFactorScore = (value) => (isFiniteNumber(value) ? Math.round(value) : "—");
const displayHorseNumber = (value) => (isFiniteNumber(value) && value > 0 ? value : "未");
const displayOdds = (value, status = null) => (
  isFiniteNumber(value) && value > 0 ? value.toFixed(1) : status === "missing" ? "票数なし" : "発売前"
);
const displayPopularity = (value) => (isFiniteNumber(value) && value > 0 ? `${value}` : "発売前");
const displayRaceValue = (value, fallback = "未発表") => (value == null || value === "" ? fallback : value);
const isPendingText = (value) => {
  const text = String(value ?? "").trim();
  return !text || text === "取得待ち" || text === "未発表" || /^\?+$/.test(text);
};
const displayHorseName = (horse) => (isPendingText(horse?.name) ? horse?.currentRace?.horseName ?? "未定" : horse.name);
const displayJockeyName = (horse) => (isPendingText(horse?.jockey) ? horse?.currentRace?.jockey ?? "未定" : horse.jockey);
const WEEK_PREPARING_TEXT = "今週のレースは準備中です";
const oddsStatusLabel = (status) => ({
  active: "最終更新",
  preodds: "発売前",
  missing: "未発表",
  closed: "締切",
  partial: "更新中",
}[status] ?? "未発表");
const formatOddsUpdatedAt = (value, status) => {
  if (status !== "active" || !value) return oddsStatusLabel(status);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return oddsStatusLabel(status);
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
};
const formatRaceWeekday = (value) => {
  if (!value) return "本日";
  const date = new Date(`${value}T00:00:00+09:00`);
  return Number.isNaN(date.getTime())
    ? "本日"
    : date.toLocaleDateString("ja-JP", { weekday: "short", timeZone: "Asia/Tokyo" });
};

const valueMetricsFor = (horse) => {
  const value = horse?.analysis?.factorsDetail?.value;
  if (!value || !isFiniteNumber(value.ev) || !isFiniteNumber(value.probability)) return null;
  return {
    score: value.score,
    prob: value.probability,
    ev: value.ev,
    marketGap: value.marketGap,
    stars: value.stars,
    verdict: value.verdict,
    eligible: value.eligible === true,
    eligibilityReasons: value.eligibilityReasons ?? [],
  };
};

/** レース内Rank(AI指数順) { horseId: rank } */
const rankByScore = (horses) =>
  Object.fromEntries(
    [...horses]
      .filter(isEvaluatedHorse)
      .sort((a, b) => b.aiScore - a.aiScore || a.number - b.number)
      .map((h, i) => [h.id, i + 1])
  );

const leaderStateFor = (horses) => {
  const ranked = [...(horses ?? [])]
    .filter(isEvaluatedHorse)
    .sort((a, b) => b.aiScore - a.aiScore || a.number - b.number);
  const top = ranked[0] ?? null;
  const second = ranked[1] ?? null;
  const gap = top && second ? top.aiScore - second.aiScore : null;
  return {
    top,
    second,
    gap,
    status: top && second && gap === 0
      ? "tied"
      : top && (!second || gap >= 3)
        ? "clear"
        : top
          ? "contested"
          : "missing",
  };
};

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
  v >= 80 ? { label: "S", text: "最有力" }
  : v >= 75 ? { label: "A", text: "有力" }
  : v >= 70 ? { label: "B", text: "上位" }
  : v >= 65 ? { label: "C", text: "標準" }
  : { label: "D", text: "厳しい評価" };

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
      horses: (race.horses ?? []).map((horse) => {
        const analysis = normalizeAnalysis(horse.analysis ?? {});
        const sourcePedigree = horse.pedigree ?? horse.pedigreeRaw ?? null;
        return {
          ...horse,
          analysis: analysis.pedigree && sourcePedigree
            ? { ...analysis, pedigree: { ...analysis.pedigree, sourcePedigree } }
            : analysis,
        };
      }),
    })),
  };
};

const WEEK_DATA_PROMISE = loadWeekData().then((rawWeekData) => {
  const normalized = normalizeWeekData(rawWeekData);
  const intelligencePending = normalized.meta?.intelligenceLayerConnected === false;
  const errors = dataMode === "candidate" || intelligencePending ? [] : validateWeekData(normalized);
  if (errors.length) console.warn("[TURF MATRIX] week-data 検証警告:", errors);
  return normalized;
});

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
    const weekData = await WEEK_DATA_PROMISE;
    // 集計値はデータから自動算出(毎週の手入力を無くす)
    const raceCount = weekData.races.length;
    const horseCount = weekData.races.reduce((s, r) => s + r.horses.length, 0);
    return simulateLatency({ ...weekData.meta, raceCount, horseCount }, 60);
  },
  async getDailySummary() {
    const weekData = await WEEK_DATA_PROMISE;
    return simulateLatency(weekData.dailySummary);
  },
  async getRaces() {
    const weekData = await WEEK_DATA_PROMISE;
    const list = weekData.races.filter((r) => r.displayTarget !== false).map((r) => {
      const leadership = leaderStateFor(r.horses);
      const top = leadership.top;
      return {
        ...r,
        horses: undefined,
        leaderStatus: leadership.status,
        indexGap: leadership.gap,
        secondHorse: leadership.second ? {
          name: leadership.second.name,
          aiScore: leadership.second.aiScore,
        } : null,
        topHorse: top
          ? {
              name: top.name,
              aiScore: top.aiScore,
              popularity: top.popularity,
              odds: top.odds,
              ev: valueMetricsFor(top)?.ev ?? null,
              value: valueMetricsFor(top),
              available: true,
            }
          : { name: WEEK_PREPARING_TEXT, aiScore: null, available: false },
        confidence: raceConfidence(r.horses),
      };
    });
    return simulateLatency(list);
  },
  async getRace(raceId) {
    const weekData = await WEEK_DATA_PROMISE;
    const race = weekData.races.find((r) => r.id === raceId) || null;
    return simulateLatency(race);
  },
  async getFeaturedHorses() {
    const weekData = await WEEK_DATA_PROMISE;
    const intelligencePending = weekData.meta?.intelligenceLayerConnected === false;
    if (dataMode === "candidate" || intelligencePending) {
      const candidates = weekData.races
        .flatMap((race) =>
          (race.horses ?? [])
            .filter(isEvaluatedHorse)
            .map((horse) => ({
              id: `${race.id}-${horse.id}`,
              raceId: race.id,
              horseId: horse.id,
              horse,
              raceLabel: `${race.track}${race.number}R`,
              note: horse.analysis?.verdict?.summary ?? horse.comment ?? "複数の評価項目から選んだ上位馬です。",
              ev: valueMetricsFor(horse)?.ev ?? null,
              value: valueMetricsFor(horse),
            }))
        )
        .sort((a, b) =>
          (b.horse.aiScore ?? -1) - (a.horse.aiScore ?? -1) ||
          Number(b.raceLabel.includes("11R")) - Number(a.raceLabel.includes("11R")) ||
          (a.horse.number ?? 999) - (b.horse.number ?? 999) ||
          String(a.horse.name ?? "").localeCompare(String(b.horse.name ?? ""), "ja")
        );
      const usedRaceIds = new Set();
      const derived = [];
      for (const item of candidates) {
        if (usedRaceIds.has(item.raceId)) continue;
        usedRaceIds.add(item.raceId);
        derived.push(item);
        if (derived.length >= 3) break;
      }
      return simulateLatency(derived);
    }
    const items = weekData.featured.flatMap((f) => {
      const race = weekData.races.find((r) => r.id === f.raceId);
      const horse = race?.horses?.find((h) => h.id === f.horseId);
      if (!race || !horse) return [];
      return [{
        ...f,
        horse,
        raceLabel: `${race.track}${race.number}R`,
        ev: valueMetricsFor(horse)?.ev,
        value: valueMetricsFor(horse),
      }];
    }).sort((a, b) =>
      (b.horse.aiScore ?? -1) - (a.horse.aiScore ?? -1) ||
      Number(b.raceLabel.includes("11R")) - Number(a.raceLabel.includes("11R")) ||
      (a.horse.number ?? 999) - (b.horse.number ?? 999) ||
      String(a.horse.name ?? "").localeCompare(String(b.horse.name ?? ""), "ja")
    );
    const usedRaceIds = new Set();
    const selected = [];
    for (const item of items) {
      if (usedRaceIds.has(item.raceId)) continue;
      usedRaceIds.add(item.raceId);
      selected.push(item);
      if (selected.length >= 3) break;
    }
    return simulateLatency(selected);
  },
  async getIndexRanking(limit = 5) {
    const weekData = await WEEK_DATA_PROMISE;
    const all = weekData.races.flatMap((r) =>
      (r.horses ?? []).map((h) => ({ horse: h, raceId: r.id, raceLabel: `${r.track}${r.number}R` }))
    ).filter((item) => isEvaluatedHorse(item.horse));
    all.sort((a, b) =>
      (b.horse.aiScore ?? -1) - (a.horse.aiScore ?? -1) ||
      Number(b.raceLabel.includes("11R")) - Number(a.raceLabel.includes("11R")) ||
      (a.horse.number ?? 999) - (b.horse.number ?? 999) ||
      String(a.horse.name ?? "").localeCompare(String(b.horse.name ?? ""), "ja")
    );
    return simulateLatency(all.slice(0, limit));
  },
};

/* =====================================================================
 * [4] lib/format — 表示定義・ユーティリティ
 * ===================================================================== */
/* ファクター比較テーブルの行(「どの馬がどこで優れているか」を3秒で) */
const COMPARE_DEFS = [
  { key: "ability", label: "能力" },
  { key: "course", label: "コース適性" },
  { key: "distance", label: "距離適性" },
  { key: "pace", label: "展開" },
  { key: "ev", label: "期待値", type: "ev" },
  { key: "training", label: "調教" },
  { key: "blood", label: "血統" },
];

const SORT_OPTIONS = [
  { key: "score", label: "TM INDEX" },
  { key: "ev", label: "期待値" },
  { key: "number", label: "馬番" },
  { key: "popularity", label: "人気" },
];

const sortHorses = (horses, sortKey, evMap, rankMap) => {
  const arr = sortKey === "ev"
    ? horses.filter((horse) =>
        isValueSignalEv(evMap[horse.id]?.ev) &&
        isFiniteNumber(evMap[horse.id]?.marketGap) &&
        evMap[horse.id].marketGap >= 0
      )
    : [...horses];
  if (sortKey === "score") arr.sort((a, b) => (b.aiScore ?? -1) - (a.aiScore ?? -1) || a.number - b.number);
  if (sortKey === "ev") {
    arr.sort((a, b) =>
      evMap[b.id].marketGap - evMap[a.id].marketGap ||
      (rankMap[a.id] ?? Number.POSITIVE_INFINITY) - (rankMap[b.id] ?? Number.POSITIVE_INFINITY) ||
      (evMap[b.id]?.ev ?? Number.NEGATIVE_INFINITY) - (evMap[a.id]?.ev ?? Number.NEGATIVE_INFINITY) ||
      a.number - b.number
    );
  }
  if (sortKey === "number") arr.sort((a, b) => a.number - b.number);
  if (sortKey === "popularity") arr.sort((a, b) => (a.popularity ?? 999) - (b.popularity ?? 999) || a.number - b.number);
  return arr;
};

const scoreTone = (v) => (!isFiniteNumber(v) ? "text-gray-300" : "text-slate-950");
const isValueSignal = (value) =>
  value?.eligible === true && isValueSignalMetrics(value?.ev, value?.marketGap);
const displayMarketGap = (marketGap) =>
  isFiniteNumber(marketGap) ? `${marketGap >= 0 ? "+" : ""}${marketGap}` : null;
const valueReferenceLabel = (value) => value?.verdict?.label === "高オッズ妙味(参考)" ? "高オッズ注意" : null;
const evTone = (value) => (isValueSignal(value) ? "text-teal-600" : value?.ev >= 0.95 ? "text-slate-900" : "text-gray-500");
const factorDetailScore = (horse, key) => {
  const detailScore = horse.analysis?.factorsDetail?.[key]?.score;
  if (isFiniteNumber(detailScore)) return detailScore;
  return null;
};
const formatPublicUpdateTime = (value) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Tokyo",
  }).format(date);
};

const concisePublicInsight = (value, maxLength = 118) =>
  summarizePublicText(value, { maxLength, sentences: 2 });

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
          <>
            {meta.previewMode ? (
              <span className="rounded-md border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[9px] font-bold text-sky-700">
                <span className="hidden sm:inline">オッズ反映前</span>
                <span className="sm:hidden">暫定</span>
              </span>
            ) : null}
            <span>{meta.dateLabel ?? ""}</span>
          </>
        ) : null}
      </div>
    </div>
  </header>
);

const GlossaryModal = ({ onClose }) => {
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[70] bg-slate-900/15 px-3 py-4 sm:px-5" role="dialog" aria-modal="true" aria-label="用語集">
      <div className="mx-auto flex h-full max-w-3xl flex-col overflow-hidden rounded-[18px] border border-gray-200 bg-white shadow-sm">
        <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-5 py-4">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.28em] text-gray-400">Glossary</div>
            <h2 className="mt-1 text-[20px] font-bold tracking-tight text-gray-900">用語集</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-10 w-10 place-items-center rounded-full border border-gray-200 bg-white text-gray-500 shadow-sm transition-colors hover:bg-gray-50"
            aria-label="用語集を閉じる"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-6 sm:px-7">
          <div className="space-y-7 text-[13px] leading-[1.9] text-gray-700">
            <section>
              <h3 className="text-[15px] font-bold text-gray-900">TM INDEX</h3>
              <p className="mt-2">
                出走全馬をAIが多角的に分析し、100点満点で相対評価した総合指数です。能力・血統・調教・コース適性・展開など複数の視点を重み付けして算出します。人気やオッズは指数の算出に使いません。数値はレース内の相対評価のため、同じ80でもレースが違えば意味が変わります。
              </p>
              <div className="mt-4 rounded-[14px] border border-gray-200 bg-white p-4">
                <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.18em] text-gray-400">評価の目安</div>
                {[
                  ["80以上", "S / 最有力"],
                  ["75〜79", "A / 有力"],
                  ["70〜74", "B / 上位"],
                  ["65〜69", "C / 標準"],
                  ["64以下", "D / 見送り検討"],
                ].map(([range, label]) => (
                  <div key={range} className="flex items-center justify-between border-t border-gray-100 py-2 first:border-t-0">
                    <Num className="font-semibold text-gray-900">{range}</Num>
                    <span className="font-medium text-gray-600">{label}</span>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <h3 className="text-[15px] font-bold text-gray-900">TM VALUE(期待値評価・星5段階)</h3>
              <p className="mt-2">
                AIが推定した勝率と、実際の単勝オッズの差を星で表します。人気ではなく「AIの見立てに対して馬券的な妙味があるか」を示します。オッズ確定後に評価されます。
              </p>
              <div className="mt-4 space-y-2 rounded-[14px] border border-gray-200 bg-white p-4">
                {[
                  [5, "EV 1.50以上(妙味大)"],
                  [4, "EV 1.20〜1.49(妙味あり)"],
                  [3, "EV 1.00〜1.19(やや妙味)"],
                  [2, "EV 0.80〜0.99(やや過剰人気)"],
                  [1, "EV 0.80未満(過剰人気)"],
                ].map(([stars, text]) => (
                  <div key={text} className="flex items-center justify-between gap-4">
                    <StarRating value={stars} size={12} />
                    <span className="text-right text-gray-700">{text}</span>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <h3 className="text-[15px] font-bold text-gray-900">EV(期待値)</h3>
              <p className="mt-2">
                AI推定勝率 × 単勝オッズで計算します。1.00が損益分岐点です。1.00を超えるほど、AIは「オッズに対して過小評価されている(妙味がある)」と見ています。1.00未満は人気に見合わない、または過剰人気の目安です。EVが3.0以上の場合は高オッズの影響が大きいため、掲載対象から外します。
              </p>
            </section>

            <section>
              <h3 className="text-[15px] font-bold text-gray-900">9つのファクター</h3>
              <p className="mt-2">TM INDEXは以下の視点を統合して算出します。</p>
              <div className="mt-4 divide-y divide-gray-100 rounded-[14px] border border-gray-200 bg-white">
                {[
                  ["能力", "スピード指数や近走の着差・相手関係から見た地力"],
                  ["血統", "配合から見た、今回の距離・コース・馬場への適性"],
                  ["調教", "一週前・最終追い切りの時計とラップ、厩舎の仕上げパターン"],
                  ["コース適性", "コース形態や同コース実績への適合"],
                  ["展開", "想定ペースと脚質・枠順の相性"],
                  ["斤量", "馬齢・性別差を換算したレース内の相対負担と、近似条件での克服実績"],
                  ["厩舎", "ローテーションや騎手起用など陣営の使い方"],
                  ["調子", "近走成績の上昇・下降トレンド"],
                  ["期待値", "市場(オッズ)との評価差 ※オッズ確定後に評価"],
                ].map(([term, text]) => (
                  <div key={term} className="grid gap-1 px-4 py-3 sm:grid-cols-[6rem_1fr]">
                    <div className="font-bold text-gray-900">{term}</div>
                    <div className="text-gray-600">{text}</div>
                  </div>
                ))}
              </div>
            </section>

            <div className="border-t border-gray-200 pt-5 text-[12px] leading-[1.9] text-gray-600">
              本サービスは分析情報の提供を目的としており、的中や利益を保証するものではありません。馬券の購入はご自身の判断と責任でお願いします。
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};

const Footer = ({ onOpenGlossary }) => (
  <footer className="mt-20 border-t border-gray-200 bg-white">
    <div className="mx-auto max-w-5xl px-5 py-12">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="text-sm font-bold tracking-tight text-gray-900">
          TURF <span className="text-slate-700">MATRIX</span>
        </span>
        <PlatformBadge />
      </div>
      <button
        type="button"
        onClick={onOpenGlossary}
        className="mt-5 inline-flex items-center rounded-full border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-gray-700 shadow-sm transition-colors hover:bg-gray-50"
      >
        用語集
      </button>
      <p className="mt-4 max-w-2xl text-xs leading-relaxed text-gray-500">
        本サービスは分析情報の提供を目的としており、的中や利益を保証するものではありません。
        馬券の購入はご自身の判断と責任でお願いします。20歳未満の方は馬券を購入できません。
      </p>
      <p className="mt-2 max-w-2xl text-xs leading-relaxed text-gray-500">
        TM INDEXは能力・血統・調教・コース・展開などを総合して評価します。人気やオッズは指数に含みません。
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

const TMFactorsCard = ({ analysis }) => {
  const factorsDetail = analysis?.factorsDetail ?? {};
  const defs = [
    ["ability", "能力"], ["blood", "血統"], ["training", "調教"],
    ["course", "コース"], ["load", "斤量"], ["pace", "展開"],
    ["trackBias", "馬場傾向"], ["stable", "厩舎"], ["form", "近走"],
  ];
  const factors = defs.map(([key, label]) => ({ key, label, ...(factorsDetail[key] ?? {}) }));
  const visibleFactors = factors.filter((factor) => isFiniteNumber(factor.score));
  if (!visibleFactors.length) return null;

  return (
    <details className="group mt-5 border-t border-gray-100 pt-1">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-lg py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200 [&::-webkit-details-marker]:hidden">
        <span>
          <span className="block text-[12px] font-bold text-slate-900">全評価を見る</span>
          <span className="mt-0.5 block text-[10px] text-slate-400">能力・血統・調教など{visibleFactors.length}項目</span>
        </span>
        <ChevronDown size={15} className="text-slate-300 transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t border-gray-100 md:grid md:grid-cols-2">
        {visibleFactors.map((factor) => (
          <div key={factor.key} className="border-b border-gray-100 py-3 md:px-3 md:[&:nth-child(odd)]:border-r">
            <div className="grid grid-cols-[5.25rem_minmax(4rem,1fr)_2rem_3rem] items-center gap-2">
              <span className="text-[12px] font-semibold text-slate-800">{factor.label}</span>
              <span className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                <span className="block h-full rounded-full bg-[#2D7BFF]" style={{ width: `${Math.min(100, factor.score)}%` }} />
              </span>
              <Num className="text-right text-[14px] font-bold text-slate-950">{displayFactorScore(factor.score)}</Num>
              <span className="text-right text-[10px] font-semibold text-slate-400">{publicScoreBand(factor.score).label}</span>
            </div>
            {factor.summary ? (
              <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                {publicFactorSummary(factor.summary, 86)}
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </details>
  );
};

const HorseRiskTags = ({ flags = [], limit = 3, className = "" }) => {
  const visible = flags.slice(0, limit);
  if (!visible.length) return null;
  return (
    <span className={`flex flex-wrap gap-1.5 ${className}`}>
      {visible.map((flag) => (
        <span
          key={flag.key}
          title={flag.detail}
          className={`rounded border px-1.5 py-0.5 text-[9px] font-bold leading-4 ${
            flag.tone === "warning"
              ? "border-rose-200 bg-rose-50 text-rose-700"
              : "border-amber-200 bg-amber-50 text-amber-700"
          }`}
        >
          {flag.label}
        </span>
      ))}
    </span>
  );
};

const HorseQuickRead = ({ horse, compact = false }) => {
  const quickRead = horseQuickRead(horse);
  if (!quickRead.strengths.length && !quickRead.watchText && !quickRead.riskFlags.length) return null;

  return (
    <section className={compact ? "border-b border-gray-100 pb-5" : "mt-5 border-y border-gray-100 py-5"}>
      <h3 className="text-[13px] font-bold text-slate-950">この馬の見立て</h3>
      {quickRead.headline ? <p className="mt-2 text-[13px] leading-7 text-slate-600">{quickRead.headline}</p> : null}
      {quickRead.riskFlags.length ? (
        <div className="mt-3 border-l-2 border-amber-300 pl-3">
          <HorseRiskTags flags={quickRead.riskFlags} />
          <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
            {quickRead.riskFlags.map((flag) => flag.detail).join(" ")}
          </p>
        </div>
      ) : null}
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {quickRead.strengths.map((factor) => (
          <div key={factor.key} className="border-l-2 border-blue-500 pl-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[11px] font-bold text-slate-900">{factor.label}</span>
              <Num className="text-[14px] font-bold text-blue-700">{displayFactorScore(factor.score)}</Num>
            </div>
            {factor.summary ? (
              <p className="mt-1 text-[10px] leading-relaxed text-slate-500">{factor.summary}</p>
            ) : null}
          </div>
        ))}
      </div>
      {quickRead.watchText ? (
        <div className="mt-4 flex gap-2 border-t border-gray-100 pt-3 text-[11px] leading-relaxed text-slate-500">
          <span className="shrink-0 font-bold text-amber-700">{quickRead.watchLabel}</span>
          <span>{quickRead.watchText}</span>
        </div>
      ) : null}
    </section>
  );
};

const SectionLabel = ({ icon: Icon, children }) => (
  <h4 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
    {Icon && <Icon size={12} strokeWidth={1.75} className="shrink-0 text-teal-500/60" />}
    {children}
  </h4>
);

/* ---- ファクター比較テーブル: 横=馬 / 縦=ファクター、行ごとの上位だけを静かに強調 ---- */
const ComparisonTable = ({ horses, evMap, onSelect }) => {
  const sorted = [...horses].sort((a, b) => b.aiScore - a.aiScore);
  const desktopHorses = sorted.slice(0, 5);
  const cellValue = (d, h) =>
    d.type === "ev"
      ? evMap[h.id]?.ev ?? 0
      : factorDetailScore(h, d.key);
  const rowLeaders = useMemo(() => {
    const leaders = {};
    for (const d of COMPARE_DEFS) {
      const values = desktopHorses
        .map((h) => ({ id: h.id, value: cellValue(d, h) }))
        .filter((item) => Number.isFinite(item.value));
      const ordered = values.sort((a, b) => b.value - a.value);
      leaders[d.key] = new Set(ordered.slice(0, d.type === "ev" ? 1 : 2).map((item) => item.id));
    }
    return leaders;
  }, [desktopHorses, evMap]);
  return (
    <section className="mt-7">
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-slate-400">Runner Matrix</div>
          <h2 className="mt-1 text-[18px] font-bold tracking-tight text-slate-950">
            <span className="md:hidden">上位3頭の強み</span>
            <span className="hidden md:inline">上位5頭の強み</span>
          </h2>
        </div>
        <span className="hidden text-right text-[11px] text-slate-400 md:block">TM INDEX上位5頭を比較</span>
      </div>
      <div className="mt-5 grid gap-3 md:hidden">
        {sorted.slice(0, 3).map((h) => {
          const quickRead = horseQuickRead(h);
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
                      <Num className="text-[12px] font-bold text-slate-600">{displayHorseNumber(h.number)}</Num>
                    </span>
                    <span className="truncate text-[16px] font-bold text-slate-950">{h.name}</span>
                  </div>
                  <div className="mt-1.5 text-[11px] font-medium text-slate-400">
                    {h.jockey} ・ <Num>{h.popularity}</Num>人気
                  </div>
                  <HorseRiskTags flags={quickRead.riskFlags} limit={2} className="mt-2" />
                </div>
                <div className="text-right">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">TM INDEX</div>
                  <Num className={`mt-1 block text-[36px] font-bold leading-none ${scoreTone(h.aiScore)}`}>
                    {h.aiScore}
                  </Num>
                </div>
              </div>
              {quickRead.strengths.length ? (
                <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 border-t border-gray-100 pt-3">
                  {quickRead.strengths.map((factor) => (
                    <span key={factor.key} className="inline-flex items-baseline gap-1.5 text-[11px]">
                      <span className="font-semibold text-slate-500">{factor.label}</span>
                      <Num className="font-bold text-blue-700">{displayFactorScore(factor.score)}</Num>
                    </span>
                  ))}
                </div>
              ) : null}
            </button>
          );
        })}
      </div>
      <div className={`mt-4 hidden overflow-hidden ${GLASS.surface} p-0 md:block`}>
        <table
          className="w-full table-fixed border-collapse text-center"
        >
          <thead>
            <tr className="border-b border-gray-200">
              <th className="sticky left-0 z-10 bg-white px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-400">
              </th>
              {desktopHorses.map((h) => (
                <th key={h.id} className="px-2 py-3">
                  <button
                    onClick={() => onSelect(h)}
                    className="mx-auto flex w-full flex-col items-center gap-1.5"
                    aria-label={`${h.name}の詳細`}
                  >
                    <span className="text-[10px] font-semibold text-slate-300">
                      <Num>{displayHorseNumber(h.number)}</Num>
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
                {desktopHorses.map((h) => {
                  const v = cellValue(d, h);
                  const highlighted = rowLeaders[d.key]?.has(h.id);
                  const isEvBreakout = d.type === "ev" && isValueSignal(evMap[h.id]);
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
                          {d.type === "ev" ? v.toFixed(2) : displayFactorScore(v)}
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
        期待値は、TM INDEXの評価に対してオッズに妙味があるかを示します。<span className="font-semibold text-[#00A9B8]">高すぎる数値は掲載しません。</span>
      </p>
    </section>
  );
};

/* ---- 期待値評価: 人気ではなく期待値で読む、というサービス思想の中核カード ---- */
const ValueCard = ({ ev, rank, popularity }) => {
  if (!ev) return null;
  const vs = ev.stars;
  return (
    <section className="border-t border-gray-100 pt-6">
      <div className="flex items-center justify-between">
        <SectionLabel icon={TrendingUp}>TM Value — 期待値評価</SectionLabel>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
            ev.verdict.tone === "blue" ? "bg-white text-teal-700 ring-1 ring-gray-200" : "bg-gray-100 text-gray-500"
          }`}
        >
          {valueReferenceLabel(ev) ?? ev.verdict.label}
        </span>
      </div>
      <div className="mt-3 flex items-center gap-2.5">
        <StarRating value={vs} size={18} />
        <Num className="text-[13px] font-bold text-gray-900">{vs}.0</Num>
        <span className="text-[11px] text-gray-500">/ 5</span>
      </div>
      <div className="mt-4 flex flex-wrap items-end gap-x-7 gap-y-3 border-t border-gray-100 pt-3.5">
        <div>
          <Num className={`block text-[24px] font-bold leading-none tracking-tight ${evTone(ev)}`}>
            {ev.ev.toFixed(2)}
          </Num>
          {valueReferenceLabel(ev) ? (
            <span className="mt-1 block text-[10px] font-semibold text-gray-500">{valueReferenceLabel(ev)}</span>
          ) : null}
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
    </section>
  );
};

/* ---- 血統評価: 結論を先に、系統の詳細は必要な時だけ表示 ---- */
const PedigreeCard = ({ pedigree, sourcePedigree, score }) => {
  if (!pedigree) return null;
  const identity = pedigree.identity ?? {};
  const raceBias = pedigree.raceBias;
  const crosses = pedigree.crosses ?? [];
  const lines = buildPedigreeFamilyPublicLines(pedigree, sourcePedigree);
  const pedigreeHeadline = concisePublicInsight(
    buildPedigreePublicOverview(pedigree, score) ?? pedigree.headline ?? "父・母父・牝系から、今回条件との相性を評価。",
    200
  );
  const conditionSummary = buildPedigreePublicConditionSummary(pedigree)
    ?? (raceBias?.summary ? concisePublicInsight(raceBias.summary, 120) : null);
  const bloodComponents = buildPedigreePublicBreakdown(pedigree, sourcePedigree);
  const traits = [
    { key: "speed", label: "スピード" },
    { key: "burst", label: "瞬発力" },
    { key: "sustain", label: "持続力" },
    { key: "stamina", label: "スタミナ" },
  ]
    .filter((item) => Number.isFinite(pedigree.scores?.[item.key]))
    .sort((a, b) => pedigree.scores[b.key] - pedigree.scores[a.key])
    .slice(0, 2);

  return (
    <section className="border-t border-gray-100 pt-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <SectionLabel icon={Dna}>血統</SectionLabel>
          {identity.pairLabel ? (
            <h4 className="mt-2 text-[14px] font-bold leading-snug text-slate-950">{identity.pairLabel}</h4>
          ) : null}
          <p className="mt-2 text-[12px] leading-6 text-slate-600">{pedigreeHeadline}</p>
        </div>
        <span className="flex shrink-0 items-baseline gap-1">
          <Num className={`text-[20px] font-bold ${scoreTone(score)}`}>{displayFactorScore(score)}</Num>
          <span className="text-[10px] text-slate-400">/100</span>
        </span>
      </div>

      {conditionSummary ? (
        <div className="mt-4 border-l-2 border-teal-500 pl-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[11px] font-bold text-slate-900">今回条件との相性</span>
            {isFiniteNumber(score) ? <span className="text-[10px] font-bold text-teal-700">{publicConditionFit(score)}</span> : null}
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
            {conditionSummary}
          </p>
        </div>
      ) : null}

      {bloodComponents.length ? (
        <div className="mt-5 border-t border-gray-100">
          {bloodComponents.map((item) => (
            <details key={item.key} className="group border-b border-gray-100">
              <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-200 [&::-webkit-details-marker]:hidden">
                <span className="min-w-0">
                  <span className="block text-[10px] font-bold text-slate-400">{item.label}</span>
                  <span className="mt-0.5 block truncate text-[12px] font-bold text-slate-900">{item.name}</span>
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  <Num className="text-[14px] font-bold text-slate-950">{displayFactorScore(item.score)}</Num>
                  <ChevronDown size={14} className="text-slate-300 transition-transform group-open:rotate-180" aria-hidden="true" />
                </span>
              </summary>
              <div className="pb-5 pr-1">
                <div className="flex items-start gap-2.5">
                  <span className="mt-0.5 shrink-0 rounded-md bg-teal-50 px-2 py-1 text-[9px] font-bold text-teal-700">
                    {publicConditionFit(item.score)}
                  </span>
                  <p className="min-w-0 text-[11px] font-medium leading-[1.8] text-slate-600">{item.summary}</p>
                </div>

                {item.metrics.length ? (
                  <div className={`mt-3 grid ${item.metrics.length >= 3 ? "grid-cols-3" : item.metrics.length === 2 ? "grid-cols-2" : "grid-cols-1"} divide-x divide-gray-100 border-y border-gray-100`}>
                    {item.metrics.slice(0, 3).map((metric) => (
                      <div key={`${metric.label}-${metric.value}`} className="min-w-0 py-2.5 text-center">
                        <Num className="block truncate text-[12px] font-bold text-slate-900">{metric.value}</Num>
                        <span className="mt-1 block truncate px-1 text-[9px] font-medium text-slate-400">{metric.label}</span>
                      </div>
                    ))}
                  </div>
                ) : null}

                {item.points.length ? (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {item.points.map((point) => (
                      <span key={point} className="rounded-md bg-[#F2F7F9] px-2 py-1 text-[9px] font-bold text-slate-600">
                        {point}
                      </span>
                    ))}
                  </div>
                ) : null}

                {item.sections.length ? (
                  <div className="mt-4 border-t border-gray-100">
                    {item.sections.map((section) => (
                      <div
                        key={`${section.label}-${section.text}`}
                        className={`border-b border-gray-100 py-3 last:border-b-0 ${section.tone === "caution" ? "border-l-2 border-l-amber-300 pl-3" : ""}`}
                      >
                        <span className={`block text-[10px] font-bold ${section.tone === "caution" ? "text-amber-700" : "text-slate-800"}`}>
                          {section.label}
                        </span>
                        <p className={`mt-1 text-[11px] leading-[1.75] ${section.tone === "caution" ? "text-amber-800" : "text-slate-500"}`}>
                          {section.text}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </details>
          ))}
        </div>
      ) : null}

      {traits.length || crosses.length ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {traits.map((trait) => (
            <span key={trait.key} className="inline-flex items-center gap-1.5 rounded-md bg-blue-50 px-2 py-1 text-[10px] font-semibold text-blue-700">
              {trait.label} <Num>{displayFactorScore(pedigree.scores[trait.key])}</Num>
            </span>
          ))}
          {crosses.slice(0, 2).map((cross) => (
            <span key={`${cross.ancestor}-${cross.pattern}`} className="rounded-md bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-600">
              {cross.ancestor} {cross.pattern}
            </span>
          ))}
        </div>
      ) : null}

      {lines.length ? (
        <details className="group mt-4 border-t border-gray-100 pt-1">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-lg py-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200 [&::-webkit-details-marker]:hidden">
            <span className="text-[11px] font-bold text-slate-700">母・母父・母母まで見る</span>
            <ChevronDown size={14} className="text-slate-300 transition-transform group-open:rotate-180" />
          </summary>
          <div className="divide-y divide-gray-100 border-t border-gray-100">
            {lines.map((line) => (
              <div key={line.role} className="py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[10px] font-bold text-slate-400">{line.role}</span>
                  <span className="min-w-0 text-right text-[12px] font-bold text-slate-800">{line.name}</span>
                </div>
                {line.note ? (
                  <p className="mt-1 text-[10px] leading-relaxed text-slate-500">{concisePublicInsight(line.note, 96)}</p>
                ) : null}
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </section>
  );
};

/* ---- 調教評価カード: 「一週前重視・最終追いは確認材料」の思想を文言で明示 ---- */
const formatTrainingPoint = (item) => {
  if (!item) return "時計なし";
  const type = item.type === "wood" ? "ウッド" : "坂路";
  const course = item.course ? `${item.course}` : type;
  const dateText = String(item.date ?? "").match(/^\d{4}(\d{2})(\d{2})$/);
  const date = dateText ? `${Number(dateText[1])}/${Number(dateText[2])}` : "日付不明";
  return `${date} ${course}コース 4F ${item.f4 ?? "-"} / 1F ${item.f1 ?? "-"}`;
};

const TrainingEvalCard = ({ evalData, stablePattern: stablePatternSource }) => {
  if (!evalData) return null;
  const details = evalData.details ?? {};
  const mainText = publicTrainingHeadline(evalData);
  const gradeLabel = publicTrainingGrade(evalData.grade);
  const stablePattern = buildStablePatternPublicView(stablePatternSource ?? evalData.stablePattern);
  return (
    <section className="border-t border-gray-100 pt-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <SectionLabel icon={Dumbbell}>調教</SectionLabel>
          {mainText ? <p className="mt-2 text-[12px] leading-6 text-slate-600">{mainText}</p> : null}
        </div>
        <span className="shrink-0 text-right">
          <Num className="block text-[20px] font-bold leading-none text-slate-950">{evalData.grade}</Num>
          <span className="mt-1 block text-[10px] font-semibold text-slate-400">{gradeLabel}</span>
        </span>
      </div>

      <div className="mt-5 grid border-t border-gray-100 sm:grid-cols-2">
        <div className="border-b border-gray-100 py-3 sm:pr-4 sm:border-r">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[11px] font-bold text-slate-700">追い切り総合</span>
            {isFiniteNumber(evalData.oneWeek?.score) ? (
              <Num className="text-[13px] font-bold text-slate-950">{evalData.oneWeek.score}</Num>
            ) : null}
          </div>
          {evalData.oneWeek?.text ? (
            <p className="mt-1 text-[10px] leading-relaxed text-slate-500">{publicFactorSummary(evalData.oneWeek.text, 86)}</p>
          ) : null}
        </div>
        <div className="border-b border-gray-100 py-3 sm:pl-4">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[11px] font-bold text-slate-700">最終追切</span>
            {isFiniteNumber(details.final?.score) ? <Num className="text-[13px] font-bold text-slate-950">{details.final.score}</Num> : null}
          </div>
          {details.final ? (
            <p className="mt-1 text-[10px] leading-relaxed text-slate-500">{formatTrainingPoint(details.final)}</p>
          ) : null}
        </div>
      </div>

      {details.best || stablePattern ? (
        <div className="mt-3 space-y-2 text-[11px] leading-relaxed text-slate-500">
          {details.best ? (
            <p><span className="font-bold text-slate-700">ベスト時計</span>　{formatTrainingPoint(details.best)}</p>
          ) : null}
          {stablePattern ? (
            <details className="group border-t border-gray-100 pt-3">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-left [&::-webkit-details-marker]:hidden">
                <span>
                  <span className="block font-bold text-teal-700">厩舎の好走パターン</span>
                  <span className="mt-0.5 block text-[10px] text-slate-500">{stablePattern.headline}</span>
                </span>
                <ChevronDown size={14} strokeWidth={1.8} className="shrink-0 text-slate-400 transition-transform group-open:rotate-180" aria-hidden="true" />
              </summary>
              <div className="mt-3 border-l-2 border-[#8EDFE4] pl-3">
                <p className="text-[11px] font-medium leading-relaxed text-slate-700">{stablePattern.summary}</p>
                {stablePattern.metrics.length ? (
                  <dl className="mt-3 grid grid-cols-3 gap-2">
                    {stablePattern.metrics.map((metric) => (
                      <div key={metric.label} className="min-w-0">
                        <dt className="text-[9px] font-semibold text-slate-400">{metric.label}</dt>
                        <dd className="mt-0.5 break-words text-[12px] font-bold text-slate-900">{metric.value}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
              </div>
            </details>
          ) : null}
        </div>
      ) : null}
    </section>
  );
};

/* ---- 馬詳細の中身(モバイルシート / PCインライン展開で共有) ---- */
const HorseDataPreviewContent = ({ horse }) => {
  const current = horse.currentRace ?? {};
  const facts = [
    ["馬番", current.horseNumber],
    ["性齢", current.sexAge],
    ["斤量", current.carriedWeight],
    ["騎手", current.jockey],
    ["調教師", `${current.stableSide ?? ""}${current.trainer ?? ""}`],
    ["条件", `${current.surface ?? ""}${current.distance ?? ""}m`],
  ].filter(([, value]) => !isPendingText(value));

  return (
    <GlassPanel>
      <h3 className="text-[18px] font-bold text-slate-950">{displayHorseName(horse)}</h3>
      <p className="mt-2 text-[12px] leading-relaxed text-slate-500">この馬の詳細分析は掲載していません。</p>
      {facts.length ? (
        <div className="mt-5 grid grid-cols-2 border-t border-gray-100 text-[12px] md:grid-cols-3">
          {facts.map(([label, value]) => (
            <div key={label} className="border-b border-gray-100 py-3 pr-3">
              <div className="text-[10px] font-semibold text-slate-400">{label}</div>
              <div className="mt-1 font-bold text-slate-900">{value}</div>
            </div>
          ))}
        </div>
      ) : null}
    </GlassPanel>
  );
};

const HorseDetailContent = ({ horse, rank, fieldSize, ev, compactHeader = false }) => {
  const a = horse.analysis;
  if (!isEvaluatedHorse(horse) || !a?.factors) return <HorseDataPreviewContent horse={horse} />;
  const tier = scoreTier(horse.aiScore);
  return (
    <div>
      {/* TM INDEX — 指数のブランドブロック */}
      <section className="relative">
        {!compactHeader ? (
          <>
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">
            TURF MATRIX INDEX
          </span>
          {ev && (
            <span className="flex items-center gap-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">TM Value</span>
              {valueReferenceLabel(ev) ? (
                <span className="text-[10px] font-semibold text-gray-500">{valueReferenceLabel(ev)}</span>
              ) : (
                <StarRating value={ev.stars} size={11} />
              )}
            </span>
          )}
        </div>
        <div className="mt-3 flex items-end justify-between gap-4">
          <div className="flex items-baseline gap-2">
            <Num className={`text-[52px] font-bold leading-none tracking-tight md:text-[56px] ${scoreTone(horse.aiScore)}`}>
              {horse.aiScore}
            </Num>
            <span className="text-xs text-gray-500">/ 100</span>
          </div>
          <div className="flex flex-col items-end gap-1.5 pb-1">
            {rank != null && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-600">
                レース内 <Num className="font-bold text-teal-600">{rank}</Num>位
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
          </>
        ) : null}

        <HorseQuickRead horse={horse} compact={compactHeader} />
        <TMFactorsCard analysis={a} />
      </section>

      {/* 期待値評価(自動計算) */}
      {!compactHeader ? <ValueCard ev={ev} rank={rank} popularity={horse.popularity} /> : null}

      <details className="group mt-6 border-t border-gray-100 pt-1">
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 rounded-lg py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200 [&::-webkit-details-marker]:hidden">
          <span>
            <span className="block text-[13px] font-bold text-slate-950">血統・調教を見る</span>
            <span className="mt-0.5 block text-[10px] text-slate-400">配合や追い切りを詳しく確認</span>
          </span>
          <ChevronDown size={16} className="text-slate-300 transition-transform group-open:rotate-180" />
        </summary>
        <div className="border-t border-gray-100 pb-2">
          <PedigreeCard
            pedigree={a.pedigree}
            sourcePedigree={a.pedigree?.sourcePedigree}
            score={a.factorsDetail?.blood?.score}
          />

          {a.frameEval ? (
            <section className="border-t border-gray-100 pt-6">
              <div className="flex items-center justify-between">
                <SectionLabel icon={LayoutGrid}>枠順</SectionLabel>
                <Num className={`text-[16px] font-bold ${scoreTone(a.frameEval.score)}`}>{a.frameEval.score}</Num>
              </div>
              <p className="mt-2 text-[12px] leading-6 text-slate-600">{concisePublicInsight(a.frameEval.text, 110)}</p>
            </section>
          ) : null}

          <TrainingEvalCard evalData={a.trainingEval} stablePattern={a.factorsDetail?.stable?.stablePattern} />
        </div>
      </details>
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

  const modal = (
    <div className="tm-modal-root fixed inset-0 z-[9999] overflow-hidden overscroll-none" role="dialog" aria-modal="true" aria-label={`${displayHorseName(horse)}の分析詳細`}>
      <div className="tm-fade absolute inset-0 bg-slate-900/15" onClick={onClose} />
      <div ref={sheetRef} className="tm-slideup tm-sheet absolute inset-x-0 bottom-0 flex flex-col overflow-hidden rounded-t-[2rem] border-t border-gray-200 bg-white shadow-sm">
        <div className="shrink-0 overflow-hidden border-b border-gray-200 bg-white px-5 pb-5 pt-2.5">
          <div className="relative">
            <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-gray-200" />
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="mb-3 text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-400">Runner Analysis</div>
                <div className="flex items-center gap-2">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-gray-200 bg-white shadow-sm">
                    <Num className="text-[15px] font-bold text-slate-700">{displayHorseNumber(horse.number)}</Num>
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-[15px] font-bold leading-tight tracking-tight text-slate-950">{displayHorseName(horse)}</div>
                    <div className="mt-1 text-[11px] font-medium text-slate-500">
                      {displayJockeyName(horse)} ・ 人気 <Num>{displayPopularity(horse.popularity)}</Num> ・ 単勝 <Num>{displayOdds(horse.odds, horse.oddsDetail?.status)}</Num>
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
              <div className={`mt-2 text-[18px] ${ev && isValueSignal(ev) ? "font-bold text-slate-900" : "text-gray-500"}`}>
                {ev ? (
                  <>
                    <Num>{ev.ev.toFixed(2)}</Num>
                  </>
                ) : (
                  "発表前"
                )}
              </div>
              {ev ? (
                <div className="mt-1 text-[10px] text-gray-500">
                  期待値
                </div>
              ) : null}
              {ev && valueReferenceLabel(ev) ? (
                <div className="mt-1 text-[10px] font-semibold text-gray-500">{valueReferenceLabel(ev)}</div>
              ) : null}
              {rank != null && (
                <div className="mt-1 text-[10px] text-gray-500">
                  指数<Num>{rank}</Num>位 / {fieldSize}頭
                </div>
              )}
            </div>
          </div>

          <HorseDetailContent
            horse={horse}
            rank={rank}
            fieldSize={fieldSize}
            ev={ev}
            compactHeader
          />
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
};

/* ---- 出走馬の1行(クリックで詳細) ---- */
const HorseRow = ({ horse, rank, fieldSize, ev, sortKey, expanded, onToggle, isDesktop }) => (
  <div className="border-b border-gray-200 last:border-b-0">
    <button
      onClick={onToggle}
      aria-expanded={expanded}
        className={`block w-full px-4 py-4 text-left transition-colors duration-150 hover:bg-gray-50 active:bg-gray-100/60 md:grid md:grid-cols-[2.5rem_minmax(10rem,2fr)_minmax(4rem,0.75fr)_3.5rem_5rem_3.5rem_minmax(12rem,1.15fr)] md:items-center md:gap-x-3 md:px-5 md:py-3.5 ${
        expanded ? "bg-gray-50" : "bg-white"
      }`}
    >
      <span className="md:contents">
        <span className="flex items-start justify-between gap-3 md:contents">
          <span className="flex min-w-0 items-start gap-3 md:contents">
            {/* 馬番 */}
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-gray-200 bg-white shadow-sm md:h-8 md:w-8 md:rounded-xl">
              <Num className="text-[13px] font-semibold text-gray-700">{displayHorseNumber(horse.number)}</Num>
            </span>

            {/* 馬名 + (モバイル: 騎手/人気/オッズ) */}
            <span className="min-w-0 md:block">
              <span className="block truncate text-[16px] font-bold text-slate-950 md:text-[14px]">
                {displayHorseName(horse)}
              </span>
              <span className="mt-1 block text-[11px] text-gray-500 md:hidden">
                {displayJockeyName(horse)} ・ 人気 <Num>{displayPopularity(horse.popularity)}</Num> ・ 単勝 <Num>{displayOdds(horse.odds, horse.oddsDetail?.status)}</Num>
              </span>
              <HorseRiskTags flags={horseQuickRead(horse).riskFlags} limit={1} className="mt-1.5" />
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
            {sortKey === "ev" && displayMarketGap(ev?.marketGap) ? (
              <>
                <span className="block text-[10px] font-medium uppercase tracking-wider text-gray-500">乖離度</span>
                <span className="mt-0.5 block text-[18px] font-bold leading-tight text-slate-900">
                  乖離 <Num>{displayMarketGap(ev.marketGap)}</Num>
                </span>
                {rank != null && isFiniteNumber(horse.popularity) ? (
                  <span className="mt-1 block text-[10px] text-gray-500">
                    指数<Num>{rank}</Num>位 / <Num>{horse.popularity}</Num>人気
                  </span>
                ) : null}
                <span className="mt-0.5 block text-[10px] text-gray-500">
                  期待値 <Num>{ev.ev.toFixed(2)}</Num> ・ {valueReferenceLabel(ev) ?? starText(ev.stars)}
                </span>
              </>
            ) : (
              <>
                <span className="block text-[10px] font-medium uppercase tracking-wider text-gray-500">TM VALUE</span>
                <span
                  className={`mt-0.5 block text-[12px] ${
                    ev && isValueSignal(ev) ? "font-semibold text-teal-600" : "text-gray-500"
                  }`}
                >
                  {ev ? (
                    <>
                      期待値 <Num>{ev.ev.toFixed(2)}</Num> ・ {valueReferenceLabel(ev) ?? starText(ev.stars)}
                    </>
                  ) : (
                    "未評価"
                  )}
                </span>
                {rank != null && isFiniteNumber(horse.popularity) ? (
                  <span className="mt-1 block text-[10px] text-gray-500">
                    指数<Num>{rank}</Num>位 / <Num>{horse.popularity}</Num>人気
                    {displayMarketGap(ev?.marketGap) ? <>（乖離<Num>{displayMarketGap(ev.marketGap)}</Num>）</> : null}
                  </span>
                ) : null}
              </>
            )}
          </span>
          <span className="inline-flex shrink-0 items-center gap-0.5 text-[11px] font-medium text-teal-600">
            詳細を見る
            <ChevronRight size={12} strokeWidth={1.75} />
          </span>
        </span>

        <span className="mt-2 block truncate text-[12px] text-gray-500 md:hidden">{publicHorseComment(horse, 62)}</span>
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
        {sortKey === "ev" && displayMarketGap(ev?.marketGap) ? (
          <>
            <span className="block whitespace-nowrap text-[14px] font-bold leading-tight text-slate-900">
              乖離 <Num>{displayMarketGap(ev.marketGap)}</Num>
            </span>
            {rank != null && isFiniteNumber(horse.popularity) ? (
              <span className="mt-0.5 block whitespace-nowrap text-[9px] text-gray-500">
                指数<Num>{rank}</Num>位 / <Num>{horse.popularity}</Num>人気
              </span>
            ) : null}
            <span className="mt-0.5 block whitespace-nowrap text-[9px] text-gray-500">
              単勝 <Num>{displayOdds(horse.odds, horse.oddsDetail?.status)}</Num>
            </span>
            <span className="block whitespace-nowrap text-[9px] text-gray-500">
              期待値 <Num>{ev.ev.toFixed(2)}</Num>
            </span>
          </>
        ) : (
          <>
            <Num className="block text-[13px] text-gray-600">{displayOdds(horse.odds, horse.oddsDetail?.status)}</Num>
            {ev && (
              <Num
                className={`block text-[10px] leading-tight ${
                  isValueSignal(ev) ? "font-semibold text-teal-600" : "text-gray-500"
                }`}
              >
                期待値 {ev.ev.toFixed(2)}{valueReferenceLabel(ev) ? " 注意" : ""}
              </Num>
            )}
            {rank != null && isFiniteNumber(horse.popularity) ? (
              <span className="mt-0.5 block whitespace-nowrap text-[9px] text-gray-500">
                指数<Num>{rank}</Num>位 / <Num>{horse.popularity}</Num>人気
                {displayMarketGap(ev?.marketGap) ? <>（乖離<Num>{displayMarketGap(ev.marketGap)}</Num>）</> : null}
              </span>
            ) : null}
          </>
        )}
      </span>

      {/* PC列: AI指数 */}
      <span className="hidden text-right md:block">
        <Num className={`text-[19px] font-bold ${scoreTone(horse.aiScore)}`}>{displayScore(horse.aiScore)}</Num>
      </span>

      {/* PC列: 短評 */}
      <span className="hidden items-center justify-between gap-2 md:flex">
        <span className="truncate text-[12px] text-gray-500">{publicHorseComment(horse, 82)}</span>
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
  const isGradedRace = race.raceType === "重賞" || race.category === "grade" || gradeScore(race.grade) > 0;
  const isTopTier = race.topHorse.available && scoreTier(race.topHorse.aiScore).label === "S";
  const leaderLabel = race.leaderStatus === "tied" ? "TM INDEX 1位タイ" : "TM INDEX 1位";

  return (
    <button
      onClick={() => onOpen(race.id)}
      className={`group relative w-full overflow-hidden rounded-[18px] border bg-white px-6 py-5 text-left shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors active:bg-[#F8FAFC] ${
        isGradedRace
          ? "border-[1.5px] border-[#2D7BFF]/95 before:absolute before:inset-y-4 before:left-0 before:w-1 before:rounded-r-full before:bg-[#2D7BFF] hover:border-[#2D7BFF]"
          : "border-[#DDE3EA] hover:border-[#CBD5E1]"
      }`}
    >
      <div className="relative">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
              <Num className="text-[17px] font-bold leading-none text-[#050B1E]">
                {displayRaceValue(race.time, "未発表")}
              </Num>
              <span className="min-w-0 break-words text-[16px] font-bold leading-tight text-[#050B1E]">{race.name}</span>
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
              {displayRaceValue(race.going, "未発表")}
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

        <div className="mt-4 border-t border-[#EDF0F3] pt-4">
          <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#2D7BFF]">
            {leaderLabel}
          </span>
          <span className="ml-2 text-[12px] font-semibold text-[#050B1E]">
            {race.topHorse.available ? `${race.topHorse.name} ` : null}
            <Num className={isTopTier ? "text-[#2D7BFF]" : race.topHorse.available ? "text-gray-900" : "text-gray-300"}>
              {score}
            </Num>
            {isFiniteNumber(ev) ? (
              <Num className={isValueSignal(race.topHorse.value) ? "text-[#00A9B8]" : "text-gray-500"}>
                {" "}— 期待値 {ev.toFixed(2)}{valueReferenceLabel(race.topHorse.value) ? " 注意" : ""}
              </Num>
            ) : null}
            {(race.leaderStatus === "contested" || race.leaderStatus === "tied") && race.secondHorse ? (
              <span className="ml-2 text-[10px] font-medium text-[#94A3B8]">
                {race.leaderStatus === "tied" ? "同率" : "次点"} {race.secondHorse.name} <Num>{race.secondHorse.aiScore}</Num>
              </span>
            ) : null}
          </span>
        </div>
      </div>
    </button>
  );
};

const BattleRacePanel = ({ race, onOpen }) => {
  if (!race?.indexTop) return null;
  const [opponentA, opponentB] = race.opponents ?? [];
  const axis = race.indexTop;
  const exactaPair = opponentA ? `${axis.number}-${opponentA.number}` : null;
  const widePair = opponentB && !shouldSkipWideForColdMarket(race) ? `${axis.number}-${opponentB.number}` : null;

  return (
    <section className="mt-12">
      <div className="flex items-end justify-between">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.34em] text-[#A6AFBE]">Race Selection</div>
          <h2 className="mt-1 text-[18px] font-bold tracking-tight text-[#050B1E]">本日の勝負レース</h2>
        </div>
        <span className="text-[11px] font-semibold text-[#A6AFBE]">
          {race.valuePending ? "オッズ反映前" : "オッズ反映済み"}
        </span>
      </div>
      <div className="mt-4 overflow-hidden rounded-[18px] border border-[#2D7BFF] bg-white">
        <div className="px-5 py-5 sm:px-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold text-[#64748B]">
                <Num>{race.time}</Num>
                <span>{race.track}<Num>{race.number}</Num>R</span>
                <span>{race.surface}<Num>{race.distance}</Num>m</span>
              </div>
              <div className="mt-2 text-[19px] font-bold tracking-tight text-[#050B1E]">{race.name}</div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-[9px] font-bold uppercase tracking-[0.22em] text-[#94A3B8]">TM INDEX</div>
              <Num className="mt-1 block text-[34px] font-bold leading-none text-[#2D7BFF]">{axis.tmIndex}</Num>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-1 divide-y divide-[#E2E8F0] border-y border-[#E2E8F0] sm:grid-cols-3 sm:gap-3 sm:divide-y-0 sm:border-y-0">
            <div className="grid min-w-0 grid-cols-[64px_minmax(0,1fr)] items-center gap-3 py-3 sm:block sm:rounded-lg sm:border sm:border-[#E2E8F0] sm:px-4">
              <div className="text-[9px] font-bold uppercase tracking-[0.22em] text-[#94A3B8]">軸</div>
              <div className="min-w-0 sm:mt-1.5">
                <div className="text-[13px] font-bold leading-snug text-[#050B1E] sm:text-[14px]">
                  <Num>{axis.number}</Num> {axis.name}
                </div>
                <div className="mt-1 text-[10px] text-[#64748B]">TM INDEX 1位</div>
              </div>
            </div>
            {[opponentA, opponentB].filter(Boolean).map((horse, index) => (
              <div key={horse.id} className="grid min-w-0 grid-cols-[64px_minmax(0,1fr)] items-center gap-3 py-3 sm:block sm:rounded-lg sm:border sm:border-[#E2E8F0] sm:px-4">
                <div className="text-[9px] font-bold uppercase tracking-[0.22em] text-[#94A3B8]">相手 {index + 1}</div>
                <div className="min-w-0 sm:mt-1.5">
                  <div className="text-[13px] font-bold leading-snug text-[#050B1E] sm:text-[14px]">
                    <Num>{horse.number}</Num> {horse.name}
                  </div>
                  <div className="mt-1 text-[10px] text-[#64748B]">
                    {horse.source === "evidence" ? "総合評価上位" : `TM INDEX ${index + 2}位`}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-5 border-t border-[#E5E7EB] pt-4">
            <div className="text-[9px] font-bold uppercase tracking-[0.22em] text-[#94A3B8]">参考買い目</div>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2 text-[12px] font-semibold text-[#050B1E]">
              <span>単勝 <Num>{axis.number}</Num></span>
              {exactaPair ? <span>馬連 <Num>{exactaPair}</Num></span> : null}
              {widePair ? <span>ワイド <Num>{widePair}</Num></span> : null}
            </div>
            {race.valueWatch ? (
              <div className="mt-2 text-[10px] leading-relaxed text-[#94A3B8]">
                注目穴 <Num>{race.valueWatch.number}</Num> {race.valueWatch.name}
                {isFiniteNumber(race.valueWatch.ev) ? <Num> / 期待値 {race.valueWatch.ev.toFixed(2)}</Num> : null}
              </div>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          onClick={() => onOpen(race.id, axis.id)}
          className="flex w-full items-center justify-between border-t border-[#E5E7EB] px-5 py-3 text-left text-[11px] font-semibold text-[#2D7BFF] sm:px-6"
        >
          分析を見る
          <ChevronRight size={15} />
        </button>
      </div>
    </section>
  );
};

const AllRaceSignalRows = ({ races }) => (
  <div className="divide-y divide-[#F1F5F9]">
    {races.map((race) => (
      <div key={race.id} className="grid grid-cols-[34px_minmax(0,1fr)] gap-2.5 px-4 py-3">
        <Num className="pt-0.5 text-[11px] font-bold text-[#64748B]">{race.number}R</Num>
        <div className="min-w-0">
          {race.category !== "race" ? (
            <div className="mb-1 truncate text-[9px] font-semibold text-[#94A3B8]">{race.name}</div>
          ) : null}
          <div className="flex min-w-0 items-baseline justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5 truncate text-[12px] font-bold text-[#050B1E]">
              {race.leaderStatus === "tied" ? (
                <span className="shrink-0 text-[8px] font-bold text-[#94A3B8]">1位タイ</span>
              ) : race.leaderStatus === "contested" ? (
                <span className="shrink-0 text-[8px] font-bold text-[#94A3B8]">僅差</span>
              ) : null}
              <Num className="mr-1 text-[#64748B]">{race.indexTop?.number}</Num>
              <span className="truncate">{race.indexTop?.name ?? "未評価"}</span>
            </div>
            <Num className={`shrink-0 text-[14px] font-bold ${race.indexTop?.tmIndex >= 80 ? "text-[#2D7BFF]" : "text-[#050B1E]"}`}>
              {race.indexTop?.tmIndex ?? "--"}
            </Num>
          </div>
          <div className="mt-1 truncate text-[9px] font-semibold text-[#475569]">
            相手 {race.opponents?.map((horse) => `${horse.number} ${horse.name}`).join(" / ") || "未評価"}
          </div>
          {race.valueWatch ? (
            <div className="mt-0.5 truncate text-[9px] font-medium text-[#00A9B8]">
              注目穴 <Num>{race.valueWatch.number}</Num> {race.valueWatch.name}
            </div>
          ) : null}
        </div>
      </div>
    ))}
  </div>
);

const AllRaceSignalsPanel = ({ data }) => {
  const tracks = [...new Set((data?.races ?? []).map((race) => race.track))];
  const trackKey = tracks.join("|");
  const [openTrack, setOpenTrack] = useState(null);

  useEffect(() => {
    setOpenTrack((current) => current && !tracks.includes(current) ? null : current);
  }, [trackKey]);

  if (!data?.races?.length) return null;
  const evaluatedRaces = data.races.filter((race) => isFiniteNumber(race.indexTop?.tmIndex));
  const racesByTrack = tracks.map((track) => ({
    track,
    races: evaluatedRaces
      .filter((race) => race.track === track)
      .sort((left, right) => left.number - right.number),
  })).filter((group) => group.races.length);

  return (
    <section className="mt-14">
      <div className="flex items-end justify-between">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.34em] text-[#A6AFBE]">All Race Signals</div>
          <h2 className="mt-1 text-[18px] font-bold tracking-tight text-[#050B1E]">3会場 レースシグナル</h2>
        </div>
        <span className="text-[11px] font-semibold text-[#A6AFBE]">
          <Num className="text-[#64748B]">{evaluatedRaces.length}</Num>レース掲載
        </span>
      </div>
      <div className="mt-4 overflow-hidden rounded-[18px] border border-[#DDE3EA] bg-white">
        <div className="divide-y divide-[#E5E7EB] md:hidden">
          {racesByTrack.map(({ track, races }) => {
            const isOpen = openTrack === track;
            return (
              <div key={track}>
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setOpenTrack((current) => current === track ? null : track)}
                  className="flex w-full items-center justify-between gap-4 px-4 py-3.5 text-left"
                >
                  <span className="text-[13px] font-bold text-[#050B1E]">{track}</span>
                  <span className="flex items-center gap-2 text-[10px] font-semibold text-[#64748B]">
                    <Num>{races.length}</Num>レース
                    <ChevronDown
                      size={16}
                      className={`text-[#94A3B8] transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                    />
                  </span>
                </button>
                {isOpen ? (
                  <div className="border-t border-[#E5E7EB]">
                    <AllRaceSignalRows races={races} />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
        <div className="hidden grid-cols-3 divide-x divide-[#E5E7EB] md:grid">
          {racesByTrack.map(({ track, races }) => (
            <div key={track}>
              <div className="border-b border-[#E5E7EB] px-4 py-3 text-[12px] font-bold text-[#050B1E]">{track}</div>
              <AllRaceSignalRows races={races} />
            </div>
          ))}
        </div>
        {evaluatedRaces.length ? (
          <div className="border-t border-[#E5E7EB] px-4 py-3 text-[10px] leading-relaxed text-[#94A3B8]">
            <div className="font-medium text-[#64748B]">分析が完了したレースのみ掲載しています。</div>
            <div className="mt-1">同指数は1位タイ、指数差1〜2点は僅差、3点以上は単独首位として扱います。相手1はTM INDEX 2位、相手2は3〜5位から総合評価で選び、高期待値馬は注目穴として分離します。</div>
          </div>
        ) : null}
      </div>
    </section>
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
  const [races, setRaces] = useState(null);
  const [ranking, setRanking] = useState(null);

  useEffect(() => {
    dataProvider.getMeta().then(setMeta);
    dataProvider.getRaces().then(setRaces);
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
  const allRaceSignalData = meta?.date === allRaceSignals.date ? allRaceSignals : null;
  const battleRace = allRaceSignalData?.races?.find((race) => race.id === allRaceSignalData.battleRaceId) ?? null;
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
                  {displayRaceValue(featuredRace.going, "未発表")}
                  {isFiniteNumber(featuredRace.fieldSize) ? (
                    <>
                      <span className="mx-1.5">・</span>
                      <Num>{featuredRace.fieldSize}</Num>頭
                    </>
                  ) : null}
                  <span className="mx-1.5">・</span>
                  発走 <Num>{displayRaceValue(featuredRace.time, "未発表")}</Num>
                </div>
              </div>
              <div className="mt-7 flex items-end justify-between gap-3 sm:gap-5">
                <div className="min-w-0">
                  <div className="text-[10px] font-bold uppercase tracking-[0.28em] text-[#A6AFBE]">
                    {featuredRace.topHorse.available ? "TM INDEX" : "TM INDEX"}
                  </div>
                  {featuredRace.topHorse.available ? (
                    <div className="mt-2 whitespace-nowrap text-[14px] font-bold leading-tight text-[#050B1E] min-[360px]:text-[15px]">{featuredRace.topHorse.name}</div>
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
                    <div className="mt-3 text-xs font-medium text-gray-400">出走馬確定後に表示します</div>
                  )}
                  {isFiniteNumber(featuredRace.topHorse.aiScore) ? <IndexUnderline /> : null}
                </div>
                {featuredRace.topHorse.available ? (
                <div className="w-[122px] shrink-0 pb-1 text-right min-[360px]:w-[145px] sm:w-auto">
                  <div className="text-[10px] font-bold uppercase tracking-[0.34em] text-[#2D7BFF]">
                    {featuredRace.leaderStatus === "tied" ? "TM INDEX 1位タイ" : "TM INDEX 1位"}
                  </div>
                  <div className="mt-2 max-w-[122px] text-[10px] font-semibold leading-relaxed text-[#050B1E] min-[360px]:max-w-[145px] min-[360px]:text-[11px] sm:max-w-[230px] sm:text-[12px]">
                    {isFiniteNumber(featuredRace.topHorse.popularity) && isFiniteNumber(featuredRace.topHorse.ev)
                      ? <>{featuredRace.leaderStatus === "tied" ? "指数1位タイ。" : "指数1位。"}市場評価は<Num>{featuredRace.topHorse.popularity}</Num>人気。 期待値 <Num>{featuredRace.topHorse.ev.toFixed(2)}</Num></>
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

      <BattleRacePanel race={battleRace} onOpen={onOpenRace} />
      <AllRaceSignalsPanel data={allRaceSignalData} />

      {/* 今日のレース */}
      <section className="mt-12">
        <div className="flex items-end justify-between">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.34em] text-[#A6AFBE]">Race Intelligence</div>
            <h2 className="mt-1 text-[18px] font-bold tracking-tight text-[#050B1E]">掲載レース詳細</h2>
          </div>
          <span className="text-[11px] font-semibold text-[#A6AFBE]">
            {formatRaceWeekday(meta?.date)}曜・<Num>{races?.length ?? meta?.raceCount ?? 0}</Num>レース
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

      <section className="mt-16">
        <div className="flex items-end justify-between gap-4">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400">Daily Intelligence</div>
            <h2 className="mt-1 text-[18px] font-bold tracking-tight text-slate-950">本日の注目馬</h2>
          </div>
          <span className="text-right text-[10px] font-medium text-slate-400">
            <Num>{meta?.raceCount ?? races?.length ?? 0}</Num>レース・<Num>{meta?.horseCount ?? 0}</Num>頭を比較
          </span>
        </div>
        <div className="mt-4 overflow-hidden rounded-[18px] border border-[#DDE3EA] bg-white">
          {ranking
            ? ranking.length
              ? ranking.map((item, index) => {
                  const quickRead = horseQuickRead(item.horse);
                  return (
                    <button
                      key={`${item.raceId}-${item.horse.id}`}
                      onClick={() => onOpenRace(item.raceId, item.horse.id)}
                      className={`grid w-full grid-cols-[2rem_minmax(0,1fr)_3.25rem] items-center gap-3 border-b border-gray-100 px-4 py-4 text-left transition-colors last:border-b-0 hover:bg-gray-50/70 active:bg-gray-100/60 md:px-5 ${index === 0 ? "bg-blue-50/30" : ""}`}
                    >
                      <Num className={`text-[13px] font-bold ${index === 0 ? "text-[#2D7BFF]" : "text-slate-400"}`}>
                        {String(index + 1).padStart(2, "0")}
                      </Num>
                      <span className="min-w-0">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-[14px] font-bold text-slate-950">{displayHorseName(item.horse)}</span>
                          {index === 0 ? (
                            <span className="shrink-0 rounded-md bg-[#2D7BFF] px-1.5 py-0.5 text-[9px] font-bold text-white">最高評価</span>
                          ) : null}
                        </span>
                        <span className="mt-1 flex min-w-0 items-center gap-2 text-[10px] text-slate-400">
                          <span className="shrink-0 font-medium text-slate-500">
                            {item.raceLabel}・{item.horse.number ? <><Num>{item.horse.number}</Num>番</> : "馬番未確定"}
                          </span>
                          {quickRead.strengths.length ? (
                            <span className="truncate">
                              強み {quickRead.strengths.slice(0, 2).map((factor) => `${factor.label} ${displayFactorScore(factor.score)}`).join("・")}
                            </span>
                          ) : null}
                        </span>
                      </span>
                      <span className="text-right">
                        <span className="block text-[8px] font-bold uppercase tracking-[0.14em] text-slate-400">TM INDEX</span>
                        <Num className={`mt-1 block text-[24px] font-bold leading-none ${scoreTone(item.horse.aiScore)}`}>
                          {item.horse.aiScore}
                        </Num>
                      </span>
                    </button>
                  );
                })
              : (
                <div className="px-5 py-8 text-center text-[13px] font-medium text-slate-400">{WEEK_PREPARING_TEXT}</div>
              )
            : [0, 1, 2, 3, 4].map((index) => <Skeleton key={index} className="m-3 h-12" />)}
        </div>
      </section>
    </main>
  );
};

const RaceUpdatePanel = ({ updateDiff }) => {
  const events = updateDiff?.events ?? [];
  if (!events.length) return null;
  const visibleEvents = events.slice(0, 4);
  const hiddenCount = Math.max(0, events.length - visibleEvents.length);
  const previousTime = formatPublicUpdateTime(updateDiff.previousUpdatedAt);
  const currentTime = formatPublicUpdateTime(updateDiff.currentUpdatedAt);

  return (
    <div className="border-t border-slate-200 bg-[#F8FBFC] px-4 py-4 md:px-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-[#00A9B8]" aria-hidden="true" />
          <h3 className="text-[13px] font-bold text-slate-900">前回更新から</h3>
        </div>
        {previousTime && currentTime && previousTime !== currentTime ? (
          <div className="flex items-center gap-1 text-[10px] font-medium text-slate-400">
            <Num>{previousTime}</Num>
            <ChevronRight size={11} strokeWidth={1.8} aria-hidden="true" />
            <Num className="text-slate-600">{currentTime}</Num>
          </div>
        ) : null}
      </div>

      <div className="mt-3 grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 md:grid-cols-2">
        {visibleEvents.map((event, index) => (
          <div
            key={event.id}
            className={`flex min-h-14 items-center justify-between gap-3 bg-white px-3 py-2.5 ${
              visibleEvents.length % 2 === 1 && index === visibleEvents.length - 1 ? "md:col-span-2" : ""
            }`}
          >
            <div className="min-w-0">
              <div className="truncate text-[12px] font-bold text-slate-900">
                {event.horseNumber ? <Num className="mr-1 text-slate-400">{event.horseNumber}</Num> : null}
                {event.horseName ?? event.label}
              </div>
              {event.horseName ? <div className="mt-0.5 text-[10px] font-medium text-slate-500">{event.label}</div> : null}
            </div>
            <div className="flex shrink-0 items-center gap-1 text-[11px] font-bold">
              <span className="text-slate-400">{event.before}</span>
              <ChevronRight size={12} strokeWidth={2} className="text-[#00A9B8]" aria-hidden="true" />
              <span className={event.tone === "warning" ? "text-[#B7791F]" : "text-slate-900"}>{event.after}</span>
            </div>
          </div>
        ))}
      </div>
      {hiddenCount ? (
        <p className="mt-2 text-right text-[10px] font-medium text-slate-400">重要な変更を優先表示・ほか<Num>{hiddenCount}</Num>件</p>
      ) : null}
    </div>
  );
};

const RolePerformancePanel = ({ performance }) => {
  const value = performance?.roles?.value;
  const danger = performance?.roles?.danger;
  if (!value?.sampleSize && !danger?.sampleSize) return null;

  return (
    <details className="group border-t border-slate-200 bg-[#F8FBFC]">
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-left md:px-5 [&::-webkit-details-marker]:hidden">
        <span>
          <span className="block text-[12px] font-bold text-slate-900">注目穴・危険な人気馬の過去検証</span>
          <span className="mt-0.5 block text-[10px] font-medium text-slate-500">
            注目穴 3着内<Num>{value?.topThreeRate ?? "-"}</Num>%・危険馬の馬券外<Num>{danger?.missedTopThreeRate ?? "-"}</Num>%
          </span>
        </span>
        <ChevronDown size={15} strokeWidth={1.8} className="shrink-0 text-slate-400 transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="grid border-t border-slate-200 sm:grid-cols-2">
        <div className="px-4 py-4 sm:border-r sm:border-slate-200 md:px-5">
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-[#008C99]">
            <Star size={13} strokeWidth={1.8} aria-hidden="true" />
            注目穴
          </div>
          <dl className="mt-3 grid grid-cols-3 gap-3">
            <div>
              <dt className="text-[9px] font-semibold text-slate-400">3着内率</dt>
              <dd className="mt-1 text-[16px] font-bold text-slate-950"><Num>{value?.topThreeRate ?? "-"}</Num>%</dd>
            </div>
            <div>
              <dt className="text-[9px] font-semibold text-slate-400">単勝回収率</dt>
              <dd className="mt-1 text-[16px] font-bold text-slate-950"><Num>{value?.winReturnRate ?? "-"}</Num>%</dd>
            </div>
            <div>
              <dt className="text-[9px] font-semibold text-slate-400">複勝回収率</dt>
              <dd className="mt-1 text-[16px] font-bold text-slate-950"><Num>{value?.placeReturnRate ?? "-"}</Num>%</dd>
            </div>
          </dl>
          <p className="mt-2 text-[10px] font-medium text-slate-400"><Num>{value?.topThree ?? 0}</Num>/<Num>{value?.sampleSize ?? 0}</Num>頭が3着以内</p>
        </div>
        <div className="border-t border-slate-200 px-4 py-4 sm:border-t-0 md:px-5">
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-[#B7791F]">
            <ShieldAlert size={13} strokeWidth={1.8} aria-hidden="true" />
            危険な人気馬
          </div>
          <dl className="mt-3 grid grid-cols-3 gap-3">
            <div>
              <dt className="text-[9px] font-semibold text-slate-400">馬券外率</dt>
              <dd className="mt-1 text-[16px] font-bold text-slate-950"><Num>{danger?.missedTopThreeRate ?? "-"}</Num>%</dd>
            </div>
            <div>
              <dt className="text-[9px] font-semibold text-slate-400">1着率</dt>
              <dd className="mt-1 text-[16px] font-bold text-slate-950"><Num>{danger?.winRate ?? "-"}</Num>%</dd>
            </div>
            <div>
              <dt className="text-[9px] font-semibold text-slate-400">検証数</dt>
              <dd className="mt-1 text-[16px] font-bold text-slate-950"><Num>{danger?.sampleSize ?? 0}</Num>頭</dd>
            </div>
          </dl>
          <p className="mt-2 text-[10px] font-medium text-slate-400"><Num>{danger?.missedTopThree ?? 0}</Num>/<Num>{danger?.sampleSize ?? 0}</Num>頭が4着以下</p>
        </div>
      </div>
      <p className="border-t border-slate-200 px-4 py-3 text-[9px] font-medium leading-relaxed text-slate-400 md:px-5">
        注目穴は指数と人気の差、危険馬は上位人気と指数順位の3段差で選定。発走前に固定した過去<Num>{performance.raceDays}</Num>日分で検証。
      </p>
    </details>
  );
};

const RaceConclusionPanel = ({ conclusion, updateDiff, onSelectHorse }) => {
  if (!conclusion) return null;
  const items = [
    { key: "favorite", label: "本命", icon: Target, tone: "text-[#00A9B8]" },
    { key: "challenger", label: "逆転候補", icon: TrendingUp, tone: "text-[#2D7BFF]" },
    { key: "value", label: "注目穴", icon: Star, tone: "text-[#00A9B8]" },
    { key: "danger", label: "危険な人気馬", icon: ShieldAlert, tone: "text-[#B7791F]" },
    { key: "key", label: "レースの鍵", icon: KeyRound, tone: "text-slate-500" },
  ];

  return (
    <section className="mt-8" aria-labelledby="race-conclusion-title">
      <div className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between md:gap-6">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.28em] text-[#00A9B8]">Race Verdict</div>
          <h2 id="race-conclusion-title" className="mt-1 text-[20px] font-bold tracking-tight text-slate-950">AI結論</h2>
        </div>
        <p className="max-w-xl text-[13px] font-medium leading-relaxed text-slate-500 md:text-right">
          {conclusion.summary}
        </p>
      </div>

      <div className="mt-4 overflow-hidden border-y border-slate-200 bg-white">
        <div className="grid grid-cols-2 lg:grid-cols-5">
          {items.map(({ key, label, icon: Icon, tone }) => {
            const item = conclusion[key];
            const interactive = Boolean(item.horse?.id);
            const Element = interactive ? "button" : "div";
            return (
              <Element
                key={key}
                {...(interactive ? { type: "button", onClick: () => onSelectHorse(item.horse.id) } : {})}
                className={`min-h-[162px] border-b border-slate-200 px-4 py-4 text-left odd:border-r last:col-span-2 last:border-b-0 last:border-r-0 lg:col-span-1 lg:min-h-[178px] lg:border-b-0 lg:border-r lg:last:col-span-1 lg:last:border-r-0 ${
                  interactive ? "transition-colors hover:bg-[#F7FCFD] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#8EDFE4]" : ""
                }`}
                aria-label={interactive ? `${label} ${item.value}の分析を見る` : undefined}
              >
                <div className={`flex items-center gap-1.5 text-[11px] font-bold ${tone}`}>
                  <Icon size={14} strokeWidth={1.8} aria-hidden="true" />
                  {label}
                </div>
                <div className="mt-3 min-w-0">
                  <div className="min-w-0 break-words text-[15px] font-bold leading-snug text-slate-950">
                    {item.horse?.number ? <Num className="mr-1 text-slate-500">{item.horse.number}</Num> : null}
                    {item.value}
                  </div>
                  {item.horse?.score != null ? (
                    <div className="mt-1 flex items-baseline gap-1.5">
                      <span className="text-[8px] font-bold uppercase tracking-[0.12em] text-slate-400">TM INDEX</span>
                      <Num className="text-[16px] font-bold text-slate-950">{item.horse.score}</Num>
                    </div>
                  ) : null}
                  <HorseRiskTags flags={item.horse?.riskFlags ?? []} limit={2} className="mt-2" />
                </div>
                <p className="mt-2 text-[12px] font-medium leading-[1.6] text-slate-500">
                  {item.note}
                </p>
              </Element>
            );
          })}
        </div>
        <RolePerformancePanel performance={rolePerformance} />
        <RaceUpdatePanel updateDiff={updateDiff} />
      </div>
    </section>
  );
};

/* ---- レース詳細ページ ---- */
const RacePage = ({ raceId, initialHorseId, onBack }) => {
  const [race, setRace] = useState(null);
  const [sortKey, setSortKey] = useState("score");
  const [showAllHorses, setShowAllHorses] = useState(false);
  const [expandedId, setExpandedId] = useState(null); // PC: インライン展開
  const [sheetHorse, setSheetHorse] = useState(null); // モバイル: ボトムシート
  const isDesktop = useIsDesktop();

  /* Rank・期待値はロジック層で自動計算(手入力不要) */
  const rankMap = useMemo(() => (race ? rankByScore(race.horses) : {}), [race]);
  const evMap = useMemo(
    () =>
      race && race.horses.length
        ? Object.fromEntries(race.horses.map((h) => [h.id, valueMetricsFor(h)]))
        : {},
    [race]
  );
  const raceConclusion = useMemo(() => (race ? buildRacePublicConclusion(race) : null), [race]);
  const sortedHorses = useMemo(
    () => (race ? sortHorses(race.horses, sortKey, evMap, rankMap) : []),
    [race, sortKey, evMap, rankMap]
  );
  const visibleHorses = showAllHorses ? sortedHorses : sortedHorses.slice(0, 6);
  const hiddenHorseCount = Math.max(0, sortedHorses.length - visibleHorses.length);

  useEffect(() => {
    setShowAllHorses(false);
    setExpandedId(null);
  }, [raceId, initialHorseId, sortKey]);

  useEffect(() => {
    setRace(null);
    dataProvider.getRace(raceId).then((r) => {
      setRace(r);
      if (initialHorseId && r) {
        const h = r.horses.find((x) => x.id === initialHorseId);
        if (h) {
              if (window.matchMedia("(min-width: 768px)").matches) {
                const initialPosition = [...r.horses]
                  .sort((a, b) => (b.aiScore ?? -1) - (a.aiScore ?? -1) || a.number - b.number)
                  .findIndex((candidate) => candidate.id === h.id);
                setShowAllHorses(initialPosition >= 6);
                setExpandedId(h.id);
              }
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
  const handleConclusionHorse = useCallback((horseId) => {
    const horse = race?.horses?.find((candidate) => candidate.id === horseId);
    if (horse) handleToggle(horse);
  }, [race, handleToggle]);

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
                    <Num className="text-[12px] font-semibold text-slate-700">{displayRaceValue(race.time, "未発表")}</Num>
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
              <span>天候 {displayRaceValue(race.weather, "未発表")}</span>
              <span>馬場 {displayRaceValue(race.going, "未発表")}</span>
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
            </div>
          </div>
        ) : (
          <Skeleton className="mt-4 h-24" />
        )}
      </div>

      <RaceConclusionPanel conclusion={raceConclusion} updateDiff={race?.updateDiff} onSelectHorse={handleConclusionHorse} />

      {/* ファクター比較(全馬横断) */}
      {race && race.horses.some(isEvaluatedHorse) && <ComparisonTable horses={race.horses} evMap={evMap} onSelect={handleToggle} />}

      {/* 並び替え(モバイル: 全幅・親指で押しやすい高さ) */}
      <div className="mt-8 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400">Runner Matrix</div>
          <h2 className="mt-1 text-[18px] font-bold tracking-tight text-slate-950">出走馬の評価</h2>
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
        <div className="hidden grid-cols-[2.5rem_minmax(10rem,2fr)_minmax(4rem,0.75fr)_3.5rem_5rem_3.5rem_minmax(12rem,1.15fr)] gap-x-3 border-b border-gray-200 bg-gray-50/60 px-5 py-2 text-[10px] font-semibold uppercase tracking-wider text-gray-500 md:grid">
          <span>馬番</span>
          <span>馬名</span>
          <span>騎手</span>
          <span className="text-right">人気</span>
          <span className="text-right">{sortKey === "ev" ? "乖離 / 期待値" : "単勝 / 期待値"}</span>
          <span className="text-right">TM INDEX</span>
          <span>短評</span>
        </div>

        {race
          ? visibleHorses.length
            ? visibleHorses.map((h) => (
              <HorseRow
                key={h.id}
                horse={h}
                rank={rankMap[h.id]}
                fieldSize={race.fieldSize}
                ev={evMap[h.id]}
                sortKey={sortKey}
                expanded={expandedId === h.id}
                onToggle={() => handleToggle(h)}
                isDesktop={isDesktop}
              />
            ))
            : (
              <div className="px-5 py-10 text-center text-[13px] font-medium text-slate-400">
                {sortKey === "ev"
                  ? race.oddsStatus === "active"
                    ? "現在、期待値が基準を満たす馬はいません"
                    : "オッズ発表後に期待値を表示します"
                  : WEEK_PREPARING_TEXT}
              </div>
            )
          : [0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="m-3 h-14" />)}
        {race && sortedHorses.length > 6 ? (
          <button
            type="button"
            onClick={() => {
              setShowAllHorses((current) => !current);
              if (showAllHorses) setExpandedId(null);
            }}
            aria-expanded={showAllHorses}
            className="flex min-h-12 w-full items-center justify-center gap-2 border-t border-gray-200 bg-gray-50/70 px-4 py-3 text-[12px] font-bold text-slate-700 transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-200"
          >
            {showAllHorses ? "上位6頭に戻す" : `残り${hiddenHorseCount}頭を見る`}
            <ChevronDown size={15} className={`text-slate-400 transition-transform ${showAllHorses ? "rotate-180" : ""}`} />
          </button>
        ) : null}
      </div>

      <p className="mt-3 text-[11px] text-gray-500">
        {isDesktop ? "行をクリックすると分析詳細が展開されます。" : "馬をタップすると分析詳細が開きます。"}
        {sortKey === "ev"
          ? "期待値タブは、指数順位より人気が低く、オッズに妙味がある馬を表示します。"
          : "期待値は、TM INDEXの評価に対してオッズに妙味があるかを示します。"}
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
  const [glossaryOpen, setGlossaryOpen] = useState(false);

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
          height: 97vh;          /* 主情報をほぼ最上部まで持ち上げる */
          height: 97dvh;         /* 100vh問題の回避(動的ビューポート) */
          max-height: 97vh;      /* dvh非対応ブラウザ向けフォールバック */
          max-height: 97dvh;
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

        <Footer onOpenGlossary={() => setGlossaryOpen(true)} />
      </div>
      {glossaryOpen ? <GlossaryModal onClose={() => setGlossaryOpen(false)} /> : null}
    </div>
  );
}
