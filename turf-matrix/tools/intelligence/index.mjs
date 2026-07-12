// TURF MATRIX Intelligence Layer v1 skeleton.
// Keep deterministic scoring here; parsers/normalizers stay upstream and UI stays downstream.

import { FACTOR_KEYS, RACE_DAY_CONDITION } from "./constants.mjs";
import { scoreBlood, buildPedigreeAnalysis } from "./blood-ai.mjs";



const clamp = (value, min = 35, max = 96) => Math.max(min, Math.min(max, Math.round(value)));
const avg = (values, fallback = 60) => {
  const nums = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  return nums.length ? nums.reduce((sum, value) => sum + value, 0) / nums.length : fallback;
};
const normalizeHorseKey = (value) =>
  String(value ?? "")
    .normalize("NFKC")
    .replace(/\u3000/g, " ")
    .replace(/\s+/g, "")
    .trim();

const hasInvalidNumber = (value) => typeof value === "number" && !Number.isFinite(value);

const findInvalidNumbers = (value, path = "$", errors = []) => {
  if (hasInvalidNumber(value)) errors.push(path);
  if (Array.isArray(value)) {
    value.forEach((item, index) => findInvalidNumbers(item, `${path}[${index}]`, errors));
  } else if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, item]) => findInvalidNumbers(item, `${path}.${key}`, errors));
  }
  return errors;
};

const duplicates = (values) => {
  const seen = new Set();
  const duplicated = new Set();
  for (const value of values) {
    if (value == null || value === "") continue;
    if (seen.has(value)) duplicated.add(value);
    seen.add(value);
  }
  return [...duplicated];
};

const scoreZi = (horse) => clamp(42 + ((horse.odds?.zi ?? 95) - 80) * 1.3);

const scoreRecentForm = (horse) => {
  const runs = (horse.pastRuns ?? []).slice(0, 5);
  if (!runs.length) return 50;
  return clamp(
    avg(
      runs.map((run, index) => {
        const field = run.fieldSize || 16;
        const finish = run.finishPosition || field;
        const finishScore = ((field - finish + 1) / field) * 100;
        const marginScore = run.margin == null ? 60 : 72 - run.margin * 18;
        const recentWeight = 1 - index * 0.08;
        return (finishScore * 0.55 + marginScore * 0.45) * recentWeight;
      })
    )
  );
};

const scoreDistance = (horse) => {
  const target = horse.currentRace?.distance ?? 2000;
  const runs = horse.pastRuns ?? [];
  const relevant = runs
    .filter((run) => run.surface === horse.currentRace?.surface)
    .map((run) => Math.max(0, 100 - Math.abs((run.distance ?? target) - target) / 8));
  return clamp(avg(relevant.slice(0, 12), 58));
};

const scoreCourse = (horse) => {
  const runs = horse.pastRuns ?? [];
  const sameCourse = runs.filter((run) => run.course === horse.currentRace?.course);
  const sameSurface = runs.filter((run) => run.surface === horse.currentRace?.surface);
  const sameCourseScore = sameCourse.length ? 62 + Math.min(18, sameCourse.length * 3) : 52;
  const surfaceScore = sameSurface.length ? 58 + Math.min(18, sameSurface.length) : 50;
  return clamp(sameCourseScore * 0.55 + surfaceScore * 0.45);
};

const scoreLap = (horse) => {
  const runs = (horse.pastRuns ?? []).filter((run) => typeof run.last3F === "number").slice(0, 8);
  if (!runs.length) return 55;
  return clamp(avg(runs.map((run) => 92 - (run.last3F - 33) * 8)));
};

const scorePace = (horse) => {
  const orders = (horse.pastRuns ?? [])
    .slice(0, 8)
    .flatMap((run) => run.passingOrder ?? [])
    .filter((value) => typeof value === "number" && value > 0);
  if (!orders.length) return 58;
  const mean = avg(orders, 8);
  return clamp(76 - Math.abs(mean - 6) * 3.5);
};

