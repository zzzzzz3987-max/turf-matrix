import { detectPedigreeCrosses, pedigreeFeatureEntries } from "./blood-features.mjs";
import { resolvePedigreeLineIds } from "./bloodline-resolver.mjs";

const DEFAULT_PRIOR_SAMPLE_SIZE = 24;
const MAX_PAIRING_ADJUSTMENT = 1.5;
const MAX_CROSS_ADJUSTMENT = 0.5;
const MAX_TOTAL_ADJUSTMENT = 2;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const round4 = (value) => Number(Number(value).toFixed(4));
const normalizeName = (value) => String(value ?? "")
  .normalize("NFKC")
  .toLowerCase()
  .replace(/\s+/g, "")
  .trim();
const normalizeAncestorName = (value) => normalizeName(value)
  .replace(/[＊*$]/g, "")
  .replace(/[.'’\-]/g, "");
const pairKey = (...values) => values.every(Boolean) ? values.map(normalizeName).join("::") : "";
const crossKey = (ancestor, pattern) => ancestor && pattern
  ? `${normalizeAncestorName(ancestor)}::${normalizeName(pattern)}`
  : "";

const distanceBand = (distance) => {
  const value = Number(distance);
  if (!Number.isFinite(value)) return "unknown";
  if (value <= 1400) return "sprint";
  if (value <= 1800) return "mile";
  if (value <= 2200) return "middle";
  return "long";
};

const leaveOneHorseOut = (statistic, horseName, minimumSamples = {}) => {
  if (!statistic) return null;
  const contribution = statistic.horseContributions?.[normalizeName(horseName)];
  if (!contribution) return statistic;
  const sampleSize = Math.max(0, statistic.sampleSize - contribution.sampleSize);
  const uniqueHorseCount = Math.max(0, statistic.uniqueHorseCount - 1);
  const wins = statistic.wins - contribution.wins;
  const top3 = statistic.top3 - contribution.top3;
  const finishTotal = statistic.avgFinish * statistic.sampleSize - contribution.finishTotal;
  const eligible = sampleSize >= (minimumSamples.active ?? 12)
    && uniqueHorseCount >= (minimumSamples.uniqueHorsesActive ?? 5);
  const highConfidence = sampleSize >= (minimumSamples.high ?? 30)
    && uniqueHorseCount >= (minimumSamples.uniqueHorsesHigh ?? 10);
  return {
    ...statistic,
    sampleSize,
    uniqueHorseCount,
    wins,
    top3,
    winRate: sampleSize ? round4(wins / sampleSize) : null,
    hitRate: sampleSize ? round4(top3 / sampleSize) : null,
    avgFinish: sampleSize ? Number((finishTotal / sampleSize).toFixed(2)) : null,
    eligible,
    confidence: highConfidence ? "high" : eligible ? "mid" : "low",
    excludedHorse: horseName,
  };
};

const shrinkHitRate = (statistic, baseline, priorSampleSize = DEFAULT_PRIOR_SAMPLE_SIZE) => {
  if (!Number.isFinite(baseline) || !Number.isFinite(statistic?.top3) || !Number.isFinite(statistic?.sampleSize)) {
    return statistic?.hitRate ?? null;
  }
  return (statistic.top3 + baseline * priorSampleSize) / (statistic.sampleSize + priorSampleSize);
};

const scopeCandidates = ({ entity, race, horseName, minimumSamples }) => {
  const course = race?.course ?? race?.track ?? race?.venue ?? "unknown";
  const surface = race?.surface ?? "unknown";
  const going = race?.trackCondition ?? race?.going ?? "unknown";
  const band = distanceBand(race?.distance);
  return [
    {
      scope: "今回コース・距離帯",
      weight: 1,
      statistic: leaveOneHorseOut(entity?.courseSurfaceDistance?.[`${course}|${surface}|${band}`], horseName, minimumSamples),
    },
    {
      scope: "今回コース・馬場",
      weight: 0.85,
      statistic: leaveOneHorseOut(entity?.courseSurfaceGoing?.[`${course}|${surface}|${going}`], horseName, minimumSamples),
    },
    {
      scope: "同馬場・距離帯",
      weight: 0.75,
      statistic: leaveOneHorseOut(entity?.surfaceDistance?.[`${surface}|${band}`], horseName, minimumSamples),
    },
    {
      scope: "保有データ全体",
      weight: 0.45,
      statistic: leaveOneHorseOut(entity?.overall?.all, horseName, minimumSamples),
    },
  ];
};

const selectEntityStatistic = ({ statistics, entityType, key, race, horseName }) => {
  if (!key) return { status: "unavailable", entityType, key, candidates: [] };
  const entity = statistics?.entities?.[entityType]?.[key];
  if (!entity) return { status: "unavailable", entityType, key, candidates: [] };
  const candidates = scopeCandidates({
    entity,
    race,
    horseName,
    minimumSamples: statistics.minimumSamples,
  });
  const selected = candidates.find((candidate) => candidate.statistic?.eligible);
  if (selected) return { status: "active", entityType, key, ...selected, candidates };
  const reference = candidates.find((candidate) =>
    candidate.statistic?.sampleSize >= (statistics.minimumSamples?.reference ?? 5)
  );
  return {
    status: reference ? "insufficient_sample" : "unavailable",
    entityType,
    key,
    reference: reference ?? null,
    candidates,
  };
};

const adjustmentFor = ({ selection, baseline, levelWeight = 1, maxAdjustment }) => {
  if (selection?.status !== "active") return 0;
  const shrunkHitRate = shrinkHitRate(selection.statistic, baseline);
  const lift = Number.isFinite(shrunkHitRate) && Number.isFinite(baseline) ? shrunkHitRate - baseline : 0;
  return clamp(round4(lift * 18 * selection.weight * levelWeight), -maxAdjustment, maxAdjustment);
};

const pairingLevelsFor = (pedigree) => {
  const sire = pedigree?.sire;
  const broodmareSire = pedigree?.broodmareSire;
  const resolvedLines = resolvePedigreeLineIds(pedigree);
  const sireLine = resolvedLines.sireLine;
  const broodmareSireLine = resolvedLines.broodmareSireLine;
  return [
    {
      entityType: "sireBroodmareSire",
      label: `${sire ?? "-"} × ${broodmareSire ?? "-"}`,
      key: pairKey(sire, broodmareSire),
      fallbackLevel: "父×母父",
      levelWeight: 1,
    },
    {
      entityType: "sireBroodmareSireLineId",
      label: `${sire ?? "-"} × ${broodmareSireLine?.label ?? "系統不明"}`,
      key: pairKey(sire, broodmareSireLine?.id),
      fallbackLevel: "父×母父系",
      levelWeight: 0.85,
    },
    {
      entityType: "sireLineIdBroodmareSire",
      label: `${sireLine?.label ?? "系統不明"} × ${broodmareSire ?? "-"}`,
      key: pairKey(sireLine?.id, broodmareSire),
      fallbackLevel: "父系×母父",
      levelWeight: 0.8,
    },
    {
      entityType: "sireLineIdBroodmareSireLineId",
      label: `${sireLine?.label ?? "系統不明"} × ${broodmareSireLine?.label ?? "系統不明"}`,
      key: pairKey(sireLine?.id, broodmareSireLine?.id),
      fallbackLevel: "父系×母父系",
      levelWeight: 0.7,
    },
  ];
};

const buildPairingCrossShadow = ({ horse, statistics }) => {
  const pedigree = horse?.pedigree ?? {};
  const race = horse?.currentRace ?? {};
  const horseName = horse?.name ?? horse?.horseName ?? race.horseName;
  const baseline = statistics?.baseline?.hitRate;
  const pairingAttempts = pairingLevelsFor(pedigree).map((level) => ({
    ...level,
    selection: selectEntityStatistic({
      statistics,
      entityType: level.entityType,
      key: level.key,
      race,
      horseName,
    }),
  }));
  const pairing = pairingAttempts.find((attempt) => attempt.selection.status === "active") ?? null;
  const pairingReference = pairingAttempts.find((attempt) => attempt.selection.reference) ?? null;
  const pairingAdjustment = adjustmentFor({
    selection: pairing?.selection,
    baseline,
    levelWeight: pairing?.levelWeight,
    maxAdjustment: MAX_PAIRING_ADJUSTMENT,
  });

  const crosses = detectPedigreeCrosses(pedigreeFeatureEntries({ pedigree }));
  const crossAttempts = crosses.map((cross) => {
    const selection = selectEntityStatistic({
      statistics,
      entityType: "cross",
      key: crossKey(cross.ancestor, cross.pattern),
      race,
      horseName,
    });
    return { ...cross, key: crossKey(cross.ancestor, cross.pattern), selection };
  });
  const activeCrosses = crossAttempts.filter((cross) => cross.selection.status === "active");
  const crossAdjustments = activeCrosses.map((cross) => adjustmentFor({
    selection: cross.selection,
    baseline,
    levelWeight: 1,
    maxAdjustment: MAX_CROSS_ADJUSTMENT,
  }));
  const crossAdjustment = crossAdjustments.length
    ? clamp(round4(crossAdjustments.reduce((sum, value) => sum + value, 0) / crossAdjustments.length), -MAX_CROSS_ADJUSTMENT, MAX_CROSS_ADJUSTMENT)
    : 0;
  const adjustment = clamp(round4(pairingAdjustment + crossAdjustment), -MAX_TOTAL_ADJUSTMENT, MAX_TOTAL_ADJUSTMENT);

  return {
    status: pairing || activeCrosses.length ? "active" : pairingReference || crossAttempts.some((cross) => cross.selection.reference) ? "reference_only" : "unavailable",
    adjustment,
    pairingAdjustment,
    crossAdjustment,
    pairing,
    pairingReference,
    pairingAttempts,
    crosses: crossAttempts,
    activeCrosses,
    baselineHitRate: baseline ?? null,
    priorSampleSize: DEFAULT_PRIOR_SAMPLE_SIZE,
    limits: {
      pairing: MAX_PAIRING_ADJUSTMENT,
      cross: MAX_CROSS_ADJUSTMENT,
      total: MAX_TOTAL_ADJUSTMENT,
    },
  };
};

const selectedReferenceStatistic = (selection) => {
  if (selection?.status === "active" && selection.statistic) {
    return { status: "active", scope: selection.scope, statistic: selection.statistic };
  }
  if (selection?.reference?.statistic) {
    return {
      status: "reference_only",
      scope: selection.reference.scope,
      statistic: selection.reference.statistic,
    };
  }
  return null;
};

const referenceMetric = ({ attempt, baseline, statistics, type }) => {
  const selected = selectedReferenceStatistic(attempt?.selection);
  if (!selected) return null;
  const shrunkHitRate = shrinkHitRate(selected.statistic, baseline);
  return {
    type,
    label: attempt.label,
    fallbackLevel: attempt.fallbackLevel ?? null,
    status: selected.status,
    scope: selected.scope,
    sampleSize: selected.statistic.sampleSize,
    uniqueHorseCount: selected.statistic.uniqueHorseCount,
    winRate: selected.statistic.winRate,
    hitRate: selected.statistic.hitRate,
    shrunkHitRate: Number.isFinite(shrunkHitRate) ? round4(shrunkHitRate) : null,
    baselineHitRate: Number.isFinite(baseline) ? round4(baseline) : null,
    confidence: selected.statistic.confidence ?? "low",
    evaluationCutoff: statistics?.evaluationCutoff ?? null,
    scoreApplied: false,
    sourceType: "approved_pairing_reference",
  };
};

const buildPairingCrossReference = ({ horse, statistics }) => {
  const assessment = buildPairingCrossShadow({ horse, statistics });
  const selectedPairing = assessment.pairing ?? assessment.pairingReference;
  const pairing = referenceMetric({
    attempt: selectedPairing,
    baseline: assessment.baselineHitRate,
    statistics,
    type: "pairingReference",
  });
  const crosses = assessment.crosses
    .map((cross) => referenceMetric({
      attempt: {
        ...cross,
        label: `${cross.ancestor} ${cross.pattern}`,
      },
      baseline: assessment.baselineHitRate,
      statistics,
      type: "crossReference",
    }))
    .filter(Boolean);

  return {
    version: "blood-pairing-reference-v1",
    status: pairing || crosses.length ? "reference_only" : "unavailable",
    scoreApplied: false,
    pairing,
    crosses,
    evaluationCutoff: statistics?.evaluationCutoff ?? null,
  };
};

export {
  MAX_TOTAL_ADJUSTMENT,
  buildPairingCrossReference,
  buildPairingCrossShadow,
  crossKey,
  distanceBand,
  leaveOneHorseOut,
  normalizeName,
  pairKey,
  shrinkHitRate,
};
