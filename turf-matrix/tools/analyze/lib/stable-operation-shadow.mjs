import { buildStableOperationShadow } from "../../intelligence/stable-operation-shadow.mjs";

const finite = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
const number = (value) => finite(value) ? Number(value) : null;
const normalizeName = (value) => String(value ?? "").normalize("NFKC").replace(/[\s\u3000]/g, "");
const ranked = (rows, key) => [...rows].sort((left, right) =>
  Number(right[key]) - Number(left[key]) || Number(left.number) - Number(right.number)
);

const compactHorse = (horse) => ({
  number: horse.number,
  name: horse.name,
  trainer: horse.trainer,
  currentStable: horse.currentStable,
  shadowStable: horse.shadowStable,
  stableAdjustment: horse.stableAdjustment,
  operationAdjustment: horse.operationAdjustment,
  status: horse.status,
  phrase: horse.phrase,
});

const buildRaceStableOperationPrediction = (race) => {
  const horses = (race.horses ?? []).map((horse) => {
    const currentAnalysis = horse.analysis?.factorsDetail?.stable ?? {};
    const currentStable = number(currentAnalysis.score ?? horse.analysis?.factors?.stable);
    if (currentStable == null) return null;
    const shadow = buildStableOperationShadow(horse, currentAnalysis);
    return {
      number: Number(horse.number ?? horse.horseNumber),
      name: horse.name ?? horse.horseName,
      trainer: shadow.trainer,
      currentStable,
      shadowStable: shadow.shadowScore,
      stableAdjustment: shadow.adjustment,
      operationAdjustment: shadow.operationAdjustment,
      status: shadow.status,
      phrase: shadow.positiveMatch?.phrase ?? shadow.riskMatch?.phrase ?? null,
    };
  }).filter(Boolean);
  const currentLeader = ranked(horses, "currentStable")[0] ?? null;
  const shadowLeader = ranked(horses, "shadowStable")[0] ?? null;
  return {
    raceId: race.id ?? null,
    bundleId: race.bundleId ?? null,
    track: race.track ?? race.course ?? null,
    raceNumber: Number(race.number ?? race.raceNo),
    raceName: race.name ?? race.raceName ?? null,
    horseCount: horses.length,
    currentLeader: currentLeader ? compactHorse(currentLeader) : null,
    shadowLeader: shadowLeader ? compactHorse(shadowLeader) : null,
    leaderChanged: currentLeader?.name !== shadowLeader?.name,
    adjustedHorseCount: horses.filter((horse) => horse.stableAdjustment !== 0).length,
    empiricalMatchCount: horses.filter((horse) => horse.status === "active").length,
    horses,
  };
};

const resultFor = (horse, resultRace) => {
  if (!horse || !resultRace) return null;
  const result = (resultRace.horses ?? []).find((item) =>
    Number(item.horseNumber ?? item.number) === Number(horse.number)
  );
  return result && normalizeName(result.horseName ?? result.name) === normalizeName(horse.name) ? result : null;
};

const pairwise = (rows, scoreKey) => {
  let comparable = 0;
  let concordant = 0;
  for (let leftIndex = 0; leftIndex < rows.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < rows.length; rightIndex += 1) {
      const left = rows[leftIndex];
      const right = rows[rightIndex];
      const scoreDifference = left[scoreKey] - right[scoreKey];
      const finishDifference = right.finish - left.finish;
      if (!scoreDifference || !finishDifference) continue;
      comparable += 1;
      if (scoreDifference * finishDifference > 0) concordant += 1;
    }
  }
  return { comparable, concordant };
};

const evaluateRaceStableOperationPrediction = (prediction, resultRace) => {
  const rows = prediction.horses.map((horse) => {
    const result = resultFor(horse, resultRace);
    const finish = Number(result?.finishPosition ?? result?.finish);
    return Number.isFinite(finish) && finish > 0 ? { ...horse, finish } : null;
  }).filter(Boolean);
  if (rows.length < 2) return null;
  const currentLeader = ranked(rows, "currentStable")[0];
  const shadowLeader = ranked(rows, "shadowStable")[0];
  return {
    raceId: prediction.raceId,
    bundleId: prediction.bundleId,
    track: prediction.track,
    raceNumber: prediction.raceNumber,
    raceName: prediction.raceName,
    horseCount: rows.length,
    adjustedHorseCount: rows.filter((horse) => horse.stableAdjustment !== 0).length,
    empiricalMatchCount: rows.filter((horse) => horse.status === "active").length,
    leaderChanged: currentLeader.name !== shadowLeader.name,
    currentLeader: { ...compactHorse(currentLeader), finish: currentLeader.finish },
    shadowLeader: { ...compactHorse(shadowLeader), finish: shadowLeader.finish },
    currentPairwise: pairwise(rows, "currentStable"),
    shadowPairwise: pairwise(rows, "shadowStable"),
    maxAbsAdjustment: Math.max(0, ...rows.map((horse) => Math.abs(horse.stableAdjustment))),
  };
};

const aggregateStableOperationEvaluation = (races) => {
  const sum = (selector) => races.reduce((total, race) => total + selector(race), 0);
  const currentComparable = sum((race) => race.currentPairwise.comparable);
  const currentConcordant = sum((race) => race.currentPairwise.concordant);
  const shadowComparable = sum((race) => race.shadowPairwise.comparable);
  const shadowConcordant = sum((race) => race.shadowPairwise.concordant);
  return {
    raceCount: races.length,
    horseCount: sum((race) => race.horseCount),
    adjustedHorseCount: sum((race) => race.adjustedHorseCount),
    empiricalMatchCount: sum((race) => race.empiricalMatchCount),
    leaderChangedRaceCount: sum((race) => Number(race.leaderChanged)),
    currentLeaderWins: sum((race) => Number(race.currentLeader.finish === 1)),
    shadowLeaderWins: sum((race) => Number(race.shadowLeader.finish === 1)),
    currentLeaderPlaces: sum((race) => Number(race.currentLeader.finish <= 3)),
    shadowLeaderPlaces: sum((race) => Number(race.shadowLeader.finish <= 3)),
    currentPairwiseRate: currentComparable ? currentConcordant / currentComparable : null,
    shadowPairwiseRate: shadowComparable ? shadowConcordant / shadowComparable : null,
    maxAbsAdjustment: Math.max(0, ...races.map((race) => race.maxAbsAdjustment)),
  };
};

export {
  aggregateStableOperationEvaluation,
  buildRaceStableOperationPrediction,
  evaluateRaceStableOperationPrediction,
  normalizeName,
  resultFor,
};