const trainingThreshold = (type, stableSide) => {
  if (type === "slope") {
    return stableSide === "栗"
      ? { "4F": 52.9, "3F": 38.9, "2F": 25.9, "1F": 13.4 }
      : { "4F": 49.9, "3F": 35.9, "2F": 23.9, "1F": 12.8 };
  }
  return { "4F": 50.0, "3F": 36.8, "2F": 24.4, "1F": 12.0 };
};

const toSessionDateValue = (dateText) => {
  const match = String(dateText ?? "").match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/);
  if (!match) return 0;
  return Number(match[1]) * 10000 + Number(match[2]) * 100 + Number(match[3]);
};

const sessionDay = (dateText) => {
  const match = String(dateText ?? "").match(/\d{4}\.\s*\d{1,2}\.\s*(\d{1,2})/);
  return match ? Number(match[1]) : null;
};

const lapValues = (lap) =>
  [lap?.lap4, lap?.lap3, lap?.lap2, lap?.lap1].filter((value) => typeof value === "number" && Number.isFinite(value));

const formatSession = (session) => {
  if (!session) return "時計未取得";
  const type = session.type === "wood" ? "ウッド" : "坂路";
  const course = session.course ? `${session.course}` : type;
  return `${session.date ?? "日付不明"} ${course} 4F${session.f4 ?? "-"}-1F${session.f1 ?? "-"}`;
};

const sessionScore = (session, stableSide) => {
  const threshold = trainingThreshold(session.type, stableSide);
  const f4Gap = typeof session.f4 === "number" ? threshold["4F"] - session.f4 : -8;
  const f1Gap = typeof session.f1 === "number" ? threshold["1F"] - session.f1 : -4;
  const values = lapValues(session.lap);
  const accel = values.length >= 2 && values.at(-1) <= values.at(-2);
  const strongFinish = typeof session.f1 === "number" && session.f1 <= threshold["1F"];
  const verySharpFinish = typeof session.f1 === "number" && session.f1 <= threshold["1F"] - 0.5;
  const typeBase = session.type === "wood" ? 63 : 60;

  return clamp(
    typeBase +
      Math.max(-8, Math.min(14, f4Gap * 4.2)) +
      Math.max(-8, Math.min(18, f1Gap * 5.5)) +
      (accel ? 7 : -2) +
      (strongFinish ? 5 : 0) +
      (verySharpFinish ? 4 : 0),
    45,
    94
  );
};

const collectTrainingSessions = (horse) => {
  const slope = (horse.training?.slope ?? []).map((item) => ({
    type: "slope",
    date: item.date,
    trainer: item.trainer,
    f4: item["4F"],
    f3: item["3F"],
    f2: item["2F"],
    f1: item["1F"],
    lap: item.lap,
  }));
  const wood = (horse.training?.wood ?? []).map((item) => ({
    type: "wood",
    date: item.date,
    trainer: item.trainer,
    course: item.course,
    direction: item.direction,
    f4: item.times?.["4F"],
    f3: item.times?.["3F"],
    f2: item.times?.["2F"],
    f1: item.times?.["1F"],
    lap: item.lap,
  }));
  return [...slope, ...wood].filter((session) => typeof session.f1 === "number" || typeof session.f4 === "number");
};

