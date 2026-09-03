const SCORE_MIN = 35;
const SCORE_MAX = 96;
const NEUTRAL_SCORE = 50;
const MAX_ENCOUNTERS = 8;
const RECENCY_WEIGHTS = [1, 0.92, 0.85, 0.79, 0.74, 0.69, 0.65, 0.61];

const clamp = (value, min = SCORE_MIN, max = SCORE_MAX) => Math.max(min, Math.min(max, value));
const round1 = (value) => Math.round(value * 10) / 10;
const normalizeDate = (value) => String(value ?? "").replace(/[^0-9]/g, "").slice(0, 8);
const toNumber = (value) => Number.isFinite(Number(value)) ? Number(value) : null;

const horseIdOf = (run) => String(
  run?.bloodRegistrationNumber ?? run?.horseId ?? run?.registrationNumber ?? "",
);

const raceDateOf = (run, race = null) => normalizeDate(
  run?.raceDate ?? run?.date ?? race?.raceDate ?? race?.date ?? run?.raceKey?.slice(0, 8),
);

const finishPercentile = (finishPosition, fieldSize) => {
  const finish = toNumber(finishPosition);
  const size = toNumber(fieldSize);
  if (finish == null || size == null || finish <= 0 || size <= 1) return null;
  return clamp((size - Math.min(finish, size)) / (size - 1) * 100, 0, 100);
};

const gradeTier = (race = {}) => {
  const code = String(race.gradeCode ?? "").toUpperCase();
  if (["A", "F"].includes(code)) return 4;
  if (["B", "G"].includes(code)) return 3;
  if (["C", "H"].includes(code)) return 2;
  if (code === "L") return 1;
  const text = `${race.grade ?? ""} ${race.raceName ?? ""} ${race.raceNameShort10 ?? ""}`;
  if (/G1|GI(?!I)/i.test(text)) return 4;
  if (/G2|GII(?!I)/i.test(text)) return 3;
  if (/G3|GIII/i.test(text)) return 2;
  if (/\(L\)|Listed|\bL\b|OP|オープン/i.test(text)) return 1;
  return 0;
};

const classBaseline = (race = {}) => {
  const tier = gradeTier(race);
  if (tier === 4) return 88;
  if (tier === 3) return 82;
  if (tier === 2) return 76;
  if (tier === 1) return 70;
  if (String(race.gradeCode ?? "").toUpperCase() === "E") return 60;
  if (/特別|ステークス|カップ|賞$/u.test(String(race.raceName ?? race.raceNameShort10 ?? ""))) return 60;
  return 54;
};

const laterRunQuality = (run, raceByKey) => {
  const race = raceByKey.get(run.raceKey) ?? {};
  const percentile = finishPercentile(run.finishPosition, race.fieldSize ?? run.fieldSize);
  if (percentile == null) return null;
  const tier = gradeTier(race);
  const finish = toNumber(run.finishPosition);
  const achievement = finish === 1
    ? 3 + tier * 1.5
    : finish <= 3 && tier >= 2
      ? tier * 1.5
      : finish <= 3 && tier === 1
        ? 1.5
        : 0;
  return clamp(percentile + achievement, 20, 94);
};

const profilePeer = ({ peer, encounterDate, evaluationDate, runsByHorse, raceByKey }) => {
  const laterRuns = (runsByHorse.get(horseIdOf(peer)) ?? []).filter((run) => {
    const date = raceDateOf(run, raceByKey.get(run.raceKey));
    return date > encounterDate && date < evaluationDate;
  });
  const qualities = laterRuns.map((run) => laterRunQuality(run, raceByKey)).filter(Number.isFinite);
  if (!qualities.length) return {
    horseId: horseIdOf(peer),
    horseName: peer.horseName ?? null,
    finishPosition: toNumber(peer.finishPosition),
    laterStarts: 0,
    score: null,
  };
  const raw = qualities.reduce((sum, value) => sum + value, 0) / qualities.length;
  const shrink = qualities.length / (qualities.length + 4);
  return {
    horseId: horseIdOf(peer),
    horseName: peer.horseName ?? null,
    finishPosition: toNumber(peer.finishPosition),
    laterStarts: qualities.length,
    score: round1(NEUTRAL_SCORE + (raw - NEUTRAL_SCORE) * shrink),
  };
};

const targetPerformanceAdjustment = (targetRun, fieldSize) => {
  const percentile = finishPercentile(targetRun.finishPosition, fieldSize);
  const finishAdjustment = percentile == null ? 0 : (percentile - 50) * 0.12;
  const finish = toNumber(targetRun.finishPosition);
  const margin = toNumber(targetRun.margin);
  let marginAdjustment = 0;
  if (finish === 1) marginAdjustment = 4;
  else if (margin != null && margin <= 0.2) marginAdjustment = 4;
  else if (margin != null && margin <= 0.5) marginAdjustment = 2.5;
  else if (margin != null && margin > 2) marginAdjustment = -6;
  else if (margin != null && margin > 1) marginAdjustment = -3;
  return round1(clamp(finishAdjustment + marginAdjustment, -10, 10));
};

