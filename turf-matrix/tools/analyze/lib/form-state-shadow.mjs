import { buildFormStateShadow } from "../../intelligence/form-state-shadow.mjs";
import { calculateTmIndex } from "../../intelligence/tm-index-engine.mjs";

const finite = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
const number = (value) => finite(value) ? Number(value) : null;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const normalizeName = (value) => String(value ?? "").normalize("NFKC").replace(/[\s\u3000]/g, "");
const detailScore = (horse, key) => number(horse.analysis?.factorsDetail?.[key]?.score);

const scoreSet = (horse, form) => ({
  ability: detailScore(horse, "ability"),
  form,
  distance: number(horse.analysis?.factors?.distance),
  course: detailScore(horse, "course") ?? number(horse.analysis?.factors?.course),
  training: detailScore(horse, "training") ?? number(horse.analysis?.factors?.training),
  blood: detailScore(horse, "blood"),
  pace: detailScore(horse, "pace") ?? number(horse.analysis?.factors?.pace),
});

const experienceFactor = (horse) => {
  const count = horse.pastRuns?.length ?? 0;
  return count <= 0 ? 0.3 : count === 1 ? 0.5 : count === 2 ? 0.7 : 1;
};

const ranked = (rows, key) => [...rows].sort((left, right) =>
  Number(right[key]) - Number(left[key]) || left.number - right.number
);

const compactHorse = (horse) => ({
  number: horse.number,
  name: horse.name,
  currentForm: horse.currentForm,
  shadowForm: horse.shadowForm,
  formAdjustment: horse.formAdjustment,
  currentTm: horse.currentTm,
  shadowTm: horse.shadowTm,
});

