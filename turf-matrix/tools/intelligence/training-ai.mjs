import { createRequire } from "node:module";
import { trainingThreshold } from "./dictionaries/training-thresholds.mjs";

const require = createRequire(import.meta.url);
const STABLE_PATTERNS = require("../../data/master/stables.json");
const clamp = (value, min = 35, max = 96) => Math.max(min, Math.min(max, Math.round(value)));
const normalizeKey = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, "").trim();

const toDate = (dateText) => {
  const text = String(dateText ?? "").trim();
  const compact = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  const separated = text.match(/^(\d{4})[./-]\s*(\d{1,2})[./-]\s*(\d{1,2})$/);
  const match = compact ?? separated;
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? null : date;
};

const daysBeforeRace = (sessionDate, raceDate) => {
  const session = toDate(sessionDate);
  const race = toDate(raceDate);
  if (!session || !race) return null;
  return Math.round((race.getTime() - session.getTime()) / 86400000);
};

const phaseForDays = (days) => {
  if (!Number.isFinite(days) || days < 0) return "unknown";
  if (days <= 4) return "final";
  if (days <= 12) return "oneWeek";
  if (days <= 28) return "intermediate";
  return "stale";
};

const PHASE_LABELS = {
  final: "最終追い切り",
  oneWeek: "一週前追い切り",
  intermediate: "中間調整",
  stale: "過去調教",
  unknown: "日付未確認",
};

const PHASE_WEIGHTS = {
  final: 0.48,
  oneWeek: 0.32,
  intermediate: 0.15,
  stale: 0.05,
  unknown: 0.05,
};

const lapValues = (lap) =>
  [lap?.lap4, lap?.lap3, lap?.lap2, lap?.lap1].filter((value) => typeof value === "number" && Number.isFinite(value));

