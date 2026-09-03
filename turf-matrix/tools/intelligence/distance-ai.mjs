const clamp = (value, min = 35, max = 96) => Math.max(min, Math.min(max, Math.round(value)));

const finiteDistance = (value) => {
  const distance = Number(value);
  return Number.isFinite(distance) && distance > 0 ? distance : null;
};

const normalizeSurface = (value) => String(value ?? "").startsWith("ダ") ? "ダ" : String(value ?? "");

const finishQuality = (run) => {
  const field = Number(run?.fieldSize) || 16;
  const finish = Number(run?.finishPosition) || field;
  const finishScore = ((field - finish + 1) / field) * 100;
  const margin = run?.margin == null ? null : Number(run.margin);
  const marginScore = Number.isFinite(margin) ? 74 - margin * 18 : 60;
  return clamp(finishScore * 0.55 + marginScore * 0.45, 35, 96);
};

const distanceFit = (runDistance, targetDistance) => {
  const actual = finiteDistance(runDistance);
  const target = finiteDistance(targetDistance);
  if (!actual || !target) return 58;
  const gap = Math.abs(actual - target);
  if (gap <= 100) return 92;
  if (gap <= 200) return 84;
  if (gap <= 400) return 70;
  if (gap <= 600) return 58;
  return 46;
};

const distanceType = (distance) => {
  const value = finiteDistance(distance);
  if (!value) return { key: "unknown", label: "距離区分不明" };
  return value % 400 === 0
    ? { key: "core", label: "根幹距離" }
    : { key: "non_core", label: "非根幹距離" };
};

const lastPassingPosition = (run) => {
  const positions = (run?.passingOrder ?? []).map(Number).filter((value) => Number.isFinite(value) && value > 0);
  return positions.at(-1) ?? null;
};

const firstPassingPosition = (run) => {
  const positions = (run?.passingOrder ?? []).map(Number).filter((value) => Number.isFinite(value) && value > 0);
  return positions[0] ?? null;
};

const closingResilience = (run) => {
  const field = Number(run?.fieldSize) || 16;
  const finish = Number(run?.finishPosition);
  const lastPosition = lastPassingPosition(run);
  if (!Number.isFinite(finish) || !Number.isFinite(lastPosition)) return 60;
  const movement = (lastPosition - finish) / Math.max(1, field - 1);
  return clamp(60 + movement * 85, 35, 92);
};

const earlySpeed = (run) => {
  const field = Number(run?.fieldSize) || 16;
  const firstPosition = firstPassingPosition(run);
  if (!Number.isFinite(firstPosition)) return 60;
  const positionRate = (firstPosition - 1) / Math.max(1, field - 1);
  return clamp(88 - positionRate * 48, 40, 88);
};

const comparableRuns = (horse) => {
  const targetSurface = normalizeSurface(horse?.currentRace?.surface);
  const targetDate = Date.parse(horse?.currentRace?.raceDate ?? "");
  return (horse?.pastRuns ?? [])
    .filter((run) => finiteDistance(run?.distance))
    .filter((run) => !targetSurface || normalizeSurface(run?.surface) === targetSurface)
    .filter((run) => {
      const runDate = Date.parse(run?.date ?? "");
      return !Number.isFinite(targetDate) || !Number.isFinite(runDate) || runDate < targetDate;
    })
    .slice(0, 12);
};

const bayesianScore = (entries, prior, priorWeight) => {
  const usable = entries.filter((entry) => Number.isFinite(entry.score) && entry.weight > 0);
  const totalWeight = usable.reduce((sum, entry) => sum + entry.weight, 0);
  if (!totalWeight) return null;
  const total = usable.reduce((sum, entry) => sum + entry.score * entry.weight, prior * priorWeight);
  return clamp(total / (totalWeight + priorWeight));
};

const dateValue = (value) => {
  const parsed = Date.parse(String(value ?? "").trim().replace(/[./]/g, "-"));
  return Number.isFinite(parsed) ? parsed : null;
};

