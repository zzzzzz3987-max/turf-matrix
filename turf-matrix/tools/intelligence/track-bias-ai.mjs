import { classifyRunningStyle } from "./pace-ai.mjs";

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const normalizeSurface = (value) => String(value ?? "").startsWith("ダ") ? "ダート" : String(value ?? "");

const dateValue = (value) => {
  const timestamp = Date.parse(`${String(value ?? "").slice(0, 10)}T00:00:00+09:00`);
  return Number.isFinite(timestamp) ? timestamp : null;
};

const isChronologicallyValid = (snapshot, race) => {
  const targetDate = String(race?.raceDate ?? race?.date ?? "").slice(0, 10);
  if (!targetDate || snapshot?.targetDate !== targetDate) return false;
  const source = dateValue(snapshot?.sourceDate);
  const target = dateValue(targetDate);
  return source != null && target != null && source < target;
};

const resolveTrackBias = (snapshot, race = {}) => {
  if (!snapshot || !isChronologicallyValid(snapshot, race)) return null;
  const track = race.course ?? race.track;
  const surface = normalizeSurface(race.surface);
  const profile = (snapshot.profiles ?? []).find((item) => (
    item.track === track && normalizeSurface(item.surface) === surface
  ));
  if (!profile) return null;
  return {
    ...profile,
    sourceDate: snapshot.sourceDate,
    targetDate: snapshot.targetDate,
    method: snapshot.method,
    source: snapshot.source,
  };
};

const trackBiasAdjustment = (horse, context = {}) => {
  const bias = context.trackBias;
  if (!bias || bias.status !== "active" || bias.style !== "front") return 0;
  const style = classifyRunningStyle(horse);
  if (style === "追込") return -1;
  if (bias.strength === "strong" && (style === "逃げ" || style === "先行")) return 1;
  return 0;
};

const buildTrackBiasAnalysis = (horse, context = {}) => {
  const bias = context.trackBias;
  if (!bias) {
    return {
      key: "trackBias",
      label: "馬場傾向",
      score: 65,
      maxScore: 100,
      status: "missing",
      adjustment: 0,
      summary: "前日または当日の確定結果によるトラックバイアスは未取得です。",
      evidence: [],
    };
  }

  const style = classifyRunningStyle(horse);
  const adjustment = trackBiasAdjustment(horse, context);
  const sample = bias.sample ?? {};
  const raceCount = Number(sample.raceCount) || 0;
  const rearTop3Count = Number(sample.rearTop3Count) || 0;
  const rearRunnerCount = Number(sample.rearRunnerCount) || 0;
  const sourceDate = bias.sourceDate ?? "前日";
  const active = bias.status === "active";
  const strengthText = bias.strength === "strong" ? "強い前有利" : "前・中団有利";
  const adjustmentText = adjustment === 0 ? "指数補正なし" : `TM INDEX ${adjustment > 0 ? "+" : ""}${adjustment}点`;
  const summary = active
    ? `${sourceDate}の同会場・同馬場${raceCount}Rから${strengthText}を確認。${style}脚質は${adjustmentText}。`
    : `${sourceDate}の同会場・同馬場${raceCount}Rを監視。人気補正後の根拠が弱いため指数補正は行いません。`;

  return {
    key: "trackBias",
    label: "馬場傾向",
    score: clamp(65 + adjustment * 10, 55, 75),
    maxScore: 100,
    status: active ? "active" : "monitor",
    confidence: bias.confidence ?? "low",
    adjustment,
    style,
    biasStyle: bias.style,
    strength: bias.strength,
    sourceDate,
    sample,
    summary,
    evidence: [
      `${sourceDate} ${bias.track}${bias.surface} ${raceCount}R・${sample.runnerCount ?? 0}頭`,
      `4角後方組の馬券内 ${rearTop3Count}/${rearRunnerCount}`,
      `前方組の勝利 ${sample.frontWins ?? 0}/${raceCount}R`,
      `今回脚質 ${style} / ${adjustmentText}`,
      ...(bias.note ? [bias.note] : []),
    ],
  };
};

export {
  buildTrackBiasAnalysis,
  normalizeSurface,
  resolveTrackBias,
  trackBiasAdjustment,
};
