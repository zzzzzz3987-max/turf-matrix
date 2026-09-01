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
const normalizeName = (value) => String(value ?? "").normalize("NFKC").replace(/[\s\u3000]/g, "");

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
  return {
    shape,
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
    horses: rows.map((horse) => ({
      horseNumber: horse.horseNumber,
      horseName: horse.horseName,
      finishPosition: horse.finishPosition,
      firstCornerPosition: horse.corner,
      lastCornerPosition: horse.lastCorner,
      earlyQuantile: rounded(horse.earlyQuantile),
      finishQuantile: rounded(horse.finishQuantile),
      positionChange: rounded(horse.positionChange),
      role: horse.role,
    })),
  };
};

const buildRaceShapeIndex = (history) => new Map((history?.races ?? []).map((race) => [race.key, race]));

export {
  buildRaceShapeIndex,
  classifyRaceShape,
  normalizeCourse,
  normalizeDate,
  normalizeName,
  raceShapeKey,
};