const chronologicalRuns = (runs) => {
  const dated = runs.map((run, index) => ({ run, index, date: dateValue(run?.date) }));
  if (dated.every((entry) => entry.date != null)) {
    return dated.sort((left, right) => left.date - right.date).map((entry) => entry.run);
  }
  return [...runs].reverse();
};

const buildTransitionProfile = (horse, runs = comparableRuns(horse)) => {
  const target = finiteDistance(horse?.currentRace?.distance);
  const latestDistance = finiteDistance(runs[0]?.distance);
  if (!target || !latestDistance || target === latestDistance) {
    return { status: "not_applicable", score: null, adjustment: 0, sampleCount: 0, transitions: [] };
  }

  const requestedChange = target - latestDistance;
  const direction = Math.sign(requestedChange);
  const ordered = chronologicalRuns(runs);
  const transitions = [];
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    const previousDistance = finiteDistance(previous?.distance);
    const currentDistance = finiteDistance(current?.distance);
    if (!previousDistance || !currentDistance) continue;
    const change = currentDistance - previousDistance;
    if (!change || Math.sign(change) !== direction) continue;
    if (Math.abs(currentDistance - target) > 600) continue;

    const magnitudeGap = Math.abs(Math.abs(change) - Math.abs(requestedChange));
    const magnitudeWeight = magnitudeGap <= 100 ? 1 : magnitudeGap <= 200 ? 0.82 : magnitudeGap <= 400 ? 0.58 : 0.4;
    const before = finishQuality(previous);
    const after = finishQuality(current);
    const responseSupport = direction > 0 ? closingResilience(current) : earlySpeed(current);
    const responseScore = clamp(62 + (after - before) * 0.55 + (responseSupport - 60) * 0.18);
    transitions.push({
      from: previousDistance,
      to: currentDistance,
      change,
      before,
      after,
      responseScore,
      weight: magnitudeWeight,
      date: current.date ?? null,
    });
  }

  const recent = transitions.slice(-5).reverse();
  const entries = recent.map((transition, index) => ({
    score: transition.responseScore,
    weight: transition.weight * Math.max(0.68, 1 - index * 0.09),
  }));
  const score = bayesianScore(entries, 62, 3);
  const adjustment = score == null ? 0 : Math.max(-3, Math.min(3, Math.round((score - 62) * 0.22)));
  return {
    status: recent.length >= 2 ? "active" : recent.length ? "limited" : "missing",
    score,
    adjustment,
    sampleCount: recent.length,
    transitions: recent,
  };
};

const directionLabel = (direction, adjustment) => {
  const action = direction === "extension" ? "延長" : "短縮";
  if (adjustment >= 3) return `${action}への強い好材料`;
  if (adjustment >= 1) return `${action}への好材料あり`;
  if (adjustment <= -3) return `${action}には明確な注意材料`;
  if (adjustment <= -1) return `${action}には注意材料あり`;
  return `${action}対応は中立`;
};

