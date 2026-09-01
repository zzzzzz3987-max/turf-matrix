import { calculateAbilityProfile } from "./ability-ai.mjs";
import { isLocalRun, splitRunsByOrigin } from "./race-origin.mjs";

const NEUTRAL_SCORE = 60;
const MIN_SCORE = 35;
const MAX_SCORE = 96;
const MAX_ADJUSTMENT = 3;

const clamp = (value, min = MIN_SCORE, max = MAX_SCORE) => Math.max(min, Math.min(max, value));
const finite = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
const weightedAverage = (items, fallback = NEUTRAL_SCORE) => {
  const valid = items.filter((item) => finite(item.value) && finite(item.weight) && Number(item.weight) > 0);
  if (!valid.length) return fallback;
  const weight = valid.reduce((sum, item) => sum + Number(item.weight), 0);
  return valid.reduce((sum, item) => sum + Number(item.value) * Number(item.weight), 0) / weight;
};

const classTier = (run) => {
  if (isLocalRun(run)) return -1;
  const text = `${run.grade ?? ""} ${run.raceName ?? ""} ${run.className ?? ""}`;
  if (/G1|GI(?!I)|GⅠ/i.test(text)) return 4;
  if (/G2|GII(?!I)|GⅡ/i.test(text)) return 3;
  if (/G3|GIII|GⅢ/i.test(text)) return 2;
  if (/\(L\)|Listed|リステッド|\bL\b|OP|オープン/i.test(text)) return 1;
  return 0;
};

const finishQuality = (run) => {
  const fieldSize = Number(run.fieldSize) || 16;
  const finish = Number(run.finishPosition);
  if (!Number.isFinite(finish) || finish <= 0) return null;
  return clamp(100 * (fieldSize - Math.min(finish, fieldSize) + 1) / fieldSize);
};

const marginQuality = (run) => {
  const margin = Number(run.margin);
  return Number.isFinite(margin) ? clamp(78 - margin * 20, 38, 94) : null;
};

const classQuality = (run) => {
  const tier = classTier(run);
  return tier < 0 ? 38 : [56, 66, 76, 84, 90][tier];
};

const runCeilingQuality = (run) => {
  const finish = finishQuality(run);
  if (!Number.isFinite(finish)) return null;
  const score = weightedAverage([
    { value: finish, weight: 0.45 },
    { value: marginQuality(run), weight: finite(run.margin) ? 0.35 : 0 },
    { value: classQuality(run), weight: 0.2 },
  ]);
  return clamp(isLocalRun(run) ? NEUTRAL_SCORE + (score - NEUTRAL_SCORE) * 0.35 : score);
};

const median = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

const demonstratedAbility = (runs) => {
  const scores = runs.slice(0, 8).map(runCeilingQuality).filter(Number.isFinite);
  if (!scores.length) return null;
  const best = [...scores].sort((left, right) => right - left).slice(0, 2);
  const ceiling = best.length === 1
    ? best[0] * 0.7 + NEUTRAL_SCORE * 0.3
    : best[0] * 0.6 + best[1] * 0.4;
  const consistency = median(scores.slice(0, 5));
  return {
    score: clamp(ceiling * 0.7 + consistency * 0.3),
    ceiling: clamp(ceiling),
    consistency: clamp(consistency),
    runScores: scores,
  };
};

const buildAbilityCeilingShadow = (horse, currentAbility = null) => {
  const profile = calculateAbilityProfile(horse);
  const runs = (horse.pastRuns ?? []).filter((run) => finite(run.finishPosition));
  const { central, local } = splitRunsByOrigin(runs);
  const comparable = central.length ? central : local;
  const demonstrated = demonstratedAbility(comparable);
  const relationAvailable = [
    profile.opponentScore,
    profile.peerScore,
    profile.encounterScore,
    profile.careerOpponentScore,
  ].some(Number.isFinite);
  const relationScore = relationAvailable ? profile.relationScore : null;
  const ziScore = Number.isFinite(profile.ziScore) ? profile.ziScore : null;
  const rawCandidate = demonstrated
    ? weightedAverage([
        { value: ziScore, weight: ziScore == null ? 0 : relationAvailable ? 0.45 : 0.55 },
        { value: demonstrated.score, weight: ziScore == null ? relationAvailable ? 0.8 : 1 : relationAvailable ? 0.4 : 0.45 },
        { value: relationScore, weight: relationScore == null ? 0 : ziScore == null ? 0.2 : 0.15 },
      ])
    : ziScore ?? relationScore ?? NEUTRAL_SCORE;
  const centralCount = central.length;
  const evidenceFactor = centralCount >= 3 ? 1 : centralCount === 2 ? 0.8 : centralCount === 1 ? 0.6 : 0.35;
  const candidate = clamp(NEUTRAL_SCORE + (rawCandidate - NEUTRAL_SCORE) * evidenceFactor);
  const current = Number.isFinite(Number(currentAbility)) ? Number(currentAbility) : profile.score;
  const adjustment = clamp(Math.round(candidate - current), -MAX_ADJUSTMENT, MAX_ADJUSTMENT);
  const shadowScore = clamp(current + adjustment);

  return {
    status: demonstrated || ziScore != null || relationScore != null ? "active" : "insufficient_data",
    currentScore: current,
    shadowScore,
    adjustment,
    candidateScore: Math.round(candidate * 10) / 10,
    demonstratedScore: demonstrated ? Math.round(demonstrated.score * 10) / 10 : null,
    ceilingScore: demonstrated ? Math.round(demonstrated.ceiling * 10) / 10 : null,
    consistencyScore: demonstrated ? Math.round(demonstrated.consistency * 10) / 10 : null,
    ziScore,
    relationScore,
    relationAvailable,
    runCount: runs.length,
    centralRunCount: centralCount,
    localRunCount: local.length,
    evidenceFactor,
    maxAdjustment: MAX_ADJUSTMENT,
    policy: {
      popularityUsed: false,
      oddsUsed: false,
      currentRaceResultUsed: false,
      targetDistanceUsed: false,
      rawLast3FUsed: false,
    },
  };
};

export {
  MAX_ADJUSTMENT,
  buildAbilityCeilingShadow,
  classQuality,
  demonstratedAbility,
  finishQuality,
  marginQuality,
  runCeilingQuality,
};
