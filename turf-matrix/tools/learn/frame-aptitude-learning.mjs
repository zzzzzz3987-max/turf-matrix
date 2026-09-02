const DEFAULT_FRAME_LEARNING_OPTIONS = Object.freeze({
  validationFraction: 0.3,
  minimumSamples: Object.freeze({
    course_surface_distance_field: 12,
    course_surface_distance: 18,
    course_surface_field: 18,
    course_surface: 24,
    surface_distance_field: 24,
    surface_distance: 30,
    surface_field: 30,
    surface: 40,
    global: 60,
  }),
  priorWeights: Object.freeze({
    global: 80,
    surface: 60,
    surface_distance: 50,
    surface_field: 50,
    course_surface: 45,
    surface_distance_field: 40,
    course_surface_distance: 35,
    course_surface_field: 35,
    course_surface_distance_field: 30,
  }),
});

const FRAME_CONTEXT_LEVELS = Object.freeze([
  { id: "global", fields: [] },
  { id: "surface", fields: ["surface"] },
  { id: "surface_distance", fields: ["surface", "distanceBand"] },
  { id: "surface_field", fields: ["surface", "fieldSizeBand"] },
  { id: "course_surface", fields: ["course", "surface"] },
  { id: "surface_distance_field", fields: ["surface", "distanceBand", "fieldSizeBand"] },
  { id: "course_surface_distance", fields: ["course", "surface", "distanceBand"] },
  { id: "course_surface_field", fields: ["course", "surface", "fieldSizeBand"] },
  { id: "course_surface_distance_field", fields: ["course", "surface", "distanceBand", "fieldSizeBand"] },
]);

const LOOKUP_ORDER = Object.freeze([...FRAME_CONTEXT_LEVELS].reverse().map((level) => level.id));
const LEVEL_BY_ID = new Map(FRAME_CONTEXT_LEVELS.map((level) => [level.id, level]));
const PARENT_LEVELS = Object.freeze({
  global: [],
  surface: ["global"],
  surface_distance: ["surface"],
  surface_field: ["surface"],
  course_surface: ["surface"],
  surface_distance_field: ["surface_distance", "surface_field"],
  course_surface_distance: ["course_surface", "surface_distance"],
  course_surface_field: ["course_surface", "surface_field"],
  course_surface_distance_field: ["course_surface_distance", "course_surface_field", "surface_distance_field"],
});

const COURSE_NAMES = Object.freeze({
  sapporo: "札幌", hakodate: "函館", fukushima: "福島", niigata: "新潟", tokyo: "東京",
  nakayama: "中山", chukyo: "中京", kyoto: "京都", hanshin: "阪神", kokura: "小倉",
});

const finite = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
const round = (value, digits = 4) => Number(Number(value).toFixed(digits));
const roundNullable = (value, digits = 4) => finite(value) ? round(value, digits) : null;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const rate = (placedCount, sampleSize) => sampleSize ? placedCount / sampleSize : null;

const normalizeSurface = (value, trackCode = null) => {
  const normalized = String(value ?? "").normalize("NFKC");
  if (normalized.includes("芝")) return "turf";
  if (normalized.includes("ダ")) return "dirt";
  const code = String(trackCode ?? "").trim();
  if (/^(1[0-9]|2[0-2])$/.test(code)) return "turf";
  if (/^2[3-9]$/.test(code)) return "dirt";
  return null;
};

const normalizeCourse = (value) => {
  const normalized = String(value ?? "").normalize("NFKC").trim().toLowerCase().replace(/競馬場$/, "");
  const japanese = Object.entries(COURSE_NAMES).find(([, name]) => name === normalized);
  return japanese?.[0] ?? (Object.hasOwn(COURSE_NAMES, normalized) ? normalized : null);
};

const distanceBand = (distance) => {
  const value = Number(distance);
  if (!Number.isFinite(value) || value <= 0) return null;
  if (value <= 1400) return "sprint";
  if (value <= 1800) return "mile";
  if (value <= 2200) return "middle";
  return "long";
};

const fieldSizeBand = (fieldSize) => {
  const value = Number(fieldSize);
  if (!Number.isInteger(value) || value < 5) return null;
  if (value <= 9) return "small";
  if (value <= 13) return "medium";
  return "large";
};

const relativeGateZone = (horseNumber, fieldSize) => {
  const number = Number(horseNumber);
  const size = Number(fieldSize);
  if (!Number.isInteger(number) || !Number.isInteger(size) || number < 1 || size < 5 || number > size) return null;
  const relativePosition = (number - 0.5) / size;
  if (relativePosition <= 1 / 3) return "inner";
  if (relativePosition <= 2 / 3) return "middle";
  return "outer";
};

const contextKey = (levelId, value) => {
  const level = LEVEL_BY_ID.get(levelId);
  if (!level) return null;
  if (!level.fields.length) return "*";
  const parts = level.fields.map((field) => value?.[field]);
  return parts.every(Boolean) ? parts.join("|") : null;
};

