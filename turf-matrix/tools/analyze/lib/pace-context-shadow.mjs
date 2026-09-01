import { buildPaceContextShadow } from "../../intelligence/pace-context-shadow.mjs";
import { resolveCourseGeometry } from "../../intelligence/course-geometry.mjs";
import { calculateTmIndex } from "../../intelligence/tm-index-engine.mjs";

const finite = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
const number = (value) => finite(value) ? Number(value) : null;
const normalizeName = (value) => String(value ?? "").normalize("NFKC").replace(/[\s\u3000]/g, "");
const detailScore = (horse, key) => number(horse.analysis?.factorsDetail?.[key]?.score);
const scoreSet = (horse, pace) => ({
  ability: detailScore(horse, "ability"),
  form: detailScore(horse, "form"),
  distance: number(horse.analysis?.factors?.distance),
  course: detailScore(horse, "course") ?? number(horse.analysis?.factors?.course),
  training: detailScore(horse, "training") ?? number(horse.analysis?.factors?.training),
  blood: detailScore(horse, "blood"),
  pace,
});
const ranked = (rows, key) => [...rows].sort((left, right) => Number(right[key]) - Number(left[key]) || left.number - right.number);
const compactHorse = (horse) => ({
  number: horse.number,
  name: horse.name,
  currentPace: horse.currentPace,
  shadowPace: horse.shadowPace,
  paceAdjustment: horse.paceAdjustment,
  historyAdjustment: horse.historyAdjustment,
  contextAdjustment: horse.contextAdjustment,
  contextLabel: horse.contextLabel,
  currentTm: horse.currentTm,
  shadowTm: horse.shadowTm,
});

const buildRacePaceContextPrediction = (race, history, trackBias = null) => {
  const raceMeta = {
    course: race.track ?? race.course,
    surface: race.surface,
    distance: race.distance,
    layout: race.layout,
  };
  const context = {
    ...(race.raceContext ?? { category: race.category, surface: race.surface }),
    course: raceMeta.course,
    surface: raceMeta.surface,
    distance: raceMeta.distance,
    fieldSize: race.fieldSize,
    courseShape: race.raceContext?.courseShape ?? resolveCourseGeometry(raceMeta),
    trackBias: trackBias ?? race.raceContext?.trackBias ?? race.trackBias ?? null,
  };
  const horses = (race.horses ?? []).map((horse) => {
    const currentPace = detailScore(horse, "pace") ?? number(horse.analysis?.factors?.pace);
    const currentTm = number(horse.tmIndex);
    if (currentPace == null || currentTm == null) return null;
    const analysisHorse = {
      ...horse,
      horseNumber: horse.number ?? horse.horseNumber,
      horseName: horse.name ?? horse.horseName,
      currentRace: { ...(horse.currentRace ?? {}), fieldSize: race.fieldSize },
    };
    const shadow = buildPaceContextShadow(analysisHorse, currentPace, context, history);
    const currentRaw = calculateTmIndex(scoreSet(horse, currentPace), context);
    const shadowRaw = calculateTmIndex(scoreSet(horse, shadow.shadowScore), context);
    const tmDelta = finite(currentRaw) && finite(shadowRaw) ? shadowRaw - currentRaw : 0;
    return {
      number: Number(horse.number ?? horse.horseNumber),
      name: horse.name ?? horse.horseName,
      currentPace,
      shadowPace: shadow.shadowScore,
      paceAdjustment: shadow.adjustment,
      historyAdjustment: shadow.historical.adjustment,
      contextAdjustment: shadow.currentContext.adjustment,
      contextLabel: shadow.currentContext.label,
      evidence: shadow.evidence,
      currentTm,
      shadowTm: currentTm + tmDelta,
      tmDelta,
    };
  }).filter(Boolean);
  const currentPaceLeader = ranked(horses, "currentPace")[0] ?? null;
  const shadowPaceLeader = ranked(horses, "shadowPace")[0] ?? null;
  const currentTmLeader = ranked(horses, "currentTm")[0] ?? null;
  const shadowTmLeader = ranked(horses, "shadowTm")[0] ?? null;
  return {
    raceId: race.id ?? null,
    bundleId: race.bundleId ?? null,
    track: raceMeta.course,
    surface: race.surface,
    raceNumber: Number(race.number ?? race.raceNo),
    raceName: race.name ?? race.raceName ?? null,
    horseCount: horses.length,
    courseShapeSource: context.courseShape?.source ?? null,
    sourceBiasRaceCount: context.trackBias?.sample?.raceCount ?? 0,
    currentPaceLeader: currentPaceLeader ? compactHorse(currentPaceLeader) : null,
    shadowPaceLeader: shadowPaceLeader ? compactHorse(shadowPaceLeader) : null,
    currentTmLeader: currentTmLeader ? compactHorse(currentTmLeader) : null,
    shadowTmLeader: shadowTmLeader ? compactHorse(shadowTmLeader) : null,
    paceLeaderChanged: currentPaceLeader?.name !== shadowPaceLeader?.name,
    tmLeaderChanged: currentTmLeader?.name !== shadowTmLeader?.name,
    horses,
  };
};

const resultFor = (horse, resultRace) => {
  const result = (resultRace?.horses ?? []).find((item) => Number(item.horseNumber ?? item.number) === Number(horse.number));
  return result && normalizeName(result.horseName ?? result.name) === normalizeName(horse.name) ? result : null;
};

