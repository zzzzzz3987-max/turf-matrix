const DEFAULT_OPERATION_LEARNING_OPTIONS = Object.freeze({
  minimumStableSampleSize: 40,
  minimumComparableSampleSize: 20,
  minimumPatternSampleSize: 12,
  minimumPatternPlacedCount: 3,
  minimumPatternNonPlacedCount: 5,
  minimumAdjustedLift: 0.03,
  minimumTrainingLift: 0.04,
  globalPriorWeight: 30,
  patternPriorWeight: 20,
  validationFraction: 0.3,
  minimumValidationMatches: 5,
  minimumValidationLift: 0.02,
});

const OPERATION_FIELDS = Object.freeze(["rotationBucket", "jockeyContinuity", "travelClass"]);
const PAIR_FIELDS = Object.freeze([
  ["rotationBucket", "jockeyContinuity"],
  ["rotationBucket", "travelClass"],
  ["jockeyContinuity", "travelClass"],
]);

const ROTATION_LABELS = Object.freeze({
  "0-7": "前走から7日以内",
  "8-20": "前走から8〜20日",
  "21-42": "前走から21〜42日",
  "43-90": "前走から43〜90日",
  "91+": "前走から91日以上",
});

const finite = (value) => value !== null && value !== "" && Number.isFinite(Number(value));
const present = (value) => value !== null && value !== undefined && value !== "";
const round = (value, digits = 4) => Number(Number(value).toFixed(digits));
const rate = (rows) => rows.length ? rows.filter((row) => row.placed === true).length / rows.length : null;
const shrunkRate = (successes, sampleSize, priorRate, priorWeight) => sampleSize && finite(priorRate)
  ? (successes + Number(priorRate) * priorWeight) / (sampleSize + priorWeight)
  : null;

const fieldsForPattern = (pattern) => OPERATION_FIELDS.filter((field) => Object.hasOwn(pattern, field));

const matchesOperationPattern = (observation, pattern) => fieldsForPattern(pattern)
  .every((field) => observation?.[field] === pattern[field]);

const comparableForPattern = (observation, pattern) => fieldsForPattern(pattern)
  .every((field) => present(observation?.[field]));

const evaluateOperationPattern = (observations, pattern, globalBaseline, options = DEFAULT_OPERATION_LEARNING_OPTIONS) => {
  const comparable = observations.filter((row) => comparableForPattern(row, pattern));
  const matched = comparable.filter((row) => matchesOperationPattern(row, pattern));
  const comparablePlacedCount = comparable.filter((row) => row.placed === true).length;
  const placedCount = matched.filter((row) => row.placed === true).length;
  const baselineRate = shrunkRate(
    comparablePlacedCount,
    comparable.length,
    globalBaseline,
    options.globalPriorWeight
  );
  const adjustedHitRate = shrunkRate(
    placedCount,
    matched.length,
    baselineRate,
    options.patternPriorWeight
  );
  return {
    comparableSampleSize: comparable.length,
    comparablePlacedCount,
    baselineHitRate: finite(baselineRate) ? round(baselineRate) : null,
    sampleSize: matched.length,
    placedCount,
    nonPlacedCount: matched.length - placedCount,
    hitRate: finite(rate(matched)) ? round(rate(matched)) : null,
    adjustedHitRate: finite(adjustedHitRate) ? round(adjustedHitRate) : null,
    adjustedLift: finite(adjustedHitRate) && finite(baselineRate) ? round(adjustedHitRate - baselineRate) : null,
  };
};

const splitChronologically = (observations, validationFraction) => {
  const sorted = [...observations].sort((left, right) =>
    String(left.raceDate ?? "").localeCompare(String(right.raceDate ?? "")) ||
    String(left.id ?? "").localeCompare(String(right.id ?? ""))
  );
  const validationSize = Math.max(1, Math.floor(sorted.length * validationFraction));
  const splitAt = Math.max(1, sorted.length - validationSize);
  return { training: sorted.slice(0, splitAt), validation: sorted.slice(splitAt) };
};

const operationCandidates = (training) => {
  const candidates = [];
  const seen = new Set();
  const add = (pattern) => {
    const key = JSON.stringify(pattern);
    if (!seen.has(key)) {
      seen.add(key);
      candidates.push(pattern);
    }
  };
  for (const field of OPERATION_FIELDS) {
    const values = [...new Set(training.map((row) => row[field]).filter(present))]
      .sort((left, right) => String(left).localeCompare(String(right)));
    for (const value of values) add({ [field]: value });
  }
  for (const fields of PAIR_FIELDS) {
    const values = new Map();
    for (const row of training) {
      if (!fields.every((field) => present(row[field]))) continue;
      const pattern = Object.fromEntries(fields.map((field) => [field, row[field]]));
      values.set(JSON.stringify(pattern), pattern);
    }
    for (const key of [...values.keys()].sort()) add(values.get(key));
  }
  return candidates;
};

const patternPhrase = (pattern) => {
  const labels = [];
  if (pattern.rotationBucket) labels.push(ROTATION_LABELS[pattern.rotationBucket] ?? pattern.rotationBucket);
  if (typeof pattern.jockeyContinuity === "boolean") labels.push(pattern.jockeyContinuity ? "前走騎手が継続" : "騎手乗り替わり");
  if (pattern.travelClass) labels.push(pattern.travelClass === "home" ? "所属圏内" : "遠征");
  return labels.join(" × ");
};

const qualifiesPositive = (all, training, validation, options) =>
  all.comparableSampleSize >= options.minimumComparableSampleSize &&
  all.sampleSize >= options.minimumPatternSampleSize &&
  all.placedCount >= options.minimumPatternPlacedCount &&
  all.adjustedLift >= options.minimumAdjustedLift &&
  training.adjustedLift >= options.minimumTrainingLift &&
  validation.sampleSize >= options.minimumValidationMatches &&
  validation.adjustedLift >= options.minimumValidationLift;

