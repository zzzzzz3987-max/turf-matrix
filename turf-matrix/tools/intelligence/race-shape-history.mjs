const COURSE_SLUGS = new Map([
  ["札幌", "sapporo"], ["函館", "hakodate"], ["福島", "fukushima"],
  ["新潟", "niigata"], ["東京", "tokyo"], ["中山", "nakayama"],
  ["中京", "chukyo"], ["京都", "kyoto"], ["阪神", "hanshin"],
  ["小倉", "kokura"],
]);

const finite = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
const rounded = (value, digits = 3) => {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
};
const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const sum = (values) => values.reduce((total, value) => total + value, 0);
const normalizeName = (value) => String(value ?? "").normalize("NFKC").replace(/[\s\u3000]/g, "");
const PACE_TILT_THRESHOLD_SECONDS = 1;

const normalizeCourse = (value) => {
  const normalized = String(value ?? "").normalize("NFKC").trim().toLowerCase();
  const withoutSuffix = normalized.replace(/競馬場$/, "");
  return COURSE_SLUGS.get(normalized) ?? COURSE_SLUGS.get(withoutSuffix) ?? withoutSuffix;
};

const normalizeDate = (value) => {
  const normalized = String(value ?? "").trim().replace(/[./]/g, "-");
  const match = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  return match ? `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}` : null;
};

const raceShapeKey = (date, course, raceNumber) => {
  const normalizedDate = normalizeDate(date);
  const normalizedCourse = normalizeCourse(course);
  const number = Number(raceNumber);
  if (!normalizedDate || !normalizedCourse || !Number.isInteger(number) || number <= 0) return null;
  return `${normalizedDate}-${normalizedCourse}-${String(number).padStart(2, "0")}R`;
};

const firstCorner = (horse) => [horse.corner1, horse.corner2, horse.corner3, horse.corner4]
  .map(Number)
  .find((value) => Number.isFinite(value) && value > 0) ?? null;

const lastCorner = (horse) => [horse.corner4, horse.corner3, horse.corner2, horse.corner1]
  .map(Number)
  .find((value) => Number.isFinite(value) && value > 0) ?? null;

const sectionTime = (laps, distance, targetMeters, fromEnd = false) => {
  if (!Number.isFinite(distance) || distance <= 0 || !laps.length) return null;
  const firstSegmentMeters = distance % 200 || 200;
  const segments = laps.map((time, index) => ({ time, meters: index === 0 ? firstSegmentMeters : 200 }));
  const ordered = fromEnd ? [...segments].reverse() : segments;
  let remaining = targetMeters;
  let seconds = 0;
  for (const segment of ordered) {
    if (remaining <= 0) break;
    const usedMeters = Math.min(remaining, segment.meters);
    seconds += segment.time * (usedMeters / segment.meters);
    remaining -= usedMeters;
  }
  return remaining === 0 ? seconds : null;
};

