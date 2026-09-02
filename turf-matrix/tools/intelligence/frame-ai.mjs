import { createRequire } from "node:module";
import {
  COURSE_NAMES,
  distanceBand,
  fieldSizeBand,
  normalizeCourse,
  normalizeSurface,
  relativeGateZone,
  resolveFrameAptitude,
} from "../learn/frame-aptitude-learning.mjs";

const require = createRequire(import.meta.url);
const DEFAULT_MODEL = require("../../data/master/frame-aptitude.json");
const SCORE_BASELINE = 65;
const SCORE_SCALE = 100;
const SCORE_MIN = 58;
const SCORE_MAX = 72;

const finite = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
const clampScore = (value) => Math.max(SCORE_MIN, Math.min(SCORE_MAX, Math.round(value)));
const pct = (value) => finite(value) ? `${(Number(value) * 100).toFixed(1)}%` : "-";

const frameSnapshot = (horse, context = {}) => {
  const horseNumber = Number(horse?.horseNumber ?? horse?.number ?? horse?.currentRace?.horseNumber);
  const fieldSize = Number(context?.fieldSize ?? context?.paceScenario?.fieldSize ?? horse?.currentRace?.fieldSize);
  const surface = normalizeSurface(context?.surface ?? horse?.currentRace?.surface);
  const course = normalizeCourse(context?.course ?? horse?.currentRace?.course);
  const distance = Number(context?.distance ?? horse?.currentRace?.distance);
  return {
    raceDate: context?.date ?? horse?.currentRace?.raceDate ?? null,
    course,
    surface,
    distance,
    distanceBand: distanceBand(distance),
    fieldSize,
    fieldSizeBand: fieldSizeBand(fieldSize),
    horseNumber,
    zone: relativeGateZone(horseNumber, fieldSize),
  };
};

const modelAvailableAt = (model, raceDate) => {
  const modelEnd = String(model?.period?.to ?? "");
  const target = String(raceDate ?? "");
  return /^\d{4}-\d{2}-\d{2}$/.test(modelEnd) && /^\d{4}-\d{2}-\d{2}$/.test(target) && modelEnd < target;
};

const confidenceFor = (match) => {
  const sample = Number(match?.zoneStats?.sampleSize ?? 0);
  if (sample >= 100) return "A";
  if (sample >= 50) return "B";
  if (sample >= 20) return "C";
  if (sample >= 10) return "D";
  return "Low";
};

const zoneLabel = (zone) => ({ inner: "内寄り", middle: "中ほど", outer: "外寄り" })[zone] ?? "位置不明";
const surfaceLabel = (surface) => ({ turf: "芝", dirt: "ダート" })[surface] ?? "馬場不明";
const distanceLabel = (band) => ({ sprint: "1400m以下", mile: "1500〜1800m", middle: "1900〜2200m", long: "2300m以上" })[band] ?? "距離不明";
const fieldLabel = (band) => ({ small: "9頭以下", medium: "10〜13頭", large: "14頭以上" })[band] ?? "頭数不明";
const levelLabel = (level, snapshot) => ({
  course_surface_distance_field: `${COURSE_NAMES[snapshot.course]}${surfaceLabel(snapshot.surface)}・${distanceLabel(snapshot.distanceBand)}・${fieldLabel(snapshot.fieldSizeBand)}`,
  course_surface_distance: `${COURSE_NAMES[snapshot.course]}${surfaceLabel(snapshot.surface)}・${distanceLabel(snapshot.distanceBand)}`,
  course_surface_field: `${COURSE_NAMES[snapshot.course]}${surfaceLabel(snapshot.surface)}・${fieldLabel(snapshot.fieldSizeBand)}`,
  course_surface: `${COURSE_NAMES[snapshot.course]}${surfaceLabel(snapshot.surface)}`,
  surface_distance_field: `${surfaceLabel(snapshot.surface)}・${distanceLabel(snapshot.distanceBand)}・${fieldLabel(snapshot.fieldSizeBand)}`,
  surface_distance: `${surfaceLabel(snapshot.surface)}・${distanceLabel(snapshot.distanceBand)}`,
  surface_field: `${surfaceLabel(snapshot.surface)}・${fieldLabel(snapshot.fieldSizeBand)}`,
  surface: surfaceLabel(snapshot.surface),
  global: "全平地競走",
})[level] ?? "近似条件";

const buildFrameAptitudeShadow = (horse, context = {}, currentFrameScore = null, model = DEFAULT_MODEL) => {
  const snapshot = frameSnapshot(horse, context);
  const currentScore = finite(currentFrameScore) ? Number(currentFrameScore) : null;
  const available = modelAvailableAt(model, snapshot.raceDate);
  const match = available ? resolveFrameAptitude(model, snapshot) : null;
  const adjustedLift = Number(match?.zoneStats?.adjustedLift ?? 0);
  const targetScore = match ? clampScore(SCORE_BASELINE + adjustedLift * SCORE_SCALE) : currentScore ?? SCORE_BASELINE;
  const condition = match ? levelLabel(match.level, snapshot) : null;
  const confidence = match ? confidenceFor(match) : "Low";
  const status = !snapshot.zone
    ? "missing_gate_context"
    : !available
      ? "future_leakage_blocked"
      : match ? "active" : "no_supported_context";
  const summary = match
    ? `${snapshot.fieldSize}頭立て${snapshot.horseNumber}番の${zoneLabel(snapshot.zone)}。${condition}の実績では、同位置の3着内率${pct(match.zoneStats.hitRate)}を同条件平均${pct(match.cell.baselineHitRate)}へ縮小補正し、${adjustedLift >= 0 ? "有利" : "不利"}${Math.abs(adjustedLift * 100).toFixed(1)}pt相当と評価。`
    : `${snapshot.fieldSize || "-"}頭立て${snapshot.horseNumber || "-"}番。十分な過去条件がないため枠順は中立評価。`;
  return {
    modelVersion: "frame-aptitude-empirical-v2",
    status,
    currentScore,
    shadowScore: targetScore,
    adjustment: currentScore == null ? null : targetScore - currentScore,
    confidence,
    snapshot,
    match: match ? {
      level: match.level,
      condition,
      zone: match.zone,
      sampleSize: match.zoneStats.sampleSize,
      placedCount: match.zoneStats.placedCount,
      hitRate: match.zoneStats.hitRate,
      baselineHitRate: match.cell.baselineHitRate,
      adjustedHitRate: match.zoneStats.adjustedHitRate,
      adjustedLift: match.zoneStats.adjustedLift,
      reliability: match.zoneStats.reliability,
    } : null,
    summary,
    evidence: match ? [
      `${condition} ${match.zoneStats.sampleSize}走`,
      `${zoneLabel(match.zone)}の3着内率 ${pct(match.zoneStats.hitRate)}`,
      `同条件平均 ${pct(match.cell.baselineHitRate)}`,
      `縮小補正後 ${adjustedLift >= 0 ? "+" : ""}${(adjustedLift * 100).toFixed(1)}pt`,
    ] : [],
    policy: {
      productionConnected: false,
      tmIndexConnected: false,
      currentRaceResultRead: false,
      popularityOddsValueUsed: false,
      raceRunningPositionUsed: false,
      scoreRange: [SCORE_MIN, SCORE_MAX],
    },
  };
};

export {
  SCORE_BASELINE,
  SCORE_MAX,
  SCORE_MIN,
  buildFrameAptitudeShadow,
  confidenceFor,
  frameSnapshot,
  modelAvailableAt,
};