const frameObservation = (race, horse) => {
  const fieldSize = Number(race?.fieldSize);
  const horseNumber = Number(horse?.horseNumber);
  const finishPosition = Number(horse?.finishPosition);
  const surface = normalizeSurface(race?.surface, race?.trackCode);
  const course = normalizeCourse(race?.course ?? race?.courseName);
  const distance = Number(race?.distance);
  const observation = {
    id: `${race?.key ?? race?.date ?? "unknown"}-${String(horseNumber).padStart(2, "0")}`,
    raceKey: race?.key ?? null,
    raceDate: race?.date ?? null,
    course,
    surface,
    distance,
    distanceBand: distanceBand(distance),
    fieldSize,
    fieldSizeBand: fieldSizeBand(fieldSize),
    horseNumber,
    zone: relativeGateZone(horseNumber, fieldSize),
    finishPosition,
    placed: Number.isInteger(finishPosition) && finishPosition >= 1 && finishPosition <= 3,
  };
  return /^\d{4}-\d{2}-\d{2}$/.test(observation.raceDate ?? "") && course && surface &&
    observation.distanceBand && observation.fieldSizeBand && observation.zone &&
    Number.isInteger(finishPosition) && finishPosition >= 1
    ? observation
    : null;
};

const extractFrameObservations = (history) => (history?.races ?? [])
  .flatMap((race) => (race.horses ?? []).map((horse) => frameObservation(race, horse)))
  .filter(Boolean)
  .sort((left, right) => left.raceDate.localeCompare(right.raceDate) || left.id.localeCompare(right.id));