const classifyPaceTilt = (race) => {
  const laps = (race?.lapTimes ?? []).map(Number).filter((value) => Number.isFinite(value) && value > 0);
  const distance = finite(race?.distance) ? Number(race.distance) : null;
  const expectedLapCount = distance ? Math.ceil(distance / 200) : null;
  const completeLaps = expectedLapCount != null && laps.length === expectedLapCount;
  const needsDistanceNormalization = distance != null && distance % 200 !== 0;
  const normalizedFirst3F = completeLaps ? sectionTime(laps, distance, 600) : null;
  const normalizedLast3F = completeLaps ? sectionTime(laps, distance, 600, true) : null;
  const first3F = needsDistanceNormalization
    ? normalizedFirst3F
    : finite(race?.first3F) ? Number(race.first3F) : normalizedFirst3F ?? (laps.length >= 3 ? sum(laps.slice(0, 3)) : null);
  const last3F = needsDistanceNormalization
    ? normalizedLast3F
    : finite(race?.last3F) ? Number(race.last3F) : normalizedLast3F ?? (laps.length >= 3 ? sum(laps.slice(-3)) : null);
  if (first3F == null || last3F == null) return null;

  const roundedFirst3F = rounded(first3F, 1);
  const roundedLast3F = rounded(last3F, 1);
  const deltaSeconds = rounded(roundedFirst3F - roundedLast3F, 1);
  const classification = deltaSeconds <= -PACE_TILT_THRESHOLD_SECONDS
    ? "front_loaded"
    : deltaSeconds >= PACE_TILT_THRESHOLD_SECONDS ? "back_loaded" : "even";
  const label = classification === "front_loaded" ? "前傾" : classification === "back_loaded" ? "後傾" : "平均";
  const independentSections = distance == null || distance >= 1200;
  const confidence = completeLaps && independentSections ? "high" : independentSections ? "mid" : "low";
  return {
    classification,
    label,
    first3F: roundedFirst3F,
    last3F: roundedLast3F,
    deltaSeconds,
    thresholdSeconds: PACE_TILT_THRESHOLD_SECONDS,
    confidence,
    completeLaps,
    lapCount: laps.length,
    rawFirst3F: finite(race?.first3F) ? Number(race.first3F) : null,
    rawLast3F: finite(race?.last3F) ? Number(race.last3F) : null,
    source: needsDistanceNormalization
      ? "official-200m-laps-normalized-600m"
      : finite(race?.first3F) && finite(race?.last3F) ? "official-first-last-3f" : "official-200m-laps",
  };
};

const outcomeLabel = (shape) => shape === "front_survival" ? "前残り" : shape === "front_collapse" ? "差し決着" : "偏りなし";

const assessHorseFlow = (race, horse) => {
  const paceClass = race?.pace?.confidence === "low" ? null : race?.pace?.classification;
  const frontBurden = (paceClass === "front_loaded" ? 1 : paceClass === "back_loaded" ? -1 : 0) +
    (race?.shape === "front_collapse" ? 1 : race?.shape === "front_survival" ? -1 : 0);
  const roleBurden = horse.role === "front" ? frontBurden : horse.role === "rear" ? -frontBurden : 0;
  const topHalf = horse.finishPosition <= Math.ceil(Number(race.fieldSize) / 2);
  const clearPerformance = horse.finishPosition <= 3 || (topHalf && (horse.role === "front" || horse.positionChange >= 0.15));
  const flowLabel = [race?.pace?.label, outcomeLabel(race?.shape)].filter(Boolean).join("・");

  if (roleBurden >= 1 && clearPerformance) {
    return {
      assessment: "against_flow_strong",
      impact: roleBurden >= 2 ? 2 : 1,
      reason: `${flowLabel}に逆らって${horse.role === "front" ? "前方で踏ん張った" : "後方から押し上げた"}`,
    };
  }
  if (roleBurden <= -1 && horse.finishPosition <= 3) {
    return {
      assessment: "flow_aided",
      impact: -1,
      reason: `${flowLabel}の展開利を受けた好走`,
    };
  }
  return { assessment: "neutral", impact: 0, reason: `${flowLabel}で明確な展開利不利なし` };
};