const buildRaceFormStatePrediction = (race) => {
  const context = race.raceContext ?? { category: race.category, surface: race.surface };
  const horses = (race.horses ?? []).map((horse) => {
    const currentForm = detailScore(horse, "form");
    const currentTm = number(horse.tmIndex);
    if (currentForm == null || currentTm == null) return null;
    const shadow = buildFormStateShadow(horse, currentForm);
    const currentRaw = calculateTmIndex(scoreSet(horse, currentForm), context);
    const shadowRaw = calculateTmIndex(scoreSet(horse, shadow.shadowScore), context);
    const tmDelta = finite(currentRaw) && finite(shadowRaw)
      ? Math.round((shadowRaw - currentRaw) * experienceFactor(horse))
      : 0;
    return {
      number: Number(horse.number ?? horse.horseNumber),
      name: horse.name ?? horse.horseName,
      currentForm,
      shadowForm: shadow.shadowScore,
      formAdjustment: shadow.adjustment,
      candidateForm: shadow.candidateScore,
      recentQuality: shadow.recentQuality,
      baselineQuality: shadow.baselineQuality,
      momentumScore: shadow.momentumScore,
      trendDelta: shadow.trendDelta,
      latestDelta: shadow.latestDelta,
      passingProgress: shadow.passingProgress,
      confidence: shadow.confidence,
      runCount: shadow.runCount,
      currentTm,
      shadowTm: clamp(currentTm + tmDelta, 45, 92),
      tmDelta,
    };
  }).filter(Boolean);
  const currentFormLeader = ranked(horses, "currentForm")[0] ?? null;
  const shadowFormLeader = ranked(horses, "shadowForm")[0] ?? null;
  const currentTmLeader = ranked(horses, "currentTm")[0] ?? null;
  const shadowTmLeader = ranked(horses, "shadowTm")[0] ?? null;
  return {
    raceId: race.id ?? null,
    bundleId: race.bundleId ?? null,
    track: race.track ?? race.course ?? null,
    raceNumber: Number(race.number ?? race.raceNo),
    raceName: race.name ?? race.raceName ?? null,
    horseCount: horses.length,
    currentFormLeader: currentFormLeader ? compactHorse(currentFormLeader) : null,
    shadowFormLeader: shadowFormLeader ? compactHorse(shadowFormLeader) : null,
    currentTmLeader: currentTmLeader ? compactHorse(currentTmLeader) : null,
    shadowTmLeader: shadowTmLeader ? compactHorse(shadowTmLeader) : null,
    formLeaderChanged: currentFormLeader?.name !== shadowFormLeader?.name,
    tmLeaderChanged: currentTmLeader?.name !== shadowTmLeader?.name,
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

const evaluateRaceFormStatePrediction = (prediction, resultRace) => {
  const rows = prediction.horses.map((horse) => {
    const result = resultFor(horse, resultRace);
    const finish = Number(result?.finishPosition ?? result?.finish);
    return Number.isFinite(finish) && finish > 0 ? { ...horse, finish } : null;
  }).filter(Boolean);
  if (rows.length < 2) return null;
  const currentFormLeader = ranked(rows, "currentForm")[0];
  const shadowFormLeader = ranked(rows, "shadowForm")[0];
  const currentTmLeader = ranked(rows, "currentTm")[0];
  const shadowTmLeader = ranked(rows, "shadowTm")[0];
  return {
    raceId: prediction.raceId,
    bundleId: prediction.bundleId,
    track: prediction.track,
    raceNumber: prediction.raceNumber,
    raceName: prediction.raceName,
    horseCount: rows.length,
    adjustedHorseCount: rows.filter((horse) => horse.formAdjustment !== 0).length,
    formLeaderChanged: currentFormLeader.name !== shadowFormLeader.name,
    tmLeaderChanged: currentTmLeader.name !== shadowTmLeader.name,
    currentFormLeader: { ...compactHorse(currentFormLeader), finish: currentFormLeader.finish },
    shadowFormLeader: { ...compactHorse(shadowFormLeader), finish: shadowFormLeader.finish },
    currentTmLeader: { ...compactHorse(currentTmLeader), finish: currentTmLeader.finish },
    shadowTmLeader: { ...compactHorse(shadowTmLeader), finish: shadowTmLeader.finish },
    currentFormPairwise: pairwise(rows, "currentForm"),
    shadowFormPairwise: pairwise(rows, "shadowForm"),
    currentTmPairwise: pairwise(rows, "currentTm"),
    shadowTmPairwise: pairwise(rows, "shadowTm"),
    maxAbsAdjustment: Math.max(0, ...rows.map((horse) => Math.abs(horse.formAdjustment))),
  };
};

const aggregateFormStateEvaluation = (races) => {
  const sum = (selector) => races.reduce((total, race) => total + selector(race), 0);
  const rate = (prefix, scope) => {
    const comparable = sum((race) => race[`${prefix}${scope}Pairwise`].comparable);
    const concordant = sum((race) => race[`${prefix}${scope}Pairwise`].concordant);
    return { comparable, concordant, rate: comparable ? concordant / comparable : null };
  };
  const currentForm = rate("current", "Form");
  const shadowForm = rate("shadow", "Form");
  const currentTm = rate("current", "Tm");
  const shadowTm = rate("shadow", "Tm");
  return {
    raceCount: races.length,
    horseCount: sum((race) => race.horseCount),
    adjustedHorseCount: sum((race) => race.adjustedHorseCount),
    formLeaderChangedRaceCount: sum((race) => Number(race.formLeaderChanged)),
    tmLeaderChangedRaceCount: sum((race) => Number(race.tmLeaderChanged)),
    currentFormWins: sum((race) => Number(race.currentFormLeader.finish === 1)),
    shadowFormWins: sum((race) => Number(race.shadowFormLeader.finish === 1)),
    currentFormPlaces: sum((race) => Number(race.currentFormLeader.finish <= 3)),
    shadowFormPlaces: sum((race) => Number(race.shadowFormLeader.finish <= 3)),
    currentTmWins: sum((race) => Number(race.currentTmLeader.finish === 1)),
    shadowTmWins: sum((race) => Number(race.shadowTmLeader.finish === 1)),
    currentTmPlaces: sum((race) => Number(race.currentTmLeader.finish <= 3)),
    shadowTmPlaces: sum((race) => Number(race.shadowTmLeader.finish <= 3)),
    currentFormPairwiseRate: currentForm.rate,
    shadowFormPairwiseRate: shadowForm.rate,
    currentTmPairwiseRate: currentTm.rate,
    shadowTmPairwiseRate: shadowTm.rate,
    maxAbsAdjustment: Math.max(0, ...races.map((race) => race.maxAbsAdjustment)),
  };
};

export {
  aggregateFormStateEvaluation,
  buildRaceFormStatePrediction,
  evaluateRaceFormStatePrediction,
  normalizeName,
  resultFor,
};
