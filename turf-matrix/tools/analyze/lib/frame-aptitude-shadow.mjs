import { buildFrameAptitudeShadow } from "../../intelligence/frame-ai.mjs";

const finite = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
const number = (value) => finite(value) ? Number(value) : null;
const normalizeName = (value) => String(value ?? "").normalize("NFKC").replace(/[\s\u3000]/g, "");
const ranked = (rows, key) => [...rows].sort((left, right) =>
  Number(right[key]) - Number(left[key]) || Number(left.number) - Number(right.number)
);

const compactHorse = (horse) => ({
  number: horse.number,
  name: horse.name,
  currentFrame: horse.currentFrame,
  shadowFrame: horse.shadowFrame,
  frameAdjustment: horse.frameAdjustment,
  status: horse.status,
  confidence: horse.confidence,
  zone: horse.zone,
  level: horse.level,
  sampleSize: horse.sampleSize,
  baselinePlaceRate: horse.baselinePlaceRate,
  predictedPlaceRate: horse.predictedPlaceRate,
});

const buildRaceFrameAptitudePrediction = (race) => {
  const raceContext = {
    date: String(race.id ?? race.bundleId ?? "").slice(0, 10),
    course: race.track ?? race.course,
    surface: race.surface,
    distance: race.distance,
    fieldSize: race.fieldSize ?? race.horses?.length,
  };
  const horses = (race.horses ?? []).map((horse) => {
    const currentAnalysis = horse.analysis?.factorsDetail?.frame ?? horse.analysis?.frameEval ?? {};
    const currentFrame = number(currentAnalysis.score ?? horse.analysis?.factors?.frame);
    if (currentFrame == null) return null;
    const shadow = buildFrameAptitudeShadow(horse, raceContext, currentFrame);
    return {
      number: Number(horse.number ?? horse.horseNumber),
      name: horse.name ?? horse.horseName,
      currentFrame,
      shadowFrame: shadow.shadowScore,
      frameAdjustment: shadow.adjustment,
      status: shadow.status,
      confidence: shadow.confidence,
      zone: shadow.snapshot.zone,
      level: shadow.match?.level ?? null,
      sampleSize: shadow.match?.sampleSize ?? 0,
      baselinePlaceRate: shadow.match?.baselineHitRate ?? null,
      predictedPlaceRate: shadow.match?.adjustedHitRate ?? null,
    };
  }).filter(Boolean);
  const currentLeader = ranked(horses, "currentFrame")[0] ?? null;
  const shadowLeader = ranked(horses, "shadowFrame")[0] ?? null;
  return {
    raceId: race.id ?? null,
    bundleId: race.bundleId ?? null,
    track: race.track ?? race.course ?? null,
    raceNumber: Number(race.number ?? race.raceNo),
    raceName: race.name ?? race.raceName ?? null,
    surface: race.surface ?? null,
    distance: Number(race.distance),
    fieldSize: Number(race.fieldSize ?? horses.length),
    horseCount: horses.length,
    currentLeader: currentLeader ? compactHorse(currentLeader) : null,
    shadowLeader: shadowLeader ? compactHorse(shadowLeader) : null,
    leaderChanged: currentLeader?.name !== shadowLeader?.name,
    adjustedHorseCount: horses.filter((horse) => horse.frameAdjustment !== 0).length,
    empiricalMatchCount: horses.filter((horse) => horse.status === "active").length,
    horses,
  };
};

const resultFor = (horse, resultRace) => {
  if (!horse || !resultRace) return null;
  const result = (resultRace.horses ?? []).find((item) => Number(item.horseNumber ?? item.number) === Number(horse.number));
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

const brierTotals = (rows, key) => rows.reduce((total, row) => {
  const prediction = number(row[key]);
  if (prediction == null) return total;
  return {
    count: total.count + 1,
    squaredError: total.squaredError + (prediction - Number(row.finish <= 3)) ** 2,
  };
}, { count: 0, squaredError: 0 });

const evaluateRaceFrameAptitudePrediction = (prediction, resultRace) => {
  const rows = prediction.horses.map((horse) => {
    const result = resultFor(horse, resultRace);
    const finish = Number(result?.finishPosition ?? result?.finish);
    return Number.isFinite(finish) && finish > 0 ? { ...horse, finish } : null;
  }).filter(Boolean);
  if (rows.length < 2) return null;
  const currentLeader = ranked(rows, "currentFrame")[0];
  const shadowLeader = ranked(rows, "shadowFrame")[0];
  return {
    raceId: prediction.raceId,
    bundleId: prediction.bundleId,
    track: prediction.track,
    raceNumber: prediction.raceNumber,
    raceName: prediction.raceName,
    horseCount: rows.length,
    adjustedHorseCount: rows.filter((horse) => horse.frameAdjustment !== 0).length,
    empiricalMatchCount: rows.filter((horse) => horse.status === "active").length,
    leaderChanged: currentLeader.name !== shadowLeader.name,
    currentLeader: { ...compactHorse(currentLeader), finish: currentLeader.finish },
    shadowLeader: { ...compactHorse(shadowLeader), finish: shadowLeader.finish },
    currentPairwise: pairwise(rows, "currentFrame"),
    shadowPairwise: pairwise(rows, "shadowFrame"),
    baselineBrier: brierTotals(rows, "baselinePlaceRate"),
    shadowBrier: brierTotals(rows, "predictedPlaceRate"),
    positive: rows.filter((horse) => number(horse.predictedPlaceRate) != null && horse.predictedPlaceRate - horse.baselinePlaceRate >= 0.009999),
    negative: rows.filter((horse) => number(horse.predictedPlaceRate) != null && horse.predictedPlaceRate - horse.baselinePlaceRate <= -0.009999),
  };
};

const aggregateFrameAptitudeEvaluation = (races) => {
  const sum = (selector) => races.reduce((total, race) => total + selector(race), 0);
  const currentComparable = sum((race) => race.currentPairwise.comparable);
  const currentConcordant = sum((race) => race.currentPairwise.concordant);
  const shadowComparable = sum((race) => race.shadowPairwise.comparable);
  const shadowConcordant = sum((race) => race.shadowPairwise.concordant);
  const baselineBrierCount = sum((race) => race.baselineBrier.count);
  const shadowBrierCount = sum((race) => race.shadowBrier.count);
  const positive = races.flatMap((race) => race.positive);
  const negative = races.flatMap((race) => race.negative);
  const placedRate = (rows) => rows.length ? rows.filter((row) => row.finish <= 3).length / rows.length : null;
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
    baselineBrier: baselineBrierCount ? sum((race) => race.baselineBrier.squaredError) / baselineBrierCount : null,
    shadowBrier: shadowBrierCount ? sum((race) => race.shadowBrier.squaredError) / shadowBrierCount : null,
    positiveSampleSize: positive.length,
    positivePlaceRate: placedRate(positive),
    negativeSampleSize: negative.length,
    negativePlaceRate: placedRate(negative),
  };
};

export {
  aggregateFrameAptitudeEvaluation,
  buildRaceFrameAptitudePrediction,
  evaluateRaceFrameAptitudePrediction,
  normalizeName,
  resultFor,
};
