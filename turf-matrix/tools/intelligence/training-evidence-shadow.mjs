import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const EMPIRICAL_BASELINES = require("../../data/master/training-baselines.json");
const NEUTRAL_SCORE = 60;
const MAX_ADJUSTMENT = 3;

const finite = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
const number = (value, fallback = null) => finite(value) ? Number(value) : fallback;
const clamp = (value, min = 35, max = 96) => Math.max(min, Math.min(max, Math.round(value)));
const boundedAdjustment = (value) => Math.max(-MAX_ADJUSTMENT, Math.min(MAX_ADJUSTMENT, Math.round(value)));

const weightedAverage = (items, fallback = NEUTRAL_SCORE) => {
  const valid = items.filter((item) => finite(item.value) && item.weight > 0);
  const totalWeight = valid.reduce((sum, item) => sum + item.weight, 0);
  return totalWeight
    ? valid.reduce((sum, item) => sum + Number(item.value) * item.weight, 0) / totalWeight
    : fallback;
};

const evidenceAdjustment = (profile) => {
  if (!finite(profile?.score) || !finite(profile?.baseScore)) return 0;
  return Number(profile.score) - Number(profile.baseScore);
};

const qualityOnlyBase = (profile) => weightedAverage([
  { value: profile?.components?.phaseQuality, weight: 0.72 },
  { value: profile?.components?.recentBest, weight: 0.16 },
  { value: profile?.components?.consistency, weight: 0.12 },
]);

const oneWeekPrimaryBase = (profile) => {
  const finalScore = number(profile?.phaseRepresentatives?.final?.score);
  const oneWeekScore = number(profile?.phaseRepresentatives?.oneWeek?.score);
  const consistency = number(profile?.components?.consistency, NEUTRAL_SCORE);
  const fallbackPhase = number(profile?.components?.phaseQuality, NEUTRAL_SCORE);

  if (finalScore != null && oneWeekScore != null) {
    return weightedAverage([
      { value: oneWeekScore, weight: 0.55 },
      { value: finalScore, weight: 0.30 },
      { value: consistency, weight: 0.15 },
    ]);
  }

  const availablePhase = oneWeekScore ?? finalScore ?? fallbackPhase;
  return weightedAverage([
    { value: availablePhase, weight: 0.80 },
    { value: consistency, weight: 0.20 },
  ]);
};

const percentileFor = (value, points) => {
  if (!finite(value) || !Array.isArray(points) || !points.length) return null;
  const numeric = Number(value);
  if (numeric <= points[0].value) return 0;
  if (numeric >= points.at(-1).value) return 1;
  for (let index = 1; index < points.length; index += 1) {
    const lower = points[index - 1];
    const upper = points[index];
    if (numeric > upper.value) continue;
    const fraction = upper.value === lower.value ? 0 : (numeric - lower.value) / (upper.value - lower.value);
    return lower.probability + (upper.probability - lower.probability) * fraction;
  }
  return 1;
};

const baselineFor = (session, stableSide) => {
  const id = session.type === "slope"
    ? `slope-${String(stableSide ?? "").includes("栗") ? "ritto" : "miho"}`
    : `wood-${session.course ?? "default"}`;
  const exact = EMPIRICAL_BASELINES.groups?.[id];
  if (exact?.sampleSize >= EMPIRICAL_BASELINES.policy.minimumSampleSize) return { ...exact, id };
  const fallback = session.type === "wood" ? EMPIRICAL_BASELINES.groups?.["wood-default"] : null;
  return fallback ? { ...fallback, id: "wood-default" } : null;
};

const lapValues = (lap) => [lap?.lap4, lap?.lap3, lap?.lap2, lap?.lap1].filter(finite).map(Number);
const empiricalSessionScore = (session, stableSide) => {
  const baseline = baselineFor(session, stableSide);
  if (!baseline) return null;
  const f4Percentile = percentileFor(session.f4, baseline.f4);
  const f1Percentile = percentileFor(session.f1, baseline.f1);
  if (f4Percentile == null || f1Percentile == null) return null;
  const values = lapValues(session.lap);
  const accelerationScore = values.length < 2 ? 60 : values.at(-1) <= values.at(-2) ? 78 : 50;
  const f4Score = 95 - f4Percentile * 50;
  const f1Score = 95 - f1Percentile * 50;
  return {
    score: clamp(f4Score * 0.45 + f1Score * 0.45 + accelerationScore * 0.10, 45, 94),
    baselineId: baseline.id,
    baselineSampleSize: baseline.sampleSize,
    f4Percentile: Number(f4Percentile.toFixed(3)),
    f1Percentile: Number(f1Percentile.toFixed(3)),
  };
};

