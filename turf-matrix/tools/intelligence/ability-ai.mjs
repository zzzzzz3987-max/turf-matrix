const clamp = (value, min = 35, max = 96) => Math.max(min, Math.min(max, Math.round(value)));

const weightedAverage = (items, fallback = 60) => {
  const valid = items.filter((item) => Number.isFinite(item.value) && Number.isFinite(item.weight) && item.weight > 0);
  if (!valid.length) return fallback;
  const weight = valid.reduce((sum, item) => sum + item.weight, 0);
  return valid.reduce((sum, item) => sum + item.value * item.weight, 0) / weight;
};

const resolveAbilityZi = (horse) =>
  horse.availableIndex ?? horse.pedigree?.zi ?? horse.odds?.zi ?? horse.currentRace?.zi;

const classTier = (run) => {
  const text = `${run.grade ?? ""} ${run.raceName ?? ""} ${run.className ?? ""}`;
  if (/G1|GI(?!I)/i.test(text)) return 4;
  if (/G2|GII(?!I)/i.test(text)) return 3;
  if (/G3|GIII/i.test(text)) return 2;
  if (/\(L\)|\bL\b|Listed|OP|オープン/i.test(text)) return 1;
  return 0;
};

const finishQuality = (run) => {
  const fieldSize = Number(run.fieldSize) || 16;
  const finish = Number(run.finishPosition);
  if (!Number.isFinite(finish) || finish <= 0) return 50;
  return clamp(100 * (fieldSize - finish + 1) / fieldSize, 35, 96);
};

const marginQuality = (run) => {
  const margin = Number(run.margin);
  if (!Number.isFinite(margin)) return 58;
  return clamp(78 - margin * 20, 38, 94);
};

const closingQuality = (run) => {
  const last3F = Number(run.last3F);
  if (!Number.isFinite(last3F) || last3F <= 0 || last3F >= 45) return null;
  return clamp(90 - (last3F - 33.5) * 7, 42, 94);
};

const marketOutperformance = (run) => {
  const popularity = Number(run.popularity);
  const finish = Number(run.finishPosition);
  if (!Number.isFinite(popularity) || !Number.isFinite(finish) || popularity <= 0 || finish <= 0) return 60;
  return clamp(60 + (popularity - finish) * 3, 42, 88);
};

const distanceQuality = (run, targetDistance) => {
  const distance = Number(run.distance);
  if (!Number.isFinite(distance) || !Number.isFinite(targetDistance)) return null;
  const gap = Math.abs(distance - targetDistance);
  if (gap <= 100) return 86;
  if (gap <= 200) return 80;
  if (gap <= 400) return 66;
  if (gap <= 600) return 54;
  return 44;
};

const runAbility = (run, targetDistance) => {
  const tier = classTier(run);
  const classScore = [56, 66, 76, 84, 90][tier];
  const closing = closingQuality(run);
  const distance = distanceQuality(run, targetDistance);
  return clamp(weightedAverage([
    { value: finishQuality(run), weight: 0.32 },
    { value: marginQuality(run), weight: 0.22 },
    { value: classScore, weight: 0.2 },
    { value: closing, weight: closing == null ? 0 : 0.12 },
    { value: marketOutperformance(run), weight: 0.08 },
    { value: distance, weight: distance == null ? 0 : 0.06 },
  ]));
};

const recentAbility = (runs, targetDistance) => {
  const weights = [1, 0.9, 0.82, 0.75, 0.69, 0.64, 0.6, 0.56];
  return clamp(weightedAverage(
    runs.slice(0, weights.length).map((run, index) => ({
      value: runAbility(run, targetDistance),
      weight: weights[index],
    })),
    50,
  ));
};

const opponentQuality = (runs) => {
  const relevant = runs.filter((run) => classTier(run) > 0).slice(0, 8);
  if (!relevant.length) return null;
  return clamp(weightedAverage(relevant.map((run, index) => ({
    value: clamp(58 + classTier(run) * 7 + (finishQuality(run) - 60) * 0.3),
    weight: 1 - index * 0.07,
  }))));
};

const peerQuality = (peerRuns = []) => {
  if (!peerRuns.length) return null;
  return clamp(weightedAverage(peerRuns.map((run, index) => {
    const peers = run.peers ?? [];
    const finish = Number(run.finishPosition);
    const beaten = peers.filter((peer) => Number.isFinite(finish) && Number.isFinite(peer.finishPosition) && finish < peer.finishPosition).length;
    const lostTo = peers.filter((peer) => Number.isFinite(finish) && Number.isFinite(peer.finishPosition) && finish > peer.finishPosition).length;
    return { value: clamp(62 + beaten * 7 - lostTo * 5), weight: Math.max(0.65, 1 - index * 0.1) };
  })));
};

