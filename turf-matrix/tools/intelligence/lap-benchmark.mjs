import { normalizeCourse, normalizeDate } from "./race-shape-history.mjs";

const MIN_COMPARISON_RACES = 20;
const number = (value) => typeof value === "boolean" || value == null || String(value).trim() === ""
  ? null : Number.isFinite(Number(value)) ? Number(value) : null;
const round = (value) => Math.round(value * 100) / 100;

const comparisonKey = (race) => {
  const course = normalizeCourse(race?.course ?? race?.courseName);
  const distance = number(race?.distance);
  const track = number(race?.trackCode);
  const going = number(track < 23 ? race?.turfConditionCode : race?.dirtConditionCode);
  const pace = race?.pace?.classification;
  if (!course || !Number.isInteger(distance) || distance < 1000 ||
    !Number.isInteger(track) || track < 11 || track > 29 ||
    ![1, 2, 3, 4].includes(going) ||
    !["front_loaded", "even", "back_loaded"].includes(pace)) return null;
  return JSON.stringify([course, distance, track, going, pace]);
};

const closingTime = (race) => race?.lapProfile?.scope === "race" &&
  number(race.lapProfile.last5F) > 0 ? Number(race.lapProfile.last5F) : null;

const buildLapBenchmark = (target, history, evaluationDate) => {
  const cutoff = normalizeDate(evaluationDate);
  const targetDate = normalizeDate(target?.date);
  const key = comparisonKey(target);
  const time = closingTime(target);
  const empty = { status: "missing", sampleSize: 0, medianLast5F: null,
    fasterThanMedianSeconds: null, fasterPercentile: null, scoreAdjustment: 0 };
  if (!cutoff || !targetDate || targetDate >= cutoff || !key || time == null || !target?.key) return empty;
  const races = history instanceof Map ? [...history.values()] : history?.races ?? [];
  const seen = new Set();
  const times = [];
  for (const race of races) {
    const date = normalizeDate(race?.date);
    const value = closingTime(race);
    if (!race?.key || race.key === target.key || seen.has(race.key) || !date || date >= cutoff ||
      comparisonKey(race) !== key || value == null) continue;
    seen.add(race.key);
    times.push(value);
  }
  if (times.length < MIN_COMPARISON_RACES) return { ...empty, status: "limited", sampleSize: times.length };
  times.sort((a, b) => a - b);
  const middle = Math.floor(times.length / 2);
  const median = times.length % 2 ? times[middle] : (times[middle - 1] + times[middle]) / 2;
  return {
    status: "available",
    sampleSize: times.length,
    medianLast5F: round(median),
    fasterThanMedianSeconds: round(median - time),
    fasterPercentile: round(100 * times.reduce((total, value) => total + (value > time ? 1 : value === time ? 0.5 : 0), 0) / times.length),
    scoreAdjustment: 0,
  };
};

export { MIN_COMPARISON_RACES, buildLapBenchmark, comparisonKey };
