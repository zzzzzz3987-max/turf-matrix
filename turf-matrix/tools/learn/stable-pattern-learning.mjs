const DEFAULT_LEARNING_OPTIONS = Object.freeze({
  minimumStableSampleSize: 20,
  minimumPatternSampleSize: 8,
  minimumPatternPlacedCount: 3,
  minimumAdjustedLift: 0.05,
  priorWeight: 12,
  validationFraction: 0.25,
  minimumValidationMatches: 6,
  minimumValidationLift: 0.02,
});

const PHASE_LABELS = Object.freeze({
  oneWeek: "一週前",
  final: "最終",
});

const finite = (value) => value !== null && value !== "" && Number.isFinite(Number(value));
const normalizeKey = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, "").trim();
const round = (value, digits = 4) => Number(Number(value).toFixed(digits));

const trainingPhaseSnapshot = (representative) => {
  if (!representative) return null;
  const laps = [representative.lap?.lap4, representative.lap?.lap3, representative.lap?.lap2, representative.lap?.lap1]
    .filter((value) => typeof value === "number" && Number.isFinite(value));
  return {
    type: representative.type,
    course: representative.type === "wood" ? representative.course ?? "wood" : "slope",
    time4F: representative.f4,
    last1F: representative.f1,
    accel: laps.length >= 2 ? laps.at(-1) <= laps.at(-2) : null,
  };
};

const percentile = (values, ratio) => {
  const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))];
};

const hitRate = (observations) => {
  if (!observations.length) return null;
  return observations.filter((item) => item.placed).length / observations.length;
};

const shrunkRate = (placedCount, sampleSize, baselineRate, priorWeight) => {
  if (!sampleSize || !finite(baselineRate)) return null;
  return (placedCount + baselineRate * priorWeight) / (sampleSize + priorWeight);
};

const courseOf = (phase) => normalizeKey(phase?.course ?? (phase?.type === "wood" ? "wood" : "slope"));

const matchesPattern = (observation, pattern) => {
  const phase = observation.phases?.[pattern.phase];
  if (!phase) return false;
  if (pattern.course?.length && !pattern.course.some((expected) => courseOf(phase).includes(normalizeKey(expected)))) return false;
  if (finite(pattern.time4FMax) && (!finite(phase.time4F) || Number(phase.time4F) > Number(pattern.time4FMax))) return false;
  if (finite(pattern.last1FMax) && (!finite(phase.last1F) || Number(phase.last1F) > Number(pattern.last1FMax))) return false;
  if (typeof pattern.accel === "boolean" && phase.accel !== pattern.accel) return false;
  if (finite(pattern.minCount) && Number(observation.count ?? 0) < Number(pattern.minCount)) return false;
  return true;
};

const evaluatePattern = (observations, pattern, baselineRate, priorWeight) => {
  const matched = observations.filter((item) => matchesPattern(item, pattern));
  const placedCount = matched.filter((item) => item.placed).length;
  const rawRate = hitRate(matched);
  const adjustedRate = shrunkRate(placedCount, matched.length, baselineRate, priorWeight);
  return {
    sampleSize: matched.length,
    placedCount,
    hitRate: finite(rawRate) ? round(rawRate) : null,
    adjustedHitRate: finite(adjustedRate) ? round(adjustedRate) : null,
    adjustedLift: finite(adjustedRate) ? round(adjustedRate - baselineRate) : null,
  };
};

const patternPhrase = (pattern) => {
  const course = pattern.course?.[0];
  const courseLabel = course === "slope" ? "坂路" : course && course !== "wood" ? `ウッド${course}` : "ウッド";
  const pieces = [`${PHASE_LABELS[pattern.phase] ?? pattern.phase}${courseLabel}`];
  if (finite(pattern.time4FMax)) pieces.push(`4F${Number(pattern.time4FMax).toFixed(1)}以内`);
  if (finite(pattern.last1FMax)) pieces.push(`1F${Number(pattern.last1FMax).toFixed(1)}以内`);
  if (pattern.accel === true) pieces.push("加速");
  if (finite(pattern.minCount)) pieces.push(`${pattern.minCount}本以上`);
  return `${pieces.join("・")}の好走時パターン`;
};

