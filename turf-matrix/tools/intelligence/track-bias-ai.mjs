import { classifyRunningStyle } from "./pace-ai.mjs";

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
const round = (value, digits = 3) => Number(value.toFixed(digits));

const normalizeSurface = (value) => String(value ?? "").startsWith("ダ") ? "ダート" : String(value ?? "");

const dateValue = (value) => {
  const timestamp = Date.parse(`${String(value ?? "").slice(0, 10)}T00:00:00+09:00`);
  return Number.isFinite(timestamp) ? timestamp : null;
};

const classifyPosition = (corner4, fieldSize) => {
  if (!finite(corner4) || !finite(fieldSize) || Number(fieldSize) < 2) return "unknown";
  const frontLimit = Math.max(3, Math.ceil(Number(fieldSize) * 0.25));
  if (Number(corner4) <= frontLimit) return "front";
  if (Number(corner4) <= Number(fieldSize) * 0.6) return "middle";
  return "rear";
};

const classifyFrame = (horseNumber, fieldSize) => {
  if (!finite(horseNumber) || !finite(fieldSize) || Number(fieldSize) < 3) return "unknown";
  const quantile = (Number(horseNumber) - 1) / (Number(fieldSize) - 1);
  if (quantile <= 1 / 3) return "inner";
  if (quantile >= 2 / 3) return "outer";
  return "middle";
};

const popularityOutperformance = (horse, fieldSize) => {
  const finish = Number(horse.finish ?? horse.finishPosition ?? horse.FinishPosition);
  const popularity = Number(horse.popularity ?? horse.finalPopularity ?? horse.FinalPopularity);
  if (fieldSize <= 1 || !finite(finish) || !finite(popularity)) return null;
  const actual = (fieldSize - finish) / (fieldSize - 1);
  const expected = (fieldSize - popularity) / (fieldSize - 1);
  return actual - expected;
};

const normalizeBiasRaces = (races = []) => races.map((race) => {
  const source = race.horses ?? race.Horses ?? [];
  const active = source.filter((horse) => finite(horse.finish ?? horse.finishPosition ?? horse.FinishPosition));
  const fieldSize = Number(race.fieldSize) || Math.max(active.length, ...active.map((horse) => Number(horse.horseNumber ?? horse.HorseNumber) || 0));
  return {
    ...race,
    fieldSize,
    horses: active.map((horse) => {
      const finish = Number(horse.finish ?? horse.finishPosition ?? horse.FinishPosition);
      const popularity = finite(horse.popularity ?? horse.finalPopularity ?? horse.FinalPopularity)
        ? Number(horse.popularity ?? horse.finalPopularity ?? horse.FinalPopularity)
        : null;
      const corner4 = finite(horse.corner4 ?? horse.Corner4) ? Number(horse.corner4 ?? horse.Corner4) : null;
      const horseNumber = finite(horse.horseNumber ?? horse.HorseNumber) ? Number(horse.horseNumber ?? horse.HorseNumber) : null;
      return {
        ...horse,
        finish,
        popularity,
        corner4,
        horseNumber,
        positionGroup: classifyPosition(corner4, fieldSize),
        frameGroup: classifyFrame(horseNumber, fieldSize),
        outperformance: popularityOutperformance({ finish, popularity }, fieldSize),
      };
    }),
  };
}).filter((race) => race.horses.length >= 3);

const groupStats = (races, groupKey, groupValue) => {
  const horses = races.flatMap((race) => race.horses.filter((horse) => horse[groupKey] === groupValue));
  const residuals = horses.map((horse) => horse.outperformance).filter(Number.isFinite);
  return {
    runnerCount: horses.length,
    winCount: horses.filter((horse) => horse.finish === 1).length,
    top3Count: horses.filter((horse) => horse.finish <= 3).length,
    top3Rate: horses.length ? horses.filter((horse) => horse.finish <= 3).length / horses.length : 0,
    residualCount: residuals.length,
    meanOutperformance: residuals.length ? residuals.reduce((sum, value) => sum + value, 0) / residuals.length : null,
  };
};