const pairwise = (rows, scoreKey) => {
  let comparable = 0;
  let concordant = 0;
  for (let leftIndex = 0; leftIndex < rows.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < rows.length; rightIndex += 1) {
      const scoreDifference = rows[leftIndex][scoreKey] - rows[rightIndex][scoreKey];
      const finishDifference = rows[rightIndex].finish - rows[leftIndex].finish;
      if (!scoreDifference || !finishDifference) continue;
      comparable += 1;
      if (scoreDifference * finishDifference > 0) concordant += 1;
    }
  }
  return { comparable, concordant };
};

const evaluateRacePaceContextPrediction = (prediction, resultRace) => {
  const rows = prediction.horses.map((horse) => {
    const result = resultFor(horse, resultRace);
    const finish = Number(result?.finishPosition ?? result?.finish);
    return Number.isFinite(finish) && finish > 0 ? { ...horse, finish } : null;
  }).filter(Boolean);
  if (rows.length < 2) return null;
  const currentPaceLeader = ranked(rows, "currentPace")[0];
  const shadowPaceLeader = ranked(rows, "shadowPace")[0];
  const currentTmLeader = ranked(rows, "currentTm")[0];
  const shadowTmLeader = ranked(rows, "shadowTm")[0];
  return {
    raceId: prediction.raceId,
    bundleId: prediction.bundleId,
    track: prediction.track,
    raceNumber: prediction.raceNumber,
    raceName: prediction.raceName,
    horseCount: rows.length,
    courseShapeSource: prediction.courseShapeSource,
    sourceBiasRaceCount: prediction.sourceBiasRaceCount,
    adjustedHorseCount: rows.filter((horse) => horse.paceAdjustment !== 0).length,
    contextAdjustedHorseCount: rows.filter((horse) => horse.contextAdjustment !== 0).length,
    paceLeaderChanged: currentPaceLeader.name !== shadowPaceLeader.name,
    tmLeaderChanged: currentTmLeader.name !== shadowTmLeader.name,
    currentPaceLeader: { ...compactHorse(currentPaceLeader), finish: currentPaceLeader.finish },
    shadowPaceLeader: { ...compactHorse(shadowPaceLeader), finish: shadowPaceLeader.finish },
    currentTmLeader: { ...compactHorse(currentTmLeader), finish: currentTmLeader.finish },
    shadowTmLeader: { ...compactHorse(shadowTmLeader), finish: shadowTmLeader.finish },
    currentPacePairwise: pairwise(rows, "currentPace"),
    shadowPacePairwise: pairwise(rows, "shadowPace"),
    currentTmPairwise: pairwise(rows, "currentTm"),
    shadowTmPairwise: pairwise(rows, "shadowTm"),
    maxAbsAdjustment: Math.max(0, ...rows.map((horse) => Math.abs(horse.paceAdjustment))),
  };
};

const aggregatePaceContextEvaluation = (races) => {
  const sum = (selector) => races.reduce((total, race) => total + selector(race), 0);
  const rate = (key) => {
    const comparable = sum((race) => race[key].comparable);
    const concordant = sum((race) => race[key].concordant);
    return comparable ? concordant / comparable : null;
  };
  return {
    raceCount: races.length,
    horseCount: sum((race) => race.horseCount),
    adjustedHorseCount: sum((race) => race.adjustedHorseCount),
    contextAdjustedHorseCount: sum((race) => race.contextAdjustedHorseCount),
    adjustedRaceCount: races.filter((race) => race.adjustedHorseCount > 0).length,
    liveBiasRaceCount: races.filter((race) => race.sourceBiasRaceCount > 0).length,
    exactCourseProfileRaceCount: races.filter((race) => race.courseShapeSource === "course-profile").length,
    genericCourseGeometryRaceCount: races.filter((race) => race.courseShapeSource && race.courseShapeSource !== "course-profile").length,
    missingCourseGeometryRaceCount: races.filter((race) => !race.courseShapeSource).length,
    paceLeaderChangedRaceCount: sum((race) => Number(race.paceLeaderChanged)),
    tmLeaderChangedRaceCount: sum((race) => Number(race.tmLeaderChanged)),
    currentPaceWins: sum((race) => Number(race.currentPaceLeader.finish === 1)),
    shadowPaceWins: sum((race) => Number(race.shadowPaceLeader.finish === 1)),
    currentPacePlaces: sum((race) => Number(race.currentPaceLeader.finish <= 3)),
    shadowPacePlaces: sum((race) => Number(race.shadowPaceLeader.finish <= 3)),
    currentTmWins: sum((race) => Number(race.currentTmLeader.finish === 1)),
    shadowTmWins: sum((race) => Number(race.shadowTmLeader.finish === 1)),
    currentTmPlaces: sum((race) => Number(race.currentTmLeader.finish <= 3)),
    shadowTmPlaces: sum((race) => Number(race.shadowTmLeader.finish <= 3)),
    currentPacePairwiseRate: rate("currentPacePairwise"),
    shadowPacePairwiseRate: rate("shadowPacePairwise"),
    currentTmPairwiseRate: rate("currentTmPairwise"),
    shadowTmPairwiseRate: rate("shadowTmPairwise"),
    maxAbsAdjustment: Math.max(0, ...races.map((race) => race.maxAbsAdjustment)),
  };
};

export {
  aggregatePaceContextEvaluation,
  buildRacePaceContextPrediction,
  evaluateRacePaceContextPrediction,
};
