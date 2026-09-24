import { isLocalRun, splitRunsByOrigin } from "./race-origin.mjs";

const abilityNumber = (value) => value == null || typeof value === "boolean" || String(value).trim() === ""
  ? null : Number.isFinite(Number(value)) ? Number(value) : null;
const validFinish = (value) => Number.isInteger(abilityNumber(value)) && abilityNumber(value) > 0;

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
  if (isLocalRun(run)) return -1;
  const text = `${run.grade ?? ""} ${run.raceName ?? ""} ${run.className ?? ""}`.normalize("NFKC");
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
  const margin = abilityNumber(run.margin);
  if (!Number.isFinite(margin)) return 58;
  return clamp(78 - margin * 20, 38, 94);
};

const closingQuality = (run) => {
  if (run.closingBenchmark?.status === "available" && run.closingBenchmark.policy === "closing-context-v1" &&
      Number.isFinite(run.closingBenchmark.score)) return clamp(run.closingBenchmark.score, 42, 96);
  const last3F = Number(run.last3F);
  if (!Number.isFinite(last3F) || last3F <= 0 || last3F >= 45) return null;
  return clamp(90 - (last3F - 33.5) * 7, 42, 94);
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
  const classScore = tier < 0 ? 38 : [56, 66, 76, 84, 90][tier];
  const closing = closingQuality(run);
  const distance = distanceQuality(run, targetDistance);
  return clamp(weightedAverage([
    { value: finishQuality(run), weight: 0.32 },
    { value: marginQuality(run), weight: 0.22 },
    { value: classScore, weight: 0.2 },
    { value: closing, weight: closing == null ? 0 : 0.12 },
    { value: distance, weight: distance == null ? 0 : 0.06 },
  ]));
};