const evaluateEncounter = ({ targetRun, field, runsByHorse, raceByKey, evaluationDate }) => {
  const race = raceByKey.get(targetRun.raceKey) ?? targetRun;
  const encounterDate = raceDateOf(targetRun, race);
  const peers = (field ?? []).filter((peer) => horseIdOf(peer) !== horseIdOf(targetRun));
  const peerProfiles = peers.map((peer) => profilePeer({
    peer,
    encounterDate,
    evaluationDate,
    runsByHorse,
    raceByKey,
  }));
  const profiled = peerProfiles.filter((peer) => Number.isFinite(peer.score));
  const peerMean = profiled.length
    ? profiled.reduce((sum, peer) => sum + peer.score, 0) / profiled.length
    : NEUTRAL_SCORE;
  const coverageShrink = profiled.length / (profiled.length + 6);
  const fieldDevelopment = NEUTRAL_SCORE + (peerMean - NEUTRAL_SCORE) * coverageShrink;
  const base = classBaseline(race);
  const raceLevel = clamp(base + (fieldDevelopment - NEUTRAL_SCORE) * 0.55);
  const performanceAdjustment = targetPerformanceAdjustment(
    targetRun,
    race.fieldSize ?? targetRun.fieldSize ?? field?.length,
  );
  return {
    raceKey: targetRun.raceKey,
    raceDate: encounterDate,
    raceName: race.raceNameShort10 ?? race.raceName ?? targetRun.raceName ?? null,
    finishPosition: toNumber(targetRun.finishPosition),
    margin: toNumber(targetRun.margin),
    classBaseline: base,
    fieldDevelopment: round1(fieldDevelopment),
    raceLevel: round1(raceLevel),
    performanceAdjustment,
    score: round1(clamp(raceLevel + performanceAdjustment)),
    peerCount: peers.length,
    profiledPeerCount: profiled.length,
    coverage: peers.length ? round1(profiled.length / peers.length) : 0,
    peers: peerProfiles,
  };
};

const calculateOpponentRaceLevel = ({
  horseId,
  targetRuns = [],
  fieldsByRace = new Map(),
  runsByHorse = new Map(),
  raceByKey = new Map(),
  evaluationDate,
}) => {
  const cutoff = normalizeDate(evaluationDate);
  if (!cutoff) throw new Error("evaluationDate is required for leakage-safe opponent evaluation");
  const eligibleRuns = targetRuns
    .filter((run) => horseIdOf(run) === String(horseId) && raceDateOf(run, raceByKey.get(run.raceKey)) < cutoff)
    .sort((left, right) => raceDateOf(right, raceByKey.get(right.raceKey)).localeCompare(
      raceDateOf(left, raceByKey.get(left.raceKey)),
    ))
    .slice(0, MAX_ENCOUNTERS);
  const encounters = eligibleRuns.map((targetRun) => evaluateEncounter({
    targetRun,
    field: fieldsByRace.get(targetRun.raceKey) ?? [],
    runsByHorse,
    raceByKey,
    evaluationDate: cutoff,
  }));
  const informative = encounters.filter((encounter) => encounter.profiledPeerCount > 0);
  if (!informative.length) return {
    status: "missing",
    score: null,
    evaluationCutoff: cutoff,
    encounterCount: encounters.length,
    profiledEncounterCount: 0,
    peerCount: encounters.reduce((sum, encounter) => sum + encounter.peerCount, 0),
    profiledPeerCount: 0,
    encounters,
  };
  const weighted = informative.map((encounter, index) => ({
    value: encounter.score,
    weight: RECENCY_WEIGHTS[index] * (0.65 + 0.35 * encounter.coverage),
  }));
  const weight = weighted.reduce((sum, item) => sum + item.weight, 0);
  const score = weighted.reduce((sum, item) => sum + item.value * item.weight, 0) / weight;
  const profiledPeerCount = encounters.reduce((sum, encounter) => sum + encounter.profiledPeerCount, 0);
  const strongest = encounters
    .flatMap((encounter) => encounter.peers.map((peer) => ({
      horseName: peer.horseName,
      raceName: encounter.raceName,
      qualityScore: peer.score,
      laterStarts: peer.laterStarts,
      relation: encounter.finishPosition != null && peer.finishPosition != null
        ? encounter.finishPosition < peer.finishPosition ? "beat" : "lost"
        : "unknown",
    })))
    .filter((peer) => Number.isFinite(peer.qualityScore))
    .sort((left, right) => right.qualityScore - left.qualityScore || right.laterStarts - left.laterStarts)
    .slice(0, 5);
  return {
    status: informative.length >= 3 && profiledPeerCount >= 20 ? "active" : "partial",
    score: Math.round(clamp(score)),
    evaluationCutoff: cutoff,
    encounterCount: encounters.length,
    profiledEncounterCount: informative.length,
    peerCount: encounters.reduce((sum, encounter) => sum + encounter.peerCount, 0),
    profiledPeerCount,
    strongest,
    encounters,
  };
};

const combineRaceLevelRelation = (legacyRelationScore, raceLevelScore) => {
  if (!Number.isFinite(raceLevelScore)) return Number.isFinite(legacyRelationScore)
    ? Math.round(legacyRelationScore)
    : null;
  if (!Number.isFinite(legacyRelationScore)) return Math.round(raceLevelScore);
  return Math.round(legacyRelationScore * 0.7 + raceLevelScore * 0.3);
};

export {
  calculateOpponentRaceLevel,
  classBaseline,
  combineRaceLevelRelation,
  evaluateEncounter,
  finishPercentile,
  gradeTier,
  normalizeDate,
};