const splitChronologically = (observations, validationFraction) => {
  const sorted = [...observations].sort((a, b) =>
    String(a.raceDate ?? "").localeCompare(String(b.raceDate ?? "")) || String(a.id ?? "").localeCompare(String(b.id ?? ""))
  );
  const validationSize = Math.max(1, Math.floor(sorted.length * validationFraction));
  return {
    training: sorted.slice(0, Math.max(1, sorted.length - validationSize)),
    validation: sorted.slice(Math.max(1, sorted.length - validationSize)),
  };
};

const candidatePatterns = (training) => {
  const patterns = [];
  const seen = new Set();
  for (const phaseName of Object.keys(PHASE_LABELS)) {
    const placed = training.filter((item) => item.placed && item.phases?.[phaseName]);
    const courses = [...new Set(placed.map((item) => courseOf(item.phases[phaseName])).filter(Boolean))];
    for (const course of courses) {
      const source = placed.filter((item) => courseOf(item.phases[phaseName]) === course);
      const accelerations = source.map((item) => item.phases[phaseName]?.accel).filter((value) => typeof value === "boolean");
      const featureValues = {
        phase: phaseName,
        course: [course],
        time4FMax: percentile(source.map((item) => item.phases[phaseName]?.time4F), 0.65),
        last1FMax: percentile(source.map((item) => item.phases[phaseName]?.last1F), 0.65),
        accel: accelerations.length && accelerations.filter(Boolean).length / accelerations.length >= 0.6 ? true : null,
        minCount: Math.max(1, Math.round(percentile(source.map((item) => item.count), 0.35) ?? 1)),
      };
      const variants = [
        ["time4FMax"],
        ["last1FMax"],
        ["accel"],
        ["time4FMax", "last1FMax"],
        ["time4FMax", "accel"],
        ["last1FMax", "accel"],
        ["time4FMax", "last1FMax", "accel"],
        ["minCount"],
        ["last1FMax", "minCount"],
      ];
      for (const features of variants) {
        const pattern = { phase: phaseName, course: [course] };
        for (const feature of features) {
          const value = featureValues[feature];
          if (finite(value) || typeof value === "boolean") pattern[feature] = value;
        }
        if (Object.keys(pattern).length <= 2) continue;
        const key = JSON.stringify(pattern);
        if (seen.has(key)) continue;
        seen.add(key);
        patterns.push(pattern);
      }
    }
  }
  return patterns;
};

const rejectionReasons = (metrics, validation, options) => {
  const reasons = [];
  if (metrics.sampleSize < options.minimumPatternSampleSize) reasons.push("pattern_sample_below_minimum");
  if (metrics.placedCount < options.minimumPatternPlacedCount) reasons.push("pattern_placed_below_minimum");
  if (!finite(metrics.adjustedLift) || metrics.adjustedLift < options.minimumAdjustedLift) reasons.push("adjusted_lift_below_minimum");
  if (validation.sampleSize < options.minimumValidationMatches) reasons.push("validation_sample_below_minimum");
  else if (!finite(validation.adjustedLift) || validation.adjustedLift < options.minimumValidationLift) reasons.push("validation_lift_below_minimum");
  return reasons;
};