const encounterQuality = (opponentEvidence) => {
  const encounters = opponentEvidence?.encounters ?? [];
  if (!encounters.length) return null;
  const scored = encounters.flatMap((encounter) => {
    const finish = Number(encounter.finishPosition);
    return (encounter.peers ?? []).map((peer) => {
      const peerFinish = Number(peer.finishPosition);
      if (!Number.isFinite(finish) || !Number.isFinite(peerFinish)) return null;
      const relationScore = finish < peerFinish
        ? 78
        : finish === peerFinish
          ? 65
          : peerFinish - finish >= -2
            ? 58
            : 46;
      return {
        value: relationScore,
        weight: Number(peer.laterStarts) > 0 ? 1 : 0.75,
      };
    });
  }).filter(Boolean);
  return scored.length ? clamp(weightedAverage(scored)) : null;
};

const trendQuality = (runs, targetDistance) => {
  if (runs.length < 2) return null;
  const recent = runs.slice(0, 2).map((run) => runAbility(run, targetDistance));
  const older = runs.slice(2, 5).map((run) => runAbility(run, targetDistance));
  if (!older.length) return clamp(recent[0] + (recent[0] - recent[1]) * 0.35, 42, 92);
  return clamp(65 + (weightedAverage(recent.map((value) => ({ value, weight: 1 }))) -
    weightedAverage(older.map((value) => ({ value, weight: 1 })))) * 0.9, 42, 92);
};

const confidenceForRuns = (runCount, hasZi) => {
  if (hasZi && runCount >= 4) return "high";
  if (runCount >= 6) return "high";
  if (runCount >= 2) return "mid";
  return "low";
};

const calculateAbilityProfile = (horse) => {
  const runs = (horse.pastRuns ?? []).filter((run) => Number.isFinite(Number(run.finishPosition))).slice(0, 8);
  const targetDistance = Number(horse.currentRace?.distance);
  const zi = Number(resolveAbilityZi(horse));
  const ziScore = Number.isFinite(zi) ? clamp(42 + (zi - 80) * 1.3) : null;
  const recentScore = runs.length ? recentAbility(runs, targetDistance) : 50;
  const opponentScore = opponentQuality(runs);
  const peerScore = peerQuality(horse.peerRuns ?? []);
  const encounterScore = encounterQuality(horse.opponentEvidence);
  const careerOpponentScore = Number.isFinite(horse.opponentEvidence?.score)
    ? clamp(horse.opponentEvidence.score)
    : null;
  const relationScore = weightedAverage([
    { value: opponentScore, weight: opponentScore == null ? 0 : 0.25 },
    { value: peerScore, weight: peerScore == null ? 0 : 0.15 },
    { value: encounterScore, weight: encounterScore == null ? 0 : 0.25 },
    { value: careerOpponentScore, weight: careerOpponentScore == null ? 0 : 0.35 },
  ], recentScore);
  const distanceScore = runs.length
    ? clamp(weightedAverage(runs.slice(0, 5).map((run, index) => ({
        value: distanceQuality(run, targetDistance),
        weight: Math.max(0.7, 1 - index * 0.08),
      })), 58))
    : null;
  const marginScore = runs.length ? clamp(weightedAverage(runs.slice(0, 5).map((run, index) => ({
    value: marginQuality(run),
    weight: Math.max(0.7, 1 - index * 0.08),
  })))) : null;
  const closingScore = runs.some((run) => closingQuality(run) != null)
    ? clamp(weightedAverage(runs.slice(0, 5).map((run, index) => ({
        value: closingQuality(run),
        weight: Math.max(0.7, 1 - index * 0.08),
      }))))
    : null;
  const trendScore = trendQuality(runs, targetDistance);

  const score = ziScore == null
    ? clamp(weightedAverage([
        { value: recentScore, weight: 0.46 },
        { value: relationScore, weight: 0.27 },
        { value: trendScore, weight: trendScore == null ? 0 : 0.12 },
        { value: marginScore, weight: marginScore == null ? 0 : 0.08 },
        { value: closingScore, weight: closingScore == null ? 0 : 0.07 },
      ], 50))
    : clamp(weightedAverage([
        { value: ziScore, weight: 0.38 },
        { value: recentScore, weight: 0.27 },
        { value: relationScore, weight: 0.18 },
        { value: trendScore, weight: trendScore == null ? 0 : 0.07 },
        { value: marginScore, weight: marginScore == null ? 0 : 0.05 },
        { value: closingScore, weight: closingScore == null ? 0 : 0.05 },
      ]));

  return {
    score,
    confidence: confidenceForRuns(runs.length, ziScore != null),
    runCount: runs.length,
    zi,
    ziScore,
    recentScore,
    opponentScore,
    peerScore,
    encounterScore,
    careerOpponentScore,
    relationScore: clamp(relationScore),
    distanceScore,
    marginScore,
    closingScore,
    trendScore,
  };
};

export { calculateAbilityProfile, resolveAbilityZi };