const buildDirectionProfile = (horse, runs = comparableRuns(horse)) => {
  const target = finiteDistance(horse?.currentRace?.distance);
  const latest = runs.find((run) => finiteDistance(run?.distance));
  const latestDistance = finiteDistance(latest?.distance);
  if (!target || !latestDistance) {
    return { key: "unknown", label: "距離変更材料は限定的", score: null, adjustment: 0, sampleCount: 0 };
  }

  const change = target - latestDistance;
  if (change === 0) {
    return {
      key: "same",
      label: "前走と同距離",
      score: finishQuality(latest),
      adjustment: 0,
      sampleCount: 1,
      latestDistance,
      change,
    };
  }

  const direction = change > 0 ? "extension" : "shortening";
  const entries = runs.flatMap((run, index) => {
    const runDistance = finiteDistance(run?.distance);
    const gap = runDistance ? Math.abs(runDistance - target) : Infinity;
    if (!runDistance || gap > 400) return [];
    const quality = finishQuality(run);
    const directEvidence = direction === "extension" ? runDistance >= target : runDistance <= target;
    const projection = direction === "extension"
      ? quality * 0.65 + closingResilience(run) * 0.35
      : quality * 0.7 + earlySpeed(run) * 0.3;
    const score = directEvidence ? quality * 0.85 + projection * 0.15 : projection;
    const proximityWeight = distanceFit(runDistance, target) / 92;
    const evidenceWeight = directEvidence ? 1.1 : 0.85;
    const recencyWeight = index === 0 ? 1.15 : Math.max(0.7, 1 - index * 0.04);
    return [{ score, weight: proximityWeight * evidenceWeight * recencyWeight }];
  });
  const projectedScore = bayesianScore(entries, 62, 2.5);
  const transition = buildTransitionProfile(horse, runs);
  const score = projectedScore == null
    ? transition.score
    : transition.score == null
      ? projectedScore
      : clamp(projectedScore * 0.65 + transition.score * 0.35);
  const adjustment = score == null ? 0 : Math.max(-5, Math.min(5, Math.round((score - 62) * 0.3)));

  return {
    key: direction,
    label: directionLabel(direction, adjustment),
    score,
    adjustment,
    sampleCount: entries.length,
    latestDistance,
    change,
    projectedScore,
    transition,
  };
};

const buildCadenceProfile = (horse, runs = comparableRuns(horse)) => {
  const target = finiteDistance(horse?.currentRace?.distance);
  const type = distanceType(target);
  if (!target || type.key === "unknown") {
    return { ...type, score: null, adjustment: 0, sampleCount: 0 };
  }

  const entries = runs.flatMap((run, index) => {
    const runDistance = finiteDistance(run?.distance);
    if (!runDistance || distanceType(runDistance).key !== type.key || Math.abs(runDistance - target) > 800) return [];
    const proximityWeight = Math.max(0.35, distanceFit(runDistance, target) / 92);
    const recencyWeight = index === 0 ? 1.1 : Math.max(0.72, 1 - index * 0.035);
    return [{ score: finishQuality(run), weight: proximityWeight * recencyWeight }];
  });
  const score = bayesianScore(entries, 60, 3);
  const adjustment = score == null ? 0 : Math.max(-3, Math.min(3, Math.round((score - 60) * 0.22)));
  const assessment = adjustment >= 2
    ? `${type.label}で好走材料あり`
    : adjustment <= -2 ? `${type.label}では注意材料あり` : `${type.label}適性は中立`;

  return {
    ...type,
    assessment,
    score,
    adjustment,
    sampleCount: entries.length,
  };
};

const buildDistanceProfile = (horse) => {
  const target = finiteDistance(horse?.currentRace?.distance);
  const runs = comparableRuns(horse);
  if (!target) {
    return {
      score: 58,
      baseScore: 58,
      target: null,
      relevantRunCount: runs.length,
      direction: buildDirectionProfile(horse, runs),
      cadence: buildCadenceProfile(horse, runs),
    };
  }
  const proximityEntries = runs.map((run, index) => {
    const fit = distanceFit(run.distance, target);
    return {
      score: finishQuality(run) * 0.65 + fit * 0.35,
      weight: (fit / 92) * Math.max(0.65, 1 - index * 0.05),
    };
  });
  const baseScore = bayesianScore(proximityEntries, 60, 2.5) ?? 58;
  const direction = buildDirectionProfile(horse, runs);
  const cadence = buildCadenceProfile(horse, runs);
  const score = clamp(baseScore + direction.adjustment + cadence.adjustment);

  return {
    score,
    baseScore,
    target,
    relevantRunCount: runs.length,
    direction,
    cadence,
  };
};

export {
  buildCadenceProfile,
  buildDirectionProfile,
  buildDistanceProfile,
  buildTransitionProfile,
  closingResilience,
  distanceFit,
  distanceType,
  earlySpeed,
  finishQuality,
};