const groupBy = (rows, keyFor) => {
  const groups = new Map();
  for (const row of rows) {
    const key = keyFor(row);
    if (key == null) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return groups;
};

const parentCellsFor = (levels, levelId, row, zone) => (PARENT_LEVELS[levelId] ?? [])
  .map((parentId) => levels[parentId]?.cells?.[contextKey(parentId, row)])
  .map((cell) => cell?.zones?.[zone] ? { cell, zone: cell.zones[zone] } : null)
  .filter(Boolean);

const parentEffect = (parents) => {
  if (!parents.length) return 0;
  const weighted = parents.reduce((total, parent) => {
    const weight = Math.max(1, Number(parent.zone.sampleSize ?? 0));
    return { sum: total.sum + Number(parent.zone.adjustedLift ?? 0) * weight, weight: total.weight + weight };
  }, { sum: 0, weight: 0 });
  return weighted.weight ? weighted.sum / weighted.weight : 0;
};

const buildFrameLevels = (observations, options) => {
  const levels = {};
  for (const level of FRAME_CONTEXT_LEVELS) {
    const cells = {};
    const groups = groupBy(observations, (row) => contextKey(level.id, row));
    for (const [key, rows] of [...groups.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      const placedCount = rows.filter((row) => row.placed).length;
      const baselineHitRate = rate(placedCount, rows.length);
      const zones = {};
      for (const zone of ["inner", "middle", "outer"]) {
        const matched = rows.filter((row) => row.zone === zone);
        if (!matched.length) continue;
        const zonePlacedCount = matched.filter((row) => row.placed).length;
        const parents = parentCellsFor(levels, level.id, rows[0], zone);
        const priorRate = clamp(baselineHitRate + parentEffect(parents), 0.03, 0.75);
        const priorWeight = Number(options.priorWeights[level.id]);
        const adjustedHitRate = (zonePlacedCount + priorRate * priorWeight) / (matched.length + priorWeight);
        zones[zone] = {
          sampleSize: matched.length,
          placedCount: zonePlacedCount,
          hitRate: round(rate(zonePlacedCount, matched.length)),
          priorRate: round(priorRate),
          priorWeight,
          adjustedHitRate: round(adjustedHitRate),
          adjustedLift: round(adjustedHitRate - baselineHitRate),
          reliability: round(matched.length / (matched.length + priorWeight)),
        };
      }
      cells[key] = {
        sampleSize: rows.length,
        placedCount,
        baselineHitRate: round(baselineHitRate),
        zones,
      };
    }
    levels[level.id] = {
      fields: level.fields,
      minimumSampleSize: Number(options.minimumSamples[level.id]),
      priorWeight: Number(options.priorWeights[level.id]),
      cells,
    };
  }
  return levels;
};

const resolveFrameAptitude = (model, value) => {
  const zone = value?.zone ?? relativeGateZone(value?.horseNumber, value?.fieldSize);
  if (!zone) return null;
  for (const levelId of LOOKUP_ORDER) {
    const key = contextKey(levelId, value);
    const level = model?.levels?.[levelId];
    const cell = key ? level?.cells?.[key] : null;
    const zoneStats = cell?.zones?.[zone];
    if (!zoneStats) continue;
    const minimumSampleSize = Number(level.minimumSampleSize ?? 0);
    if (levelId !== "global" && Number(zoneStats.sampleSize) < minimumSampleSize) continue;
    return { level: levelId, key, zone, minimumSampleSize, cell, zoneStats };
  }
  return null;
};

const splitRacesChronologically = (races, validationFraction) => {
  const sorted = [...(races ?? [])].filter((race) => /^\d{4}-\d{2}-\d{2}$/.test(race?.date ?? ""))
    .sort((left, right) => left.date.localeCompare(right.date) || String(left.key).localeCompare(String(right.key)));
  const dates = [...new Set(sorted.map((race) => race.date))];
  const validationDateCount = Math.max(1, Math.floor(dates.length * validationFraction));
  const validationDates = new Set(dates.slice(-validationDateCount));
  return {
    training: sorted.filter((race) => !validationDates.has(race.date)),
    validation: sorted.filter((race) => validationDates.has(race.date)),
    splitDate: dates.at(-validationDateCount) ?? null,
  };
};

const brier = (rows, key) => rows.length
  ? rows.reduce((total, row) => total + (Number(row[key]) - Number(row.placed)) ** 2, 0) / rows.length
  : null;

const validateFrameLearning = (races, options = DEFAULT_FRAME_LEARNING_OPTIONS) => {
  const split = splitRacesChronologically(races, options.validationFraction);
  const trainingObservations = extractFrameObservations({ races: split.training });
  const validationObservations = extractFrameObservations({ races: split.validation });
  const trainingModel = { levels: buildFrameLevels(trainingObservations, options) };
  const evaluated = validationObservations.map((row) => {
    const match = resolveFrameAptitude(trainingModel, row);
    if (!match) return null;
    return {
      ...row,
      level: match.level,
      baselinePrediction: match.cell.baselineHitRate,
      adjustedPrediction: match.zoneStats.adjustedHitRate,
      adjustedLift: match.zoneStats.adjustedLift,
    };
  }).filter(Boolean);
  const directional = (rows) => ({
    sampleSize: rows.length,
    placedCount: rows.filter((row) => row.placed).length,
    hitRate: rows.length ? round(rows.filter((row) => row.placed).length / rows.length) : null,
    meanExpectedRate: rows.length ? round(rows.reduce((sum, row) => sum + row.adjustedPrediction, 0) / rows.length) : null,
  });
  const byLevel = Object.fromEntries(LOOKUP_ORDER.map((level) => [level, evaluated.filter((row) => row.level === level).length]));
  return {
    splitDate: split.splitDate,
    trainingRaceCount: split.training.length,
    validationRaceCount: split.validation.length,
    trainingObservationCount: trainingObservations.length,
    validationObservationCount: validationObservations.length,
    evaluatedObservationCount: evaluated.length,
    coverage: validationObservations.length ? round(evaluated.length / validationObservations.length) : 0,
    baselineBrier: roundNullable(brier(evaluated, "baselinePrediction")),
    adjustedBrier: roundNullable(brier(evaluated, "adjustedPrediction")),
    positive: directional(evaluated.filter((row) => row.adjustedLift >= 0.01)),
    negative: directional(evaluated.filter((row) => row.adjustedLift <= -0.01)),
    byLevel,
  };
};

const buildFrameAptitudeModel = (history, suppliedOptions = {}) => {
  const options = {
    ...DEFAULT_FRAME_LEARNING_OPTIONS,
    ...suppliedOptions,
    minimumSamples: { ...DEFAULT_FRAME_LEARNING_OPTIONS.minimumSamples, ...(suppliedOptions.minimumSamples ?? {}) },
    priorWeights: { ...DEFAULT_FRAME_LEARNING_OPTIONS.priorWeights, ...(suppliedOptions.priorWeights ?? {}) },
  };
  const observations = extractFrameObservations(history);
  const dates = observations.map((row) => row.raceDate);
  const raceKeys = new Set(observations.map((row) => row.raceKey));
  const levels = buildFrameLevels(observations, options);
  return {
    schemaVersion: 1,
    modelVersion: "frame-aptitude-empirical-v2",
    status: "shadow-approved",
    productionConnected: false,
    period: { from: dates[0] ?? null, to: dates.at(-1) ?? null },
    source: history?.source ?? null,
    policy: {
      popularityOddsValueUsed: false,
      raceRunningPositionUsed: false,
      relativeHorseNumberUsed: true,
      bayesianShrinkageUsed: true,
      hierarchicalFallbackUsed: true,
      futureRaceJoinAllowed: false,
    },
    options,
    summary: {
      raceCount: raceKeys.size,
      observationCount: observations.length,
      placedCount: observations.filter((row) => row.placed).length,
      baselineHitRate: observations.length ? round(observations.filter((row) => row.placed).length / observations.length) : null,
      courseCount: new Set(observations.map((row) => row.course)).size,
      from: dates[0] ?? null,
      to: dates.at(-1) ?? null,
    },
    validation: validateFrameLearning(history?.races ?? [], options),
    levels,
  };
};

export {
  COURSE_NAMES,
  DEFAULT_FRAME_LEARNING_OPTIONS,
  FRAME_CONTEXT_LEVELS,
  LOOKUP_ORDER,
  buildFrameAptitudeModel,
  contextKey,
  distanceBand,
  extractFrameObservations,
  fieldSizeBand,
  frameObservation,
  normalizeCourse,
  normalizeSurface,
  relativeGateZone,
  resolveFrameAptitude,
  validateFrameLearning,
};