const buildTrainingAnalysis = (horse) => {
  const stableSide = horse.currentRace?.stableSide ?? horse.stableSide ?? "";
  const sessions = collectTrainingSessions(horse)
    .map((session) => ({ ...session, score: sessionScore(session, stableSide), dateValue: toSessionDateValue(session.date) }))
    .sort((a, b) => b.dateValue - a.dateValue);

  if (!sessions.length) {
    return {
      score: 50,
      lapScore: 50,
      grade: "C",
      status: "未取得",
      count: 0,
      summary: "調教時計は未取得。調教面は評価に強く反映していません。",
      finalText: "最終追切の時計が取れていないため、調教評価は参考扱いです。",
      patternText: "調教時計の裏付けは未取得です。",
      strengths: ["調教時計は未取得"],
    };
  }

  const best = [...sessions].sort((a, b) => b.score - a.score)[0];
  const finalCandidates = sessions.filter((session) => session.dateValue >= 20260708 && session.dateValue <= 20260709);
  const final = finalCandidates[0] ?? sessions[0];
  const latest = sessions[0];
  const lightAfterFinal = latest?.dateValue > final?.dateValue ? latest : null;
  const fastFinish = sessions.filter((session) => {
    const threshold = trainingThreshold(session.type, stableSide);
    return typeof session.f1 === "number" && session.f1 <= threshold["1F"];
  }).length;
  const accelCount = sessions.filter((session) => {
    const values = lapValues(session.lap);
    return values.length >= 2 && values.at(-1) <= values.at(-2);
  }).length;
  const activeCount = sessions.filter((session) => session.score >= 70).length;
  const score = clamp(best.score * 0.5 + final.score * 0.3 + Math.min(10, activeCount * 2) + Math.min(8, fastFinish * 2));
  const lapScore = clamp(score + Math.min(6, accelCount * 1.5) - (accelCount ? 0 : 4));
  const grade = score >= 84 ? "A" : score >= 74 ? "B" : score >= 62 ? "C" : "D";

  const strengths = [
    best.score >= 76 ? `好時計: ${formatSession(best)}` : `基準時計: ${formatSession(best)}`,
    fastFinish ? `終い基準クリア ${fastFinish}本` : "終いの強調材料は控えめ",
    accelCount ? `加速ラップ ${accelCount}本` : "加速ラップは目立たず",
  ];

  return {
    score,
    lapScore,
    grade,
    status: "取得済み",
    count: sessions.length,
    best,
    final,
    lightAfterFinal,
    fastFinish,
    accelCount,
    activeCount,
    strengths,
    summary: `${sessions.length}本の時計から、${strengths.join(" / ")}。`,
    finalText: `${formatSession(final)}。水曜/木曜の最終追切として${final.score >= 74 ? "動きの良さを評価できます" : final.score >= 62 ? "標準的な内容です" : "強調材料は控えめです"}。${lightAfterFinal ? ` ${formatSession(lightAfterFinal)}は直前軽めとして扱います。` : ""}`,
    patternText: `${formatSession(best)}が最も評価できる時計。${fastFinish ? "終いの反応も確認できます。" : "終いの反応は強調しすぎない評価です。"}`,
  };
};

const scoreTraining = (horse) => {
  return buildTrainingAnalysis(horse).score;
};

const scoreValue = (horse, abilityScore) => {
  if (!horse.odds?.winOdds || !horse.odds?.popularity) return 50;
  const popularity = horse.odds.popularity;
  const odds = horse.odds.winOdds;
  const gapBonus = (abilityScore - 65) * 0.45 + Math.max(0, popularity - 4) * 2.2;
  const longOddsRisk = odds > 50 ? (odds - 50) * 0.18 : 0;
  return clamp(52 + gapBonus - longOddsRisk);
};

const frameScore = (number) => {
  if (number <= 4) return 68;
  if (number <= 10) return 64;
  if (number <= 14) return 60;
  return 58;
};

const confidenceFor = (horse, factors) => {
  if (horse.dataStatus?.training === "missing") return "mid";
  if (horse.pastRuns?.length >= 8 && horse.pedigree && horse.odds?.status === "active") return "high";
  return "mid";
};

const gradeForTraining = (score) => (score >= 82 ? "A" : score >= 72 ? "B" : score >= 60 ? "C" : "D");