const classifyRaceShape = (race) => {
  const starters = (race.horses ?? [])
    .map((horse) => ({
      horseNumber: Number(horse.horseNumber),
      horseName: horse.horseName ?? null,
      finishPosition: Number(horse.finishPosition),
      corner: firstCorner(horse),
      lastCorner: lastCorner(horse),
      abnormalityCode: String(horse.abnormalityCode ?? "0"),
    }))
    .filter((horse) => Number.isInteger(horse.finishPosition) && horse.finishPosition > 0);
  const expectedFieldSize = Number(race.fieldSize);
  const observedMaximum = Math.max(0, ...starters.flatMap((horse) => [horse.finishPosition, horse.corner ?? 0, horse.lastCorner ?? 0]));
  const fieldSize = Math.max(starters.length, Number.isInteger(expectedFieldSize) ? expectedFieldSize : 0, observedMaximum);
  const withCorner = starters.filter((horse) => finite(horse.corner));
  const cornerCoverage = fieldSize ? withCorner.length / fieldSize : 0;
  const starterCoverage = fieldSize ? starters.length / fieldSize : 0;
  if (fieldSize < 5 || withCorner.length < 4 || cornerCoverage < 0.6 || starterCoverage < 0.8) return null;

  const rows = withCorner.map((horse) => {
    const earlyQuantile = (horse.corner - 1) / Math.max(1, fieldSize - 1);
    const finishQuantile = (horse.finishPosition - 1) / Math.max(1, fieldSize - 1);
    const role = earlyQuantile <= 0.25 ? "front" : earlyQuantile >= 0.65 ? "rear" : "middle";
    return {
      ...horse,
      earlyQuantile,
      finishQuantile,
      role,
      positionChange: earlyQuantile - finishQuantile,
    };
  });
  const front = rows.filter((horse) => horse.role === "front");
  const rear = rows.filter((horse) => horse.role === "rear");
  const topHalf = Math.ceil(fieldSize / 2);
  const rate = (items, predicate) => items.length ? items.filter(predicate).length / items.length : null;
  const frontTopHalfRate = rate(front, (horse) => horse.finishPosition <= topHalf);
  const frontPlaceRate = rate(front, (horse) => horse.finishPosition <= 3);
  const rearTopHalfRate = rate(rear, (horse) => horse.finishPosition <= topHalf);
  const winner = rows.find((horse) => horse.finishPosition === 1) ?? null;
  const frontMeanLoss = front.length ? mean(front.map((horse) => -horse.positionChange)) : null;

  let shape = "neutral";
  if (
    front.length >= 2 && frontTopHalfRate <= 0.34 &&
    ((rearTopHalfRate ?? 0) >= 0.5 || (winner?.earlyQuantile ?? 0) >= 0.5 || (frontMeanLoss ?? 0) >= 0.3)
  ) shape = "front_collapse";
  else if (
    front.length >= 2 && frontTopHalfRate >= 0.67 && frontPlaceRate >= 0.34 &&
    (winner?.earlyQuantile ?? 1) <= 0.35 && (frontMeanLoss ?? 1) <= 0.15
  ) shape = "front_survival";

  const confidence = cornerCoverage >= 0.85 && front.length >= 2 ? "high" : "mid";
  const pace = classifyPaceTilt(race);
  const raceForFlow = { shape, pace, fieldSize };
  return {
    shape,
    outcome: { classification: shape, label: outcomeLabel(shape), confidence },
    pace,
    confidence,
    fieldSize,
    cornerRunnerCount: withCorner.length,
    cornerCoverage: rounded(cornerCoverage),
    frontCount: front.length,
    rearCount: rear.length,
    frontTopHalfRate: frontTopHalfRate == null ? null : rounded(frontTopHalfRate),
    frontPlaceRate: frontPlaceRate == null ? null : rounded(frontPlaceRate),
    rearTopHalfRate: rearTopHalfRate == null ? null : rounded(rearTopHalfRate),
    frontMeanLoss: frontMeanLoss == null ? null : rounded(frontMeanLoss),
    winnerEarlyQuantile: winner ? rounded(winner.earlyQuantile) : null,
    horses: rows.map((horse) => {
      const flow = assessHorseFlow(raceForFlow, horse);
      return {
        horseNumber: horse.horseNumber,
        horseName: horse.horseName,
        finishPosition: horse.finishPosition,
        firstCornerPosition: horse.corner,
        lastCornerPosition: horse.lastCorner,
        earlyQuantile: rounded(horse.earlyQuantile),
        finishQuantile: rounded(horse.finishQuantile),
        positionChange: rounded(horse.positionChange),
        role: horse.role,
        ...(flow.impact !== 0 ? {
          flowImpact: flow.impact,
          flowAssessment: flow.assessment,
          flowReason: flow.reason,
        } : {}),
      };
    }),
  };
};

const buildRaceShapeIndex = (history) => new Map((history?.races ?? []).map((race) => [race.key, race]));

export {
  PACE_TILT_THRESHOLD_SECONDS,
  assessHorseFlow,
  buildRaceShapeIndex,
  classifyPaceTilt,
  classifyRaceShape,
  normalizeCourse,
  normalizeDate,
  normalizeName,
  raceShapeKey,
};