const formatSession = (session) => {
  if (!session) return "時計未取得";
  const type = session.type === "wood" ? "ウッド" : "坂路";
  const course = session.course ? `${session.course}` : type;
  return `${session.date ?? "日付未取得"} ${course} 4F${session.f4 ?? "-"}-1F${session.f1 ?? "-"}`;
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

const bestSession = (sessions) => [...sessions].sort((a, b) => b.score - a.score || b.dateValue - a.dateValue)[0] ?? null;

const weightedAverage = (items) => {
  const valid = items.filter((item) => Number.isFinite(item.value) && item.weight > 0);
  const weight = valid.reduce((sum, item) => sum + item.weight, 0);
  return weight ? valid.reduce((sum, item) => sum + item.value * item.weight, 0) / weight : 50;
};

const matchStablePattern = (horse, sessions, phaseRepresentatives) => {
  const trainer = horse.currentRace?.trainer ?? horse.trainer;
  const stable = STABLE_PATTERNS.stables?.find((item) => normalizeKey(item.name) === normalizeKey(trainer));
  if (!stable) {
    return {
      status: "DB未登録",
      match: false,
      degree: 0,
      adjustment: 0,
      sampleSize: 0,
      hitRate: null,
      text: trainer ? `${trainer}厩舎の勝負調教パターンは学習待ちです。` : "調教師情報は未取得です。",
    };
  }

  const pattern = stable.winningPattern ?? {};
  const representative = phaseRepresentatives[pattern.phase] ?? phaseRepresentatives.oneWeek ?? phaseRepresentatives.final;
  const criteria = [];
  if (pattern.phase) criteria.push(representative?.phase === pattern.phase);
  if (pattern.course?.length) {
    const course = representative?.type === "wood" ? representative.course ?? "wood" : "slope";
    criteria.push(pattern.course.some((expected) => normalizeKey(course).includes(normalizeKey(expected))));
  }
  if (Number.isFinite(pattern.time4FMax)) criteria.push(Number.isFinite(representative?.f4) && representative.f4 <= pattern.time4FMax);
  if (Number.isFinite(pattern.last1FMax)) criteria.push(Number.isFinite(representative?.f1) && representative.f1 <= pattern.last1FMax);
  if (typeof pattern.accel === "boolean") {
    const laps = lapValues(representative?.lap);
    criteria.push(laps.length >= 2 && (laps.at(-1) <= laps.at(-2)) === pattern.accel);
  }
  if (Number.isFinite(pattern.minCount)) criteria.push(sessions.length >= pattern.minCount);
  const degree = criteria.length ? criteria.filter(Boolean).length / criteria.length : 0;
  const learnedIsEligible = stable.source !== "learned" || stable.sampleSize >= 20;
  const adjustment = learnedIsEligible && degree >= 0.6 ? Math.round(degree * 5) : 0;
  return {
    status: learnedIsEligible ? "照合済" : "サンプル不足",
    match: learnedIsEligible && degree === 1,
    degree: Number(degree.toFixed(2)),
    adjustment,
    sampleSize: stable.sampleSize ?? 0,
    hitRate: stable.hitRate ?? null,
    text: learnedIsEligible
      ? `${stable.signaturePhrase}への合致度${Math.round(degree * 100)}%${stable.sampleSize ? `（複勝率${(stable.hitRate * 100).toFixed(1)}%、n=${stable.sampleSize}）` : ""}`
      : `${stable.signaturePhrase}はサンプル不足のため参考扱いです。`,
  };
};

const buildTrainingProfile = (horse) => {
  const stableSide = horse.currentRace?.stableSide ?? horse.stableSide ?? "";
  const raceDate = horse.currentRace?.raceDate;
  const sessions = collectTrainingSessions(horse)
    .map((session) => {
      const date = toDate(session.date);
      const days = daysBeforeRace(session.date, raceDate);
      return {
        ...session,
        score: sessionScore(session, stableSide),
        dateValue: date?.getTime() ?? 0,
        daysBeforeRace: days,
        phase: phaseForDays(days),
      };
    })
    .sort((a, b) => b.dateValue - a.dateValue);

  if (!sessions.length) {
    return {
      score: 50,
      lapScore: 50,
      confidence: "low",
      status: "missing",
      sessions,
      phaseRepresentatives: {},
      stablePattern: {
        status: "DB未登録",
        match: false,
        degree: 0,
        adjustment: 0,
        sampleSize: 0,
        hitRate: null,
        text: "調教データ未取得のため厩舎パターンを照合できません。",
      },
      components: { phaseQuality: 50, recentBest: 50, consistency: 50, volume: 50, freshness: 50, stablePattern: 50 },
    };
  }

  const grouped = Object.groupBy
    ? Object.groupBy(sessions, (session) => session.phase)
    : sessions.reduce((result, session) => {
        (result[session.phase] ??= []).push(session);
        return result;
      }, {});
  const phaseRepresentatives = Object.fromEntries(
    Object.entries(grouped).map(([phase, values]) => [phase, bestSession(values)])
  );
  const phaseQuality = weightedAverage(
    Object.entries(phaseRepresentatives).map(([phase, session]) => ({
      value: session?.score,
      weight: PHASE_WEIGHTS[phase] ?? 0.05,
    }))
  );
  const recent14 = sessions.filter((session) => Number.isFinite(session.daysBeforeRace) && session.daysBeforeRace <= 14);
  const recent21 = sessions.filter((session) => Number.isFinite(session.daysBeforeRace) && session.daysBeforeRace <= 21);
  const recent28 = sessions.filter((session) => Number.isFinite(session.daysBeforeRace) && session.daysBeforeRace <= 28);
  const consistencySource = recent14.length ? recent14 : recent28.length ? recent28 : sessions.slice(0, 3);
  const recentBest = bestSession(recent14.length ? recent14 : recent28.length ? recent28 : sessions)?.score ?? 50;
  const consistency = weightedAverage(
    consistencySource.map((session, index) => ({ value: session.score, weight: Math.max(0.35, 1 - index * 0.12) }))
  );
  const volume = clamp(48 + Math.min(30, recent21.length * 5), 45, 78);
  const nearestDays = sessions.find((session) => Number.isFinite(session.daysBeforeRace))?.daysBeforeRace;
  const freshness =
    nearestDays == null ? 48 : nearestDays <= 4 ? 84 : nearestDays <= 12 ? 74 : nearestDays <= 21 ? 62 : nearestDays <= 28 ? 54 : 44;
  const baseScore = clamp(
    phaseQuality * 0.62 +
      recentBest * 0.14 +
      consistency * 0.12 +
      volume * 0.06 +
      freshness * 0.06
  );
  const stablePattern = matchStablePattern(horse, sessions, phaseRepresentatives);
  const score = clamp(baseScore + stablePattern.adjustment);
  const accelCount = recent28.filter((session) => {
    const values = lapValues(session.lap);
    return values.length >= 2 && values.at(-1) <= values.at(-2);
  }).length;
  const lapScore = clamp(score + Math.min(5, accelCount * 1.25) - (recent28.length && !accelCount ? 3 : 0));
  const hasFinal = Boolean(phaseRepresentatives.final);
  const hasOneWeek = Boolean(phaseRepresentatives.oneWeek);
  const confidence = hasFinal && hasOneWeek ? "high" : hasFinal || hasOneWeek || recent21.length >= 2 ? "mid" : "low";

  return {
    score,
    baseScore,
    lapScore,
    confidence,
    status: confidence === "low" ? "partial" : "active",
    sessions,
    phaseRepresentatives,
    stablePattern,
    components: {
      phaseQuality: clamp(phaseQuality),
      recentBest: clamp(recentBest),
      consistency: clamp(consistency),
      volume,
      freshness,
      stablePattern: clamp(50 + stablePattern.adjustment * 6, 50, 80),
    },
    recentCounts: { days14: recent14.length, days21: recent21.length, days28: recent28.length },
    accelCount,
  };
};

const buildTrainingAnalysis = (horse) => {
  const profile = buildTrainingProfile(horse);
  const sessions = profile.sessions;

  if (!sessions.length) {
    return {
      ...profile,
      grade: "C",
      count: 0,
      summary: "調教時計は未取得です。調教面は強く評価せず、近走・血統・オッズを中心に見ます。",
      finalText: "最終追い切りの時計が未取得です。別馬の時計で補完せず、調教評価は控えめに扱います。",
      patternText: "調教パターンは未判定です。",
      strengths: ["調教時計未取得"],
    };
  }

  const final = profile.phaseRepresentatives.final ?? null;
  const oneWeek = profile.phaseRepresentatives.oneWeek ?? null;
  const best = bestSession(sessions);
  const fastFinish = sessions.filter((session) => {
    const threshold = trainingThreshold(session.type, horse.currentRace?.stableSide ?? horse.stableSide ?? "");
    return typeof session.f1 === "number" && session.f1 <= threshold["1F"];
  }).length;
  const activeCount = sessions.filter((session) => session.score >= 70).length;
  const grade = profile.score >= 84 ? "A" : profile.score >= 74 ? "B" : profile.score >= 62 ? "C" : "D";
  const phaseEvidence = [
    final ? `最終 ${formatSession(final)} (${final.score})` : "最終追い切りは取得待ち",
    oneWeek ? `一週前 ${formatSession(oneWeek)} (${oneWeek.score})` : "一週前追い切りは取得待ち",
  ];
  const strengths = [
    ...phaseEvidence,
    profile.accelCount ? `加速ラップ ${profile.accelCount}本` : "加速ラップは目立たない",
    `直近21日 ${profile.recentCounts.days21}本`,
    ...(profile.stablePattern.status === "DB未登録" ? [] : [profile.stablePattern.text]),
  ];

  return {
    ...profile,
    grade,
    count: sessions.length,
    best,
    final,
    oneWeek,
    lightAfterFinal: null,
    fastFinish,
    activeCount,
    strengths,
    summary: `${PHASE_LABELS[final ? "final" : oneWeek ? "oneWeek" : best.phase]}を軸に、調教時計・終い・加速・本数を分けて評価。${phaseEvidence.join(" / ")}。`,
    finalText: final
      ? `${formatSession(final)}。最終追い切り評価は${final.score >= 74 ? "良好" : final.score >= 62 ? "標準" : "控えめ"}です。`
      : "最終追い切りは取得待ちです。一週前までの実測値で暫定評価しています。",
    patternText: `${oneWeek ? formatSession(oneWeek) : formatSession(best)}を代表時計として評価。鮮度${profile.components.freshness}、本数${profile.components.volume}です。`,
  };
};

export { buildTrainingAnalysis, buildTrainingProfile };