const buildAnalysis = (horse) => {
  const displayName = horse.name ?? horse.currentRace?.horseName ?? horse.odds?.horseName ?? "対象馬";
  const displayNumber = horse.number ?? horse.currentRace?.horseNumber;
  const ability = scoreZi(horse);
  const form = scoreRecentForm(horse);
  const distance = scoreDistance(horse);
  const course = scoreCourse(horse);
  const lap = scoreLap(horse);
  const pace = scorePace(horse);
  const trainingAnalysis = buildTrainingAnalysis(horse);
  const training = trainingAnalysis.score;
  const trainingLap = trainingAnalysis.lapScore;
  const blood = scoreBlood(horse);
  const value = scoreValue(horse, ability);
  const stable = clamp(58 + (horse.trainer ? 6 : 0) + (horse.dataStatus?.training === "active" ? 6 : 0));
  const frame = frameScore(displayNumber);

  const factors = {
    ability,
    distance,
    lap,
    training,
    trainingLap,
    stable,
    frame,
    course,
    pace,
  };

  const tmIndex = clamp(
    ability * 0.28 +
      form * 0.18 +
      distance * 0.13 +
      course * 0.1 +
      training * 0.12 +
      blood * 0.09 +
      value * 0.07 +
      pace * 0.03 +
      8,
    45,
    92
  );

  const confidence = confidenceFor(horse, factors);
  const trainingStatus =
    trainingAnalysis.count
      ? trainingAnalysis.summary
      : "調教データは一部取得";
  const recent = horse.pastRuns?.[0];
  const recentText = recent ? `直近は${recent.course}${recent.raceName}で${recent.finishPosition}着` : "近走データは不足";
  const valueText = horse.odds?.popularity
    ? `単勝${horse.odds.winOdds}倍・${horse.odds.popularity}人気を妙味評価へ反映`
    : "オッズ未取得";
  const pedigreeAnalysis = buildPedigreeAnalysis(horse, blood);
  const bloodSummary = pedigreeAnalysis.headline ?? "4代血統を確認";
  const abilityText = horse.odds?.zi
    ? `TARGET基礎指数${horse.odds.zi}から能力の土台を確認`
    : "TARGET基礎指数は未取得";
  const trainingReadable =
    trainingAnalysis.count
      ? trainingAnalysis.summary
      : "最終追切データは一部未取得のため、調教面は参考評価";

  return {
    tmIndex,
    tmValue: value,
    comment: `${recentText}。${bloodSummary}。`,
    analysis: {
      status: "tm-index-v0",
      confidence,
      confidenceReasons: [
        `過去走${horse.pastRuns?.length ?? 0}件を参照`,
        trainingStatus,
        horse.pedigree ? "4代血統を接続済み" : "血統データ未取得",
        RACE_DAY_CONDITION.summary,
        valueText,
      ],
      tags: [
        abilityText,
        `単勝人気 ${horse.odds?.popularity ?? "未取得"}`,
        `${RACE_DAY_CONDITION.weather}・${RACE_DAY_CONDITION.going}補正`,
        horse.dataStatus?.training === "active" ? "調教データ取得済み" : "調教データ一部取得",
      ],
      factors,
      factorsDetail: {
        blood: { key: "blood", label: "血統", score: blood, maxScore: 100, status: horse.pedigree ? "active" : "missing", summary: bloodSummary },
        training: { key: "training", label: "調教", score: training, maxScore: 100, status: trainingAnalysis.count ? "active" : "partial", summary: trainingReadable },
        course: { key: "course", label: "コース", score: course, maxScore: 100, status: "active", summary: `${horse.currentRace?.course}${horse.currentRace?.surface}${horse.currentRace?.distance}m / ${RACE_DAY_CONDITION.weather}・${RACE_DAY_CONDITION.going}を評価` },
        pace: { key: "pace", label: "展開", score: pace, maxScore: 100, status: "active", summary: "近走の通過順から脚質バランスを評価" },
        stable: { key: "stable", label: "厩舎", score: stable, maxScore: 100, status: "active", summary: "厩舎情報と調教取得状態を補助評価" },
        form: { key: "form", label: "近走", score: form, maxScore: 100, status: horse.pastRuns?.length ? "active" : "missing", summary: "近走着順と着差を中心に評価" },
        value: { key: "value", label: "妙味", score: value, maxScore: 100, status: horse.odds?.status === "active" ? "active" : "missing", summary: "人気・単勝オッズと基礎能力の差を評価" },
      },
      insight: [
        `${displayName}は総合指数${tmIndex}。${recentText}。`,
        `血統面は${bloodSummary}。人気だけに寄せず、近走内容と適性を分けて評価しています。`,
        `当日条件は${RACE_DAY_CONDITION.weather}・${RACE_DAY_CONDITION.going}。馬力、持続力、底力を補正して評価しています。`,
        horse.dataStatus?.training === "active"
          ? trainingAnalysis.summary
          : "調教データは一部取得のため、調教評価は控えめに扱っています。",
      ],
      pros: [
        abilityText,
        `過去走${horse.pastRuns?.length ?? 0}件から近走傾向を確認`,
        horse.pedigree ? `血統面は${bloodSummary}` : "血統データは未取得",
      ],
      cons: [
        horse.dataStatus?.training === "missing" ? "最終追切データが未取得のため調教面は参考評価" : "調教評価は取得できた範囲での初期評価",
        `${RACE_DAY_CONDITION.weather}・${RACE_DAY_CONDITION.going}のため、軽い瞬発力だけの評価は控えめ`,
      ],
      commentary: `${displayName}は、近走内容・コース距離・血統の強み・調教取得状態・オッズ妙味を統合し、総合指数${tmIndex}と評価しました。現段階ではTARGET実データに基づく初期分析です。`,
      frameEval: {
        score: frame,
        text: `馬番${displayNumber ?? "未取得"}を補助評価に使用。枠順の高度な有利不利判定は次フェーズで拡張します。`,
      },
      trainingEval: {
        grade: trainingAnalysis.grade,
        oneWeek: {
          score: training,
          text: trainingReadable,
        },
        final: {
          status: trainingAnalysis.count ? "確認済み" : "一部取得",
          text: trainingAnalysis.finalText,
        },
        stablePattern: {
          match: trainingAnalysis.score >= 74,
          text: trainingAnalysis.patternText,
        },
        details: {
          count: trainingAnalysis.count,
          best: trainingAnalysis.best ? {
            type: trainingAnalysis.best.type,
            date: trainingAnalysis.best.date,
            course: trainingAnalysis.best.course ?? null,
            f4: trainingAnalysis.best.f4 ?? null,
            f1: trainingAnalysis.best.f1 ?? null,
            score: trainingAnalysis.best.score,
          } : null,
          final: trainingAnalysis.final ? {
            type: trainingAnalysis.final.type,
            date: trainingAnalysis.final.date,
            course: trainingAnalysis.final.course ?? null,
            f4: trainingAnalysis.final.f4 ?? null,
            f1: trainingAnalysis.final.f1 ?? null,
            score: trainingAnalysis.final.score,
          } : null,
          lightAfterFinal: trainingAnalysis.lightAfterFinal ? {
            type: trainingAnalysis.lightAfterFinal.type,
            date: trainingAnalysis.lightAfterFinal.date,
            course: trainingAnalysis.lightAfterFinal.course ?? null,
            f4: trainingAnalysis.lightAfterFinal.f4 ?? null,
            f1: trainingAnalysis.lightAfterFinal.f1 ?? null,
            score: trainingAnalysis.lightAfterFinal.score,
          } : null,
          fastFinish: trainingAnalysis.fastFinish ?? 0,
          accelCount: trainingAnalysis.accelCount ?? 0,
          strengths: trainingAnalysis.strengths ?? [],
        },
      },
      pedigree: pedigreeAnalysis,
      verdict: {
        status: "active",
        label: tmIndex >= 82 ? "最上位評価" : tmIndex >= 74 ? "高評価" : "注視",
        summary: `${recentText}。${bloodSummary}。${valueText}。`,
        evidence: [
          `総合指数 ${tmIndex}`,
          `近走 ${form} / 調教 ${training} / 血統 ${blood} / 妙味 ${value}`,
          RACE_DAY_CONDITION.summary,
          trainingReadable,
        ],
      },
      topSignal: {
        status: "active",
        label: tmIndex >= 82 ? "最上位評価" : "注目評価",
        summary: `${displayName} / 総合指数 ${tmIndex}`,
      },
    },
  };
};

export { FACTOR_KEYS, RACE_DAY_CONDITION, buildAnalysis, normalizeHorseKey, findInvalidNumbers, duplicates };
