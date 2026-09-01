import { isLocalRun } from "./race-origin.mjs";

const NEUTRAL_SCORE = 60;
const MIN_SCORE = 35;
const MAX_SCORE = 96;
const MAX_ADJUSTMENT = 3;
const CANDIDATE_BLEND = 0.35;

const finite = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
const clamp = (value, min = MIN_SCORE, max = MAX_SCORE) => Math.max(min, Math.min(max, value));
const rounded = (value) => Math.round(value * 10) / 10;

const weightedAverage = (items, fallback = null) => {
  const valid = items.filter((item) => finite(item.value) && finite(item.weight) && Number(item.weight) > 0);
  if (!valid.length) return fallback;
  const totalWeight = valid.reduce((sum, item) => sum + Number(item.weight), 0);
  return valid.reduce((sum, item) => sum + Number(item.value) * Number(item.weight), 0) / totalWeight;
};

const median = (values) => {
  const valid = values.filter(finite).map(Number).sort((left, right) => left - right);
  if (!valid.length) return null;
  const middle = Math.floor(valid.length / 2);
  return valid.length % 2 ? valid[middle] : (valid[middle - 1] + valid[middle]) / 2;
};

const dateValue = (value) => {
  const normalized = String(value ?? "").trim().replace(/[./]/g, "-");
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const isPreRaceRun = (run, raceDate) => {
  const runDate = dateValue(run?.date);
  const targetDate = dateValue(raceDate);
  if (runDate == null || targetDate == null) return false;
  return runDate < targetDate;
};

const finishQuality = (run) => {
  const fieldSize = Number(run?.fieldSize) || 16;
  const finish = Number(run?.finishPosition);
  if (!Number.isFinite(finish) || finish <= 0) return null;
  return clamp(100 * (fieldSize - Math.min(finish, fieldSize) + 1) / fieldSize);
};

const marginQuality = (run) => {
  const margin = Number(run?.margin);
  return Number.isFinite(margin) ? clamp(78 - margin * 18, 35, 94) : null;
};

const runFormQuality = (run) => {
  const finish = finishQuality(run);
  if (finish == null) return null;
  const raw = weightedAverage([
    { value: finish, weight: 0.58 },
    { value: marginQuality(run), weight: finite(run?.margin) ? 0.42 : 0 },
  ], finish);
  return clamp(isLocalRun(run) ? NEUTRAL_SCORE + (raw - NEUTRAL_SCORE) * 0.4 : raw);
};

const passingProgress = (run) => {
  const positions = Array.isArray(run?.passingOrder) ? run.passingOrder.map(Number).filter(Number.isFinite) : [];
  const finish = Number(run?.finishPosition);
  const fieldSize = Number(run?.fieldSize) || 16;
  if (!positions.length || !Number.isFinite(finish) || finish <= 0) return null;
  return clamp((positions[0] - finish) / Math.max(1, fieldSize - 1) * 100, -100, 100);
};

const comparableRuns = (horse) => {
  const raceDate = horse?.currentRace?.raceDate;
  return (horse?.pastRuns ?? [])
    .filter((run) => isPreRaceRun(run, raceDate) && runFormQuality(run) != null)
    .map((run, index) => ({ run, index, dateValue: dateValue(run.date), quality: runFormQuality(run) }))
    .sort((left, right) => {
      if (left.dateValue != null && right.dateValue != null && left.dateValue !== right.dateValue) return right.dateValue - left.dateValue;
      return left.index - right.index;
    })
    .slice(0, 8);
};

const buildFormStateProfile = (horse) => {
  const runs = comparableRuns(horse);
  if (!runs.length) {
    return {
      status: "missing",
      candidateScore: NEUTRAL_SCORE,
      recentQuality: null,
      baselineQuality: null,
      momentumScore: null,
      latestDelta: null,
      trendDelta: null,
      passingProgress: null,
      runCount: 0,
      baselineRunCount: 0,
      evidenceFactor: 0,
      confidence: "Low",
    };
  }

  const recent = runs.slice(0, 3);
  const older = runs.slice(3, 8);
  const recentQuality = weightedAverage(recent.map((item, index) => ({
    value: item.quality,
    weight: [1, 0.72, 0.5][index],
  })));
  const baselineQuality = median(older.map((item) => item.quality)) ?? median(runs.map((item) => item.quality));
  const previousQuality = weightedAverage(runs.slice(1, 4).map((item, index) => ({
    value: item.quality,
    weight: [1, 0.7, 0.45][index],
  })), baselineQuality);
  const latestDelta = runs[0].quality - previousQuality;
  const trendDelta = recentQuality - baselineQuality;
  const momentumScore = clamp(NEUTRAL_SCORE + trendDelta * 0.65 + latestDelta * 0.35);
  // Relative momentum is retained as monitoring evidence. It is not a
  // performance point because an improving low-level run and a declining
  // high-level run are not directly comparable across horses.
  const rawCandidate = recentQuality;
  const evidenceFactor = runs.length >= 3 ? 1 : runs.length === 2 ? 0.72 : 0.45;
  const candidateScore = clamp(NEUTRAL_SCORE + (rawCandidate - NEUTRAL_SCORE) * evidenceFactor);
  const progressValues = recent.map((item) => passingProgress(item.run)).filter(finite);

  return {
    status: runs.length >= 3 ? "active" : "limited",
    candidateScore: rounded(candidateScore),
    recentQuality: rounded(recentQuality),
    baselineQuality: rounded(baselineQuality),
    momentumScore: rounded(momentumScore),
    latestDelta: rounded(latestDelta),
    trendDelta: rounded(trendDelta),
    passingProgress: progressValues.length ? rounded(weightedAverage(progressValues.map((value, index) => ({ value, weight: [1, 0.7, 0.45][index] })))) : null,
    runCount: runs.length,
    baselineRunCount: older.length,
    evidenceFactor,
    confidence: runs.length >= 6 ? "A" : runs.length >= 4 ? "B" : runs.length >= 3 ? "C" : "Low",
    runs: runs.map((item) => ({
      date: item.run.date ?? null,
      raceName: item.run.raceName ?? null,
      finishPosition: item.run.finishPosition ?? null,
      fieldSize: item.run.fieldSize ?? null,
      margin: finite(item.run.margin) ? Number(item.run.margin) : null,
      quality: rounded(item.quality),
      passingProgress: passingProgress(item.run) == null ? null : rounded(passingProgress(item.run)),
    })),
  };
};

const buildFormStateShadow = (horse, currentForm = null) => {
  const profile = buildFormStateProfile(horse);
  const current = finite(currentForm) ? Number(currentForm) : NEUTRAL_SCORE;
  if (profile.status === "missing") {
    return {
      ...profile,
      currentScore: current,
      shadowScore: current,
      adjustment: 0,
      maxAdjustment: MAX_ADJUSTMENT,
      policy: {
        currentRaceResultUsed: false,
        popularityOddsValueUsed: false,
        candidateTargetDistanceSurfaceCourseUsed: false,
        rawLast3FUsed: false,
        candidateAbilityZiOpponentEvidenceUsed: false,
        carriedWeightUsed: false,
      },
    };
  }
  // The current Form score remains the prior. The independent state estimate is
  // deliberately shrunk because recent finish/margin evidence partially overlaps
  // Ability and is noisy for lightly raced horses.
  const adjustment = clamp(Math.round((profile.candidateScore - current) * CANDIDATE_BLEND), -MAX_ADJUSTMENT, MAX_ADJUSTMENT);
  return {
    ...profile,
    currentScore: current,
    shadowScore: Math.round(clamp(current + adjustment)),
    adjustment,
    maxAdjustment: MAX_ADJUSTMENT,
    policy: {
      currentRaceResultUsed: false,
      popularityOddsValueUsed: false,
      candidateTargetDistanceSurfaceCourseUsed: false,
      rawLast3FUsed: false,
      candidateAbilityZiOpponentEvidenceUsed: false,
      carriedWeightUsed: false,
    },
  };
};

export {
  CANDIDATE_BLEND,
  MAX_ADJUSTMENT,
  buildFormStateProfile,
  buildFormStateShadow,
  finishQuality,
  isPreRaceRun,
  marginQuality,
  passingProgress,
  runFormQuality,
};