const stableCandidate = (name, observations, options) => {
  const stableBaseline = hitRate(observations);
  const split = splitChronologically(observations, options.validationFraction);
  const trainingBaseline = hitRate(split.training);
  const validationBaseline = hitRate(split.validation);
  const patterns = candidatePatterns(split.training).map((pattern) => {
    const allMetrics = evaluatePattern(observations, pattern, stableBaseline, options.priorWeight);
    const trainingMetrics = evaluatePattern(split.training, pattern, trainingBaseline, options.priorWeight);
    const validationMetrics = evaluatePattern(split.validation, pattern, validationBaseline, options.priorWeight);
    const reasons = rejectionReasons(allMetrics, validationMetrics, options);
    return {
      pattern,
      all: allMetrics,
      training: trainingMetrics,
      validation: validationMetrics,
      accepted: reasons.length === 0,
      rejectionReasons: reasons,
      trainingQualified:
        trainingMetrics.sampleSize >= Math.max(4, options.minimumPatternSampleSize - 2) &&
        trainingMetrics.placedCount >= Math.max(2, options.minimumPatternPlacedCount - 1) &&
        finite(trainingMetrics.adjustedLift) &&
        trainingMetrics.adjustedLift >= options.minimumAdjustedLift,
    };
  });
  patterns.sort((a, b) =>
    Number(b.trainingQualified) - Number(a.trainingQualified) ||
    Number(b.training.adjustedLift ?? -Infinity) - Number(a.training.adjustedLift ?? -Infinity) ||
    b.training.sampleSize - a.training.sampleSize ||
    String(a.pattern.phase).localeCompare(String(b.pattern.phase))
  );
  const best = patterns[0] ?? null;
  const accepted = best?.accepted === true;
  const trainingCenter = observations.find((item) => item.trainingCenter)?.trainingCenter ?? null;
  const raceDates = observations.map((item) => String(item.raceDate ?? "")).filter(Boolean).sort();
  return {
    name,
    trainingCenter,
    sampleSize: observations.length,
    placedCount: observations.filter((item) => item.placed).length,
    baselineHitRate: round(stableBaseline),
    period: {
      from: raceDates[0] ?? null,
      to: raceDates.at(-1) ?? null,
    },
    accepted,
    winningPattern: best?.pattern ?? null,
    signaturePhrase: best ? patternPhrase(best.pattern) : null,
    matchSampleSize: best?.all.sampleSize ?? 0,
    matchPlacedCount: best?.all.placedCount ?? 0,
    hitRate: best?.all.hitRate ?? null,
    adjustedHitRate: best?.all.adjustedHitRate ?? null,
    adjustedLift: best?.all.adjustedLift ?? null,
    validation: best ? {
      sampleSize: best.validation.sampleSize,
      placedCount: best.validation.placedCount,
      hitRate: best.validation.hitRate,
      adjustedHitRate: best.validation.adjustedHitRate,
      adjustedLift: best.validation.adjustedLift,
      status: best.validation.sampleSize < options.minimumValidationMatches
        ? "insufficient_sample"
        : best.validation.adjustedLift >= options.minimumValidationLift ? "passed" : "failed",
    } : null,
    rejectionReasons: best?.rejectionReasons ?? ["no_viable_pattern"],
    source: "learned",
    confidence: accepted && observations.length >= 50 && (best?.all.sampleSize ?? 0) >= 15 ? "high" : accepted ? "mid" : "low",
    candidateCount: patterns.length,
  };
};

const learnStablePatterns = (observations, providedOptions = {}) => {
  const options = { ...DEFAULT_LEARNING_OPTIONS, ...providedOptions };
  const byTrainer = new Map();
  for (const observation of observations) {
    const trainer = String(observation.trainer ?? "").trim();
    if (!trainer || !observation.phases || !Object.keys(observation.phases).length) continue;
    if (!byTrainer.has(trainer)) byTrainer.set(trainer, []);
    byTrainer.get(trainer).push(observation);
  }
  const diagnostics = [...byTrainer]
    .map(([name, values]) => stableCandidate(name, values, options))
    .sort((a, b) => b.sampleSize - a.sampleSize || a.name.localeCompare(b.name, "ja"));
  const candidates = diagnostics.filter((stable) => stable.sampleSize >= options.minimumStableSampleSize);
  const stables = candidates.filter((stable) => stable.accepted);
  return { options, diagnostics, candidates, stables };
};

export {
  DEFAULT_LEARNING_OPTIONS,
  evaluatePattern,
  learnStablePatterns,
  matchesPattern,
  percentile,
  trainingPhaseSnapshot,
};