const buildAxis = ({ races, groupKey, first, second, mode }) => {
  const firstStats = groupStats(races, groupKey, first);
  const secondStats = groupStats(races, groupKey, second);
  const residualDifference = firstStats.meanOutperformance != null && secondStats.meanOutperformance != null
    ? firstStats.meanOutperformance - secondStats.meanOutperformance
    : null;
  const top3Difference = firstStats.top3Rate - secondStats.top3Rate;
  const signal = residualDifference == null ? null : residualDifference * 0.7 + top3Difference * 0.3;
  const minimumRaces = mode === "same_day" ? 3 : 4;
  const sampleReady = races.length >= minimumRaces
    && firstStats.runnerCount >= 5
    && secondStats.runnerCount >= 5
    && firstStats.residualCount >= 5
    && secondStats.residualCount >= 5;
  const active = sampleReady && signal != null && Math.abs(signal) >= 0.08;
  const strong = active && races.length >= 7 && firstStats.runnerCount >= 12 && secondStats.runnerCount >= 12 && Math.abs(signal) >= 0.14;
  return {
    status: active ? "active" : "monitor",
    direction: active ? (signal > 0 ? first : second) : "neutral",
    strength: strong ? "strong" : active ? "moderate" : "watch",
    confidence: strong ? "high" : active ? "mid" : "low",
    signal: signal == null ? null : round(signal),
    residualDifference: residualDifference == null ? null : round(residualDifference),
    top3Difference: round(top3Difference),
    groups: {
      [first]: { ...firstStats, meanOutperformance: firstStats.meanOutperformance == null ? null : round(firstStats.meanOutperformance) },
      [second]: { ...secondStats, meanOutperformance: secondStats.meanOutperformance == null ? null : round(secondStats.meanOutperformance) },
    },
  };
};

const buildTrackBiasProfile = ({ track, surface, races = [], mode = "previous_day", scoringMode = "shadow" }) => {
  const normalized = normalizeBiasRaces(races);
  const position = buildAxis({ races: normalized, groupKey: "positionGroup", first: "front", second: "rear", mode });
  const frame = buildAxis({ races: normalized, groupKey: "frameGroup", first: "inner", second: "outer", mode });
  const activeAxes = [position, frame].filter((axis) => axis.status === "active");
  const strongest = [...activeAxes].sort((left, right) => Math.abs(right.signal ?? 0) - Math.abs(left.signal ?? 0))[0] ?? null;
  const raceNumbers = normalized.map((race) => Number(race.raceNo ?? race.raceNumber)).filter(Number.isFinite);
  const runners = normalized.flatMap((race) => race.horses);
  return {
    track,
    surface: normalizeSurface(surface),
    status: activeAxes.length ? "active" : "monitor",
    style: position.direction,
    frameStyle: frame.direction,
    strength: strongest?.strength ?? "watch",
    confidence: strongest?.confidence ?? "low",
    scoringMode,
    sourceMode: mode,
    sourceThroughRaceNo: raceNumbers.length ? Math.max(...raceNumbers) : null,
    position,
    frame,
    laneEvidence: {
      status: "unavailable",
      reason: "JV-Link確定成績には直線の実走進路がないため、内伸び・外伸びとは判定しない",
    },
    sample: {
      raceCount: normalized.length,
      runnerCount: runners.length,
      frontWins: position.groups.front.winCount,
      frontTop3Count: position.groups.front.top3Count,
      frontRunnerCount: position.groups.front.runnerCount,
      rearTop3Count: position.groups.rear.top3Count,
      rearRunnerCount: position.groups.rear.runnerCount,
      innerRunnerCount: frame.groups.inner.runnerCount,
      outerRunnerCount: frame.groups.outer.runnerCount,
      positionSignal: position.signal,
      frameSignal: frame.signal,
    },
    note: activeAxes.length
      ? "人気順位との差を使って脚質・枠ゾーンの偏りを監視。影評価のみで本番指数には未接続。"
      : "必要レース数、両群サンプル、人気補正後の差を同時に満たさないため補正しない。",
  };
};

const isChronologicallyValid = (snapshot, race) => {
  const targetDate = String(race?.raceDate ?? race?.date ?? "").slice(0, 10);
  if (!targetDate || snapshot?.targetDate !== targetDate) return false;
  const source = dateValue(snapshot?.sourceDate);
  const target = dateValue(targetDate);
  return source != null && target != null && source < target;
};

const resolveRaceSamples = (snapshot, race) => {
  const targetDate = String(race?.raceDate ?? race?.date ?? "").slice(0, 10);
  const targetRaceNo = Number(race?.raceNo ?? race?.number);
  const track = race.course ?? race.track;
  const surface = normalizeSurface(race.surface);
  if (!targetDate || !track || !surface || !Array.isArray(snapshot?.races)) return null;
  const matching = snapshot.races.filter((item) => {
    if ((item.track ?? item.course) !== track || normalizeSurface(item.surface) !== surface) return false;
    const sourceDate = String(item.date ?? snapshot.sourceDate ?? "").slice(0, 10);
    const sourceRaceNo = Number(item.raceNo ?? item.raceNumber);
    if (sourceDate < targetDate) return true;
    return sourceDate === targetDate && Number.isFinite(targetRaceNo) && Number.isFinite(sourceRaceNo) && sourceRaceNo < targetRaceNo;
  });
  if (!matching.length) return null;
  const sameDay = matching.some((item) => String(item.date ?? snapshot.sourceDate ?? "").slice(0, 10) === targetDate);
  return buildTrackBiasProfile({ track, surface, races: matching, mode: sameDay ? "same_day" : "previous_day", scoringMode: snapshot.scoringMode ?? "shadow" });
};