const recentAbility = (runs, targetDistance) => {
  const weights = [1, 0.9, 0.82, 0.75, 0.69, 0.64, 0.6, 0.56, 0.52, 0.48, 0.44, 0.4];
  return clamp(weightedAverage(
    runs.slice(0, weights.length).map((run, index) => ({
      value: runAbility(run, targetDistance),
      weight: weights[index] * (isLocalRun(run) ? 0.2 : 1),
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
  const relevant = peerRuns.filter((run) => validFinish(run.finishPosition) &&
    (run.peers ?? []).some((peer) => validFinish(peer.finishPosition)));
  if (!relevant.length) return null;
  return clamp(weightedAverage(relevant.map((run, index) => {
    const peers = (run.peers ?? []).filter((peer) => validFinish(peer.finishPosition));
    const finish = Number(run.finishPosition);
    const beaten = peers.filter((peer) => finish < Number(peer.finishPosition)).length;
    const lostTo = peers.filter((peer) => finish > Number(peer.finishPosition)).length;
    return { value: clamp(62 + beaten * 7 - lostTo * 5), weight: Math.max(0.65, 1 - index * 0.1) };
  })));
};

const encounterDetails = (opponentEvidence) => {
  const encounters = opponentEvidence?.encounters ?? [];
  if (!encounters.length) return [];
  const scored = encounters.flatMap((encounter) => {
    const finish = Number(encounter.finishPosition);
    return (encounter.peers ?? []).map((peer) => {
      const peerFinish = Number(peer.finishPosition);
      if (!validFinish(encounter.finishPosition) || !validFinish(peer.finishPosition)) return null;
      const fallbackRelationScore = finish < peerFinish
        ? 78
        : finish === peerFinish
          ? 65
          : peerFinish - finish >= -2
            ? 58
            : 46;
      const evidenceScore = abilityNumber(peer.evidenceScore);
      const qualityScore = abilityNumber(peer.qualityScore ?? peer.score);
      const relationScore = Number.isFinite(evidenceScore)
        ? evidenceScore
        : Number.isFinite(qualityScore)
          ? qualityScore * 0.45 + fallbackRelationScore * 0.55
          : fallbackRelationScore;
      return {
        raceKey: encounter.raceKey ?? null,
        raceDate: encounter.raceDate ?? null,
        raceName: encounter.raceName ?? null,
        horseName: peer.horseName ?? null,
        finishPosition: finish,
        peerFinishPosition: peerFinish,
        relation: finish < peerFinish ? "beat" : finish === peerFinish ? "tied" : "lost",
        source: Number.isFinite(evidenceScore) ? "evidence-score" : Number.isFinite(qualityScore) ? "quality-and-result" : "result-only",
        laterStarts: abilityNumber(peer.laterStarts),
        value: relationScore,
        weight: Number(peer.laterStarts) >= 3 ? 1.1 : Number(peer.laterStarts) > 0 ? 1 : 0.72,
      };
    });
  }).filter(Boolean);
  return scored;
};

const trendQuality = (runs, targetDistance) => {
  if (runs.length < 2) return null;
  const recent = runs.slice(0, 2).map((run) => runAbility(run, targetDistance));
  const older = runs.slice(2, 5).map((run) => runAbility(run, targetDistance));
  if (!older.length) return clamp(recent[0] + (recent[0] - recent[1]) * 0.35, 42, 92);
  return clamp(65 + (weightedAverage(recent.map((value) => ({ value, weight: 1 }))) -
    weightedAverage(older.map((value) => ({ value, weight: 1 })))) * 0.9, 42, 92);
};

const confidenceForRuns = (runCount, hasZi, centralRunCount = runCount, localRunCount = 0) => {
  if (!localRunCount && hasZi && runCount >= 4) return "high";
  if (centralRunCount >= 6) return "high";
  if (centralRunCount >= 2) return "mid";
  return "low";
};

export const selectAbilityRuns = (horse) => (horse.pastRuns ?? [])
    .filter((run) => validFinish(run.finishPosition))
    .slice(0, 12);

const calculateAbilityProfile = (horse, { includeDistanceFit = true, sparseOpponentShrinkage = process.env.TURF_MATRIX_CONTEXT_PREVIEW === "1" } = {}) => {
  const runs = selectAbilityRuns(horse);
  const { central: centralRuns, local: localRuns } = splitRunsByOrigin(runs);
  const comparableRuns = centralRuns.length ? centralRuns : runs;
  const targetDistance = includeDistanceFit ? Number(horse.currentRace?.distance) : NaN;
  const zi = abilityNumber(resolveAbilityZi(horse));
  const ziScore = Number.isFinite(zi) ? clamp(42 + (zi - 80) * 1.3) : null;
  const recentScore = runs.length ? recentAbility(runs, targetDistance) : 50;
  const opponentScore = opponentQuality(runs);
  const peerScore = peerQuality(horse.peerRuns ?? []);
  const encounters = encounterDetails(horse.opponentEvidence);
  const encounterScore = encounters.length ? clamp(weightedAverage(encounters)) : null;
  const careerOpponentScore = Number.isFinite(horse.opponentEvidence?.score)
    ? clamp(horse.opponentEvidence.score)
    : null;
  const relationComponents = [
    { key: "class-performance", value: opponentScore, weight: opponentScore == null ? 0 : 0.25 },
    { key: "direct-peers", value: peerScore, weight: peerScore == null ? 0 : 0.15 },
    { key: "encounters", value: encounterScore, weight: encounterScore == null ? 0 : 0.25 },
    { key: "opponent-careers", value: careerOpponentScore, weight: careerOpponentScore == null ? 0 : 0.35 },
  ];
  const relationScore = weightedAverage(relationComponents, recentScore);
  // Repeated views of the same sparsely tracked peers are not independent evidence.
  const trackedPeers = new Map();
  for (const encounter of horse.opponentEvidence?.encounters ?? []) {
    for (const peer of encounter.peers ?? []) {
      const key = peer.bloodRegistrationNumber ?? peer.horseName;
      if (key) trackedPeers.set(key, Math.max(trackedPeers.get(key) ?? 0, abilityNumber(peer.laterStarts) ?? 0));
    }
  }
  const followUpStarts = trackedPeers.size
    ? [...trackedPeers.values()].reduce((sum, n) => sum + Math.max(0, n), 0)
    : Math.max(0, abilityNumber(horse.opponentEvidence?.profiledPeerCount) ?? 0);
  const relationReliability = opponentScore != null || peerScore != null
    ? 1 : followUpStarts / (followUpStarts + 3);
  const effectiveRelationScore = sparseOpponentShrinkage
    ? recentScore + (relationScore - recentScore) * relationReliability : relationScore;
  const relationWeight = relationComponents.reduce((sum, item) => sum + item.weight, 0);
  const encounterWeight = encounters.reduce((sum, item) => sum + item.weight, 0);
  const distanceScore = includeDistanceFit && comparableRuns.length
    ? clamp(weightedAverage(comparableRuns.slice(0, 5).map((run, index) => ({
        value: distanceQuality(run, targetDistance),
        weight: Math.max(0.7, 1 - index * 0.08),
      })), 58))
    : null;
  const marginScore = comparableRuns.length ? clamp(weightedAverage(comparableRuns.slice(0, 5).map((run, index) => ({
    value: marginQuality(run),
    weight: Math.max(0.7, 1 - index * 0.08),
  })))) : null;
  const closingScore = comparableRuns.some((run) => closingQuality(run) != null)
    ? clamp(weightedAverage(comparableRuns.slice(0, 5).map((run, index) => ({
        value: closingQuality(run),
        weight: Math.max(0.7, 1 - index * 0.08),
      }))))
    : null;
  const trendScore = trendQuality(comparableRuns, targetDistance);

  const scoreInputs = ziScore == null
    ? [
        { key: "recent", label: "近走能力", value: recentScore, weight: 0.46 },
        { key: "relations", label: "相手関係", value: effectiveRelationScore, weight: 0.27 },
        { key: "trend", label: "能力推移", value: trendScore, weight: trendScore == null ? 0 : 0.12 },
        { key: "margin", label: "着差", value: marginScore, weight: marginScore == null ? 0 : 0.08 },
        { key: "closing", label: "上がり", value: closingScore, weight: closingScore == null ? 0 : 0.07 },
      ]
    : [
        { key: "zi", label: "ZI", value: ziScore, weight: 0.38 },
        { key: "recent", label: "近走能力", value: recentScore, weight: 0.27 },
        { key: "relations", label: "相手関係", value: effectiveRelationScore, weight: 0.18 },
        { key: "trend", label: "能力推移", value: trendScore, weight: trendScore == null ? 0 : 0.07 },
        { key: "margin", label: "着差", value: marginScore, weight: marginScore == null ? 0 : 0.05 },
        { key: "closing", label: "上がり", value: closingScore, weight: closingScore == null ? 0 : 0.05 },
      ];
  const validScoreInputs = scoreInputs.filter((item) => Number.isFinite(item.value) && item.weight > 0);
  const scoreWeight = validScoreInputs.reduce((sum, item) => sum + item.weight, 0);
  const scoreBeforeClamp = weightedAverage(validScoreInputs, 50);
  const score = clamp(scoreBeforeClamp);

  return {
    score,
    calculation: {
      components: validScoreInputs.map((item) => ({
        key: item.key,
        label: item.label,
        score: item.value,
        share: scoreWeight ? item.weight / scoreWeight : 0,
        contribution: scoreWeight ? item.value * item.weight / scoreWeight : 0,
      })),
      beforeClamp: scoreBeforeClamp,
      finalScore: score,
      ziIncluded: ziScore != null,
    },
    confidence: confidenceForRuns(runs.length, ziScore != null, centralRuns.length, localRuns.length),
    runCount: runs.length,
    centralRunCount: centralRuns.length,
    localRunCount: localRuns.length,
    zi,
    ziScore,
    recentScore,
    opponentScore,
    peerScore,
    encounterScore,
    careerOpponentScore,
    relationScore: clamp(relationScore),
    effectiveRelationScore,
    relationReliability,
    relationEvidence: {
      scope: "relation-score",
      fallback: relationWeight ? null : "recent-ability",
      rawScore: relationScore,
      components: relationComponents.map((item) => ({ ...item,
        share: relationWeight ? item.weight / relationWeight : 0,
        contribution: relationWeight && item.weight ? item.value * item.weight / relationWeight : 0,
      })),
      encounters: encounters.map((item) => ({ ...item, share: item.weight / encounterWeight })),
      independentEvidenceSources: false,
    },
    distanceScore,
    marginScore,
    closingScore,
    closingBenchmarks: runs.map((run) => ({ date: run.date, ...run.closingBenchmark })).filter((row) => row.status),
    trendScore,
  };
};

export { abilityNumber, calculateAbilityProfile, resolveAbilityZi };