const qualifiesRisk = (all, training, validation, options) =>
  all.comparableSampleSize >= options.minimumComparableSampleSize &&
  all.sampleSize >= options.minimumPatternSampleSize &&
  all.nonPlacedCount >= options.minimumPatternNonPlacedCount &&
  all.adjustedLift <= -options.minimumAdjustedLift &&
  training.adjustedLift <= -options.minimumTrainingLift &&
  validation.sampleSize >= options.minimumValidationMatches &&
  validation.adjustedLift <= -options.minimumValidationLift;

const evaluatedCandidates = (observations, split, globalBaseline, options) => operationCandidates(split.training)
  .map((pattern) => ({
    pattern,
    phrase: patternPhrase(pattern),
    all: evaluateOperationPattern(observations, pattern, globalBaseline, options),
    training: evaluateOperationPattern(split.training, pattern, globalBaseline, options),
    validation: evaluateOperationPattern(split.validation, pattern, globalBaseline, options),
  }));

const selectPattern = (evaluated, direction, options) => {
  const positive = direction === "positive";
  const ranked = [...evaluated].sort((left, right) => {
    const leftLift = Number(left.training.adjustedLift ?? (positive ? -Infinity : Infinity));
    const rightLift = Number(right.training.adjustedLift ?? (positive ? -Infinity : Infinity));
    return (positive ? rightLift - leftLift : leftLift - rightLift) ||
      right.training.sampleSize - left.training.sampleSize ||
      JSON.stringify(left.pattern).localeCompare(JSON.stringify(right.pattern));
  });
  const selected = ranked[0] ?? null;
  if (!selected) return null;
  const accepted = positive
    ? qualifiesPositive(selected.all, selected.training, selected.validation, options)
    : qualifiesRisk(selected.all, selected.training, selected.validation, options);
  return { ...selected, accepted, direction };
};

const publicPattern = (selected, options) => selected ? {
  accepted: selected.accepted,
  direction: selected.direction,
  pattern: selected.pattern,
  phrase: selected.phrase,
  sampleSize: selected.all.sampleSize,
  placedCount: selected.all.placedCount,
  hitRate: selected.all.hitRate,
  adjustedHitRate: selected.all.adjustedHitRate,
  baselineHitRate: selected.all.baselineHitRate,
  adjustedLift: selected.all.adjustedLift,
  training: selected.training,
  validation: {
    ...selected.validation,
    status: selected.validation.sampleSize < options.minimumValidationMatches
      ? "insufficient_sample"
      : selected.accepted ? "passed" : "failed",
  },
} : null;

const trainerModel = (name, observations, globalBaseline, options) => {
  const split = splitChronologically(observations, options.validationFraction);
  const evaluated = evaluatedCandidates(observations, split, globalBaseline, options);
  const stableEligible = observations.length >= options.minimumStableSampleSize;
  const selectedPositive = selectPattern(evaluated, "positive", options);
  const selectedRisk = selectPattern(evaluated, "risk", options);
  const positive = selectedPositive ? { ...selectedPositive, accepted: stableEligible && selectedPositive.accepted } : null;
  const risk = selectedRisk ? { ...selectedRisk, accepted: stableEligible && selectedRisk.accepted } : null;
  const dates = observations.map((row) => String(row.raceDate ?? "")).filter(Boolean).sort();
  const accepted = positive?.accepted === true || risk?.accepted === true;
  const acceptedSamples = [positive, risk].filter((value) => value?.accepted).map((value) => value.all.sampleSize);
  return {
    name,
    trainingCenter: observations.find((row) => row.trainingCenter)?.trainingCenter ?? null,
    sampleSize: observations.length,
    placedCount: observations.filter((row) => row.placed === true).length,
    hitRate: round(rate(observations)),
    period: { from: dates[0] ?? null, to: dates.at(-1) ?? null },
    accepted,
    positivePattern: publicPattern(positive, options),
    riskPattern: publicPattern(risk, options),
    confidence: accepted && observations.length >= 80 && Math.max(...acceptedSamples, 0) >= 20
      ? "high"
      : accepted ? "mid" : "low",
    candidateCount: evaluated.length,
  };
};

const learnStableOperationPatterns = (observations, providedOptions = {}) => {
  const options = { ...DEFAULT_OPERATION_LEARNING_OPTIONS, ...providedOptions };
  const eligible = observations.filter((row) => row?.trainer && finite(row.finish) && row.finish > 0);
  const globalBaseline = rate(eligible);
  const byTrainer = new Map();
  for (const observation of eligible) {
    const trainer = String(observation.trainer).trim();
    const rows = byTrainer.get(trainer) ?? [];
    rows.push(observation);
    byTrainer.set(trainer, rows);
  }
  const diagnostics = [...byTrainer]
    .map(([name, rows]) => trainerModel(name, rows, globalBaseline, options))
    .sort((left, right) => right.sampleSize - left.sampleSize || left.name.localeCompare(right.name, "ja"));
  const candidates = diagnostics.filter((model) => model.sampleSize >= options.minimumStableSampleSize);
  const stables = candidates.filter((model) => model.accepted);
  return {
    options,
    globalBaseline: round(globalBaseline),
    diagnostics,
    candidates,
    stables,
  };
};

export {
  DEFAULT_OPERATION_LEARNING_OPTIONS,
  evaluateOperationPattern,
  learnStableOperationPatterns,
  matchesOperationPattern,
  operationCandidates,
  patternPhrase,
};
