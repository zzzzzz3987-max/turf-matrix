import { buildPaceShapeProfile } from "./pace-shape-shadow.mjs";
import { classifyRunningStyle } from "./pace-ai.mjs";
import { classifyFrame } from "./track-bias-ai.mjs";
import { courseGeometryStyles } from "./course-geometry.mjs";

const MAX_ADJUSTMENT = 2;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
const isFlatSurface = (surface) => ["芝", "ダ", "ダート"].includes(String(surface ?? ""));

const styleGroup = (style) => style === "逃げ" || style === "先行" ? "front" : style === "追込" ? "rear" : style === "差し" ? "middle" : "unknown";

const axisFit = (value, axis, first, second) => {
  if (!axis || axis.status !== "active") return 0;
  if (value === axis.direction) return axis.strength === "strong" ? 1 : 0;
  if ((axis.direction === first && value === second) || (axis.direction === second && value === first)) return -1;
  return 0;
};

const geometryStyles = (context = {}) => {
  const direct = (context.styleBias ?? []).filter((value) => ["逃げ", "先行", "差し", "追込"].includes(value));
  if (direct.length) return { favored: direct, opposed: [], source: "course-profile" };
  const shape = context.courseShape ?? {};
  const derived = courseGeometryStyles(shape, context.surface);
  if (derived.favored.length || derived.opposed.length) return { ...derived, source: "course-geometry" };
  return { favored: [], opposed: [], source: "unavailable" };
};

const geometryAdjustment = (style, context) => {
  const exactAlreadyApplied = (context.styleBias ?? []).includes(style);
  const geometry = geometryStyles(context);
  if (exactAlreadyApplied || geometry.source !== "course-geometry") return 0;
  if (geometry.favored.includes(style)) return 1;
  if (geometry.opposed.includes(style)) return -1;
  return 0;
};

const straightThousandFrameAdjustment = (frame, context) => {
  const shape = context.courseShape ?? {};
  const isStraightThousand = Number(context.distance) === 1000 && (shape.turn === "straight" || shape.layout === "straight");
  if (!isStraightThousand) return 0;
  if (frame === "outer") return 1;
  if (frame === "inner") return -1;
  return 0;
};

const paceConflict = ({ style, expectedPace, positionDirection, adjustment }) => {
  if (adjustment <= 0) return adjustment;
  if (expectedPace === "ハイ" && positionDirection === "front" && styleGroup(style) === "front") return 0;
  if (expectedPace === "スロー" && positionDirection === "rear" && styleGroup(style) === "rear") return 0;
  return adjustment;
};

const fitLabel = (value) => value >= 2 ? "有利" : value === 1 ? "やや有利" : value <= -2 ? "不利" : value === -1 ? "やや不利" : "中立";

const buildCoursePaceContextProfile = (horse, context = {}) => {
  const style = classifyRunningStyle(horse);
  if (!isFlatSurface(context.surface)) {
    return {
      status: "unsupported",
      adjustment: 0,
      rawAdjustment: 0,
      label: "対象外",
      style,
      frame: "unknown",
      expectedPace: context.paceScenario?.expectedPace ?? null,
      scenarioConfidence: "missing",
      components: { geometry: 0, staticFrame: 0, trackPosition: 0, trackFrame: 0, paceConflictApplied: false },
      evidence: ["障害戦はCourse × Pace × 枠 × 馬場傾向の影評価対象外"],
    };
  }
  const fieldSize = Number(horse.currentRace?.fieldSize ?? context.fieldSize ?? context.paceScenario?.fieldSize);
  const horseNumber = Number(horse.horseNumber ?? horse.number ?? horse.currentRace?.horseNumber);
  const frame = classifyFrame(horseNumber, fieldSize);
  const bias = context.trackBias ?? null;
  const scenario = context.paceScenario ?? null;
  const geometry = geometryAdjustment(style, context);
  const staticFrame = straightThousandFrameAdjustment(frame, context);
  const rawPosition = axisFit(styleGroup(style), bias?.position, "front", "rear");
  const position = paceConflict({
    style,
    expectedPace: scenario?.expectedPace,
    positionDirection: bias?.position?.direction,
    adjustment: rawPosition,
  });
  const liveFrame = axisFit(frame, bias?.frame, "inner", "outer");
  const rawAdjustment = geometry + staticFrame + position + liveFrame;
  const adjustment = clamp(Math.round(rawAdjustment), -MAX_ADJUSTMENT, MAX_ADJUSTMENT);
  const evidence = [
    `想定ペース ${scenario?.expectedPace ?? "未算出"} / 脚質 ${style}`,
    `コース形態 ${context.courseShape?.layout ?? "未取得"} / 形態補正 ${geometry >= 0 ? "+" : ""}${geometry}`,
    `枠ゾーン ${frame} / 固有枠補正 ${staticFrame >= 0 ? "+" : ""}${staticFrame}`,
  ];
  if (bias) {
    evidence.push(`確定結果 ${bias.sample?.raceCount ?? 0}R / 脚質補正 ${position >= 0 ? "+" : ""}${position} / 枠補正 ${liveFrame >= 0 ? "+" : ""}${liveFrame}`);
    evidence.push(bias.laneEvidence?.reason ?? "直線の実走進路は未取得");
  } else evidence.push("当日以前のトラックバイアスは未取得");
  return {
    status: scenario || context.courseShape || bias ? "active" : "missing",
    adjustment,
    rawAdjustment,
    label: fitLabel(adjustment),
    style,
    frame,
    expectedPace: scenario?.expectedPace ?? null,
    scenarioConfidence: scenario?.confidence ?? "missing",
    components: {
      geometry,
      staticFrame,
      trackPosition: position,
      trackFrame: liveFrame,
      paceConflictApplied: rawPosition !== position,
    },
    evidence,
  };
};

const buildPaceContextShadow = (horse, currentPace, context = {}, history = { races: [] }) => {
  const current = finite(currentPace) ? Number(currentPace) : 60;
  const historical = buildPaceShapeProfile(horse, history);
  const currentContext = buildCoursePaceContextProfile(horse, context);
  const supported = isFlatSurface(context.surface);
  const adjustment = supported ? clamp(historical.adjustment + currentContext.adjustment, -MAX_ADJUSTMENT, MAX_ADJUSTMENT) : 0;
  return {
    status: !supported ? "unsupported" : historical.matchedRunCount || currentContext.status === "active" ? "active" : "missing",
    currentScore: current,
    shadowScore: Math.round(clamp(current + adjustment, 35, 96)),
    adjustment,
    maxAdjustment: MAX_ADJUSTMENT,
    historical,
    currentContext,
    confidence: historical.matchedRunCount >= 3 && currentContext.scenarioConfidence === "high"
      ? "B"
      : historical.matchedRunCount || currentContext.status === "active" ? "C" : "Low",
    evidence: [...historical.runs.map((run) => `${run.date} ${run.reason}`), ...currentContext.evidence],
    policy: {
      currentRaceResultUsed: false,
      futureRaceShapeAllowed: false,
      currentHorsePopularityOddsValueUsed: false,
      sourcePopularityUsedOnlyToDebiasTrackObservation: Boolean(context.trackBias),
      observedLanePathUsed: false,
      frameZoneIsNotLanePath: true,
      productionConnected: false,
    },
  };
};

export {
  MAX_ADJUSTMENT,
  buildCoursePaceContextProfile,
  buildPaceContextShadow,
  geometryStyles,
  isFlatSurface,
  styleGroup,
};