const resolveTrackBias = (snapshot, race = {}) => {
  const dynamic = resolveRaceSamples(snapshot, race);
  if (dynamic) return {
    ...dynamic,
    sourceDate: snapshot.sourceDate,
    targetDate: String(race?.raceDate ?? race?.date ?? "").slice(0, 10),
    generatedAt: snapshot.generatedAt,
    method: snapshot.method,
    source: snapshot.source,
  };
  if (!snapshot || !isChronologicallyValid(snapshot, race)) return null;
  const track = race.course ?? race.track;
  const surface = normalizeSurface(race.surface);
  const profile = (snapshot.profiles ?? []).find((item) => item.track === track && normalizeSurface(item.surface) === surface);
  if (!profile) return null;
  return {
    ...profile,
    sourceDate: snapshot.sourceDate,
    targetDate: snapshot.targetDate,
    method: snapshot.method,
    source: snapshot.source,
  };
};

const axisAdjustment = (value, axis, positive, negative) => {
  if (!axis || axis.status !== "active") return 0;
  if (value === axis.direction) return axis.strength === "strong" ? 1 : 0;
  if ((axis.direction === positive && value === negative) || (axis.direction === negative && value === positive)) return -1;
  return 0;
};

const trackBiasAdjustment = (horse, context = {}) => {
  const bias = context.trackBias;
  if (!bias || bias.status !== "active" || bias.scoringMode === "shadow") return 0;
  const style = classifyRunningStyle(horse);
  const legacy = !bias.position;
  if (legacy) {
    if (bias.style !== "front") return 0;
    if (style === "追込") return -1;
    if (bias.strength === "strong" && (style === "逃げ" || style === "先行")) return 1;
    return 0;
  }
  const positionGroup = style === "逃げ" || style === "先行" ? "front" : style === "追込" ? "rear" : "middle";
  const fieldSize = Number(horse.currentRace?.fieldSize ?? context.fieldSize);
  const frameGroup = classifyFrame(horse.horseNumber ?? horse.number ?? horse.currentRace?.horseNumber, fieldSize);
  const positionValue = axisAdjustment(positionGroup, bias.position, "front", "rear");
  const frameValue = axisAdjustment(frameGroup, bias.frame, "inner", "outer");
  return clamp(positionValue + frameValue, -1, 1);
};

const biasLabel = (direction, kind) => {
  if (kind === "position") return direction === "front" ? "前有利" : direction === "rear" ? "差し有利" : "脚質中立";
  return direction === "inner" ? "内枠有利" : direction === "outer" ? "外枠有利" : "枠中立";
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
  const sourceDate = bias.sourceDate ?? "当日以前";
  const active = bias.status === "active";
  const shadow = bias.scoringMode === "shadow";
  const positionText = bias.position ? biasLabel(bias.position.direction, "position") : biasLabel(bias.style, "position");
  const frameText = bias.frame ? biasLabel(bias.frame.direction, "frame") : "枠未判定";
  const adjustmentText = shadow ? "影評価のみ" : adjustment === 0 ? "指数補正なし" : `TM INDEX ${adjustment > 0 ? "+" : ""}${adjustment}点`;
  const summary = active
    ? `${sourceDate}の同会場・同馬場${raceCount}Rから${positionText}・${frameText}を検知。${style}脚質は${adjustmentText}。`
    : `${sourceDate}の同会場・同馬場${raceCount}Rを監視。根拠が基準未満のため指数補正は行いません。`;

  return {
    key: "trackBias",
    label: "馬場傾向",
    score: clamp(65 + adjustment * 10, 55, 75),
    maxScore: 100,
    status: active ? (shadow ? "monitor" : "active") : "monitor",
    confidence: bias.confidence ?? "low",
    adjustment,
    style,
    biasStyle: bias.style,
    frameStyle: bias.frameStyle ?? "neutral",
    strength: bias.strength,
    sourceDate,
    sample,
    summary,
    evidence: [
      `${sourceDate} ${bias.track}${bias.surface} ${raceCount}R・${sample.runnerCount ?? 0}頭`,
      `脚質傾向 ${positionText} / 枠傾向 ${frameText}`,
      `今回脚質 ${style} / ${adjustmentText}`,
      bias.laneEvidence?.reason ?? "実走進路データは未取得",
      ...(bias.note ? [bias.note] : []),
    ],
  };
};

export {
  buildTrackBiasAnalysis,
  buildTrackBiasProfile,
  classifyFrame,
  classifyPosition,
  normalizeSurface,
  popularityOutperformance,
  resolveTrackBias,
  trackBiasAdjustment,
};