const empiricalQualityBase = (profile, stableSide) => {
  const sessions = (profile?.sessions ?? []).map((session) => {
    const empirical = empiricalSessionScore(session, stableSide);
    return empirical ? { ...session, empirical } : null;
  }).filter(Boolean);
  if (!sessions.length) return null;
  const best = (values) => [...values].sort((left, right) => right.empirical.score - left.empirical.score || right.dateValue - left.dateValue)[0] ?? null;
  const phaseWeights = { final: 0.48, oneWeek: 0.32, intermediate: 0.15, stale: 0.05, unknown: 0.05 };
  const phases = [...new Set(sessions.map((session) => session.phase))];
  const representatives = phases.map((phase) => ({ phase, session: best(sessions.filter((item) => item.phase === phase)) }));
  const phaseQuality = weightedAverage(representatives.map(({ phase, session }) => ({ value: session.empirical.score, weight: phaseWeights[phase] ?? 0.05 })));
  const recent14 = sessions.filter((session) => finite(session.daysBeforeRace) && session.daysBeforeRace <= 14);
  const recent28 = sessions.filter((session) => finite(session.daysBeforeRace) && session.daysBeforeRace <= 28);
  const consistencySource = recent14.length ? recent14 : recent28.length ? recent28 : sessions.slice(0, 3);
  const recentBest = best(recent14.length ? recent14 : recent28.length ? recent28 : sessions)?.empirical.score ?? NEUTRAL_SCORE;
  const consistency = weightedAverage(consistencySource.map((session, index) => ({ value: session.empirical.score, weight: Math.max(0.35, 1 - index * 0.12) })));
  return {
    base: weightedAverage([
      { value: phaseQuality, weight: 0.72 },
      { value: recentBest, weight: 0.16 },
      { value: consistency, weight: 0.12 },
    ]),
    sessionCount: sessions.length,
    baselineIds: [...new Set(sessions.map((session) => session.empirical.baselineId))].sort(),
  };
};

const buildTrainingEvidenceShadow = (profile, currentScore, variant = "oneWeekPrimary", context = {}) => {
  const current = number(currentScore, NEUTRAL_SCORE);
  if (!profile?.sessions?.length) {
    return {
      variant,
      currentScore: current,
      shadowScore: current,
      adjustment: 0,
      candidateBase: NEUTRAL_SCORE,
      evidenceAdjustment: evidenceAdjustment(profile),
      status: "missing",
    };
  }

  const empirical = variant === "empiricalQuality" ? empiricalQualityBase(profile, context.stableSide) : null;
  const candidateBase = variant === "qualityOnly"
    ? qualityOnlyBase(profile)
    : variant === "empiricalQuality"
      ? empirical?.base ?? qualityOnlyBase(profile)
      : oneWeekPrimaryBase(profile);
  const rebuiltCandidate = clamp(candidateBase + evidenceAdjustment(profile));
  const rebuiltCurrent = number(profile.score, current);
  const adjustment = boundedAdjustment(rebuiltCandidate - rebuiltCurrent);

  return {
    variant,
    currentScore: current,
    shadowScore: clamp(current + adjustment),
    adjustment,
    candidateBase: Number(candidateBase.toFixed(2)),
    evidenceAdjustment: Number(evidenceAdjustment(profile).toFixed(2)),
    status: profile.status ?? "active",
    hasFinal: Boolean(profile.phaseRepresentatives?.final),
    hasOneWeek: Boolean(profile.phaseRepresentatives?.oneWeek),
    sessionCount: profile.sessions.length,
    ...(empirical ? { empiricalSessionCount: empirical.sessionCount, baselineIds: empirical.baselineIds } : {}),
  };
};

export {
  MAX_ADJUSTMENT,
  buildTrainingEvidenceShadow,
  empiricalQualityBase,
  empiricalSessionScore,
  oneWeekPrimaryBase,
  qualityOnlyBase,
};
