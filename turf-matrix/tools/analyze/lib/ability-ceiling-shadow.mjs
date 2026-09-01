import { buildAbilityCeilingShadow } from "../../intelligence/ability-ceiling-shadow.mjs";
import { calculateTmIndex } from "../../intelligence/tm-index-engine.mjs";

const finite = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
const number = (value) => finite(value) ? Number(value) : null;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const normalizeName = (value) => String(value ?? "").normalize("NFKC").replace(/[\s\u3000]/g, "");
const detailScore = (horse, key) => number(horse.analysis?.factorsDetail?.[key]?.score);

const scoreSet = (horse, ability) => ({
  ability,
  form: detailScore(horse, "form"),
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

const ranked = (rows, scoreKey) => [...rows].sort((left, right) =>
  Number(right[scoreKey]) - Number(left[scoreKey]) || left.number - right.number
);

const compactHorse = (horse) => ({
  number: horse.number,
  name: horse.name,
  currentAbility: horse.currentAbility,
  shadowAbility: horse.shadowAbility,
  abilityAdjustment: horse.abilityAdjustment,
  currentTm: horse.currentTm,
  shadowTm: horse.shadowTm,
});

const buildRaceAbilityCeilingPrediction = (race) => {
  const context = race.raceContext ?? { category: race.category, surface: race.surface };
  const horses = (race.horses ?? []).map((horse) => {
    const currentAbility = detailScore(horse, "ability");
    const currentTm = number(horse.tmIndex);
    if (currentAbility == null || currentTm == null) return null;
    const shadow = buildAbilityCeilingShadow(horse, currentAbility);
    const currentRaw = calculateTmIndex(scoreSet(horse, currentAbility), context);
    const shadowRaw = calculateTmIndex(scoreSet(horse, shadow.shadowScore), context);
    const tmDelta = finite(currentRaw) && finite(shadowRaw)
      ? Math.round((shadowRaw - currentRaw) * experienceFactor(horse))
      : 0;
    return {
      number: Number(horse.number ?? horse.horseNumber),
      name: horse.name ?? horse.horseName,
      currentAbility,
      shadowAbility: shadow.shadowScore,
      abilityAdjustment: shadow.adjustment,
      demonstratedScore: shadow.demonstratedScore,
      ceilingScore: shadow.ceilingScore,
      consistencyScore: shadow.consistencyScore,
      evidenceFactor: shadow.evidenceFactor,
      currentTm,
      shadowTm: clamp(currentTm + tmDelta, 45, 92),
      tmDelta,
    };
  }).filter(Boolean);
  const currentAbilityLeader = ranked(horses, "currentAbility")[0] ?? null;
  const shadowAbilityLeader = ranked(horses, "shadowAbility")[0] ?? null;
  const currentTmLeader = ranked(horses, "currentTm")[0] ?? null;
  const shadowTmLeader = ranked(horses, "shadowTm")[0] ?? null;
  return {
    raceId: race.id ?? null,
    bundleId: race.bundleId ?? null,
    track: race.track ?? race.course ?? null,
    raceNumber: Number(race.number ?? race.raceNo),
    raceName: race.name ?? race.raceName ?? null,
    horseCount: horses.length,
    currentAbilityLeader: currentAbilityLeader ? compactHorse(currentAbilityLeader) : null,
    shadowAbilityLeader: shadowAbilityLeader ? compactHorse(shadowAbilityLeader) : null,
    currentTmLeader: currentTmLeader ? compactHorse(currentTmLeader) : null,
    shadowTmLeader: shadowTmLeader ? compactHorse(shadowTmLeader) : null,
    abilityLeaderChanged: currentAbilityLeader?.name !== shadowAbilityLeader?.name,
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

const evaluateRaceAbilityCeilingPrediction = (prediction, resultRace) => {
  const rows = prediction.horses.map((horse) => {
    const result = resultFor(horse, resultRace);
    const finish = Number(result?.finishPosition ?? result?.finish);
    return Number.isFinite(finish) && finish > 0 ? { ...horse, finish } : null;
  }).filter(Boolean);
  if (rows.length < 2) return null;
  const currentAbilityLeader = ranked(rows, "currentAbility")[0];
  const shadowAbilityLeader = ranked(rows, "shadowAbility")[0];
  const currentTmLeader = ranked(rows, "currentTm")[0];
  const shadowTmLeader = ranked(rows, "shadowTm")[0];
  return {
    raceId: prediction.raceId,
    bundleId: prediction.bundleId,
    track: prediction.track,
    raceNumber: prediction.raceNumber,
    raceName: prediction.raceName,
    horseCount: rows.length,
    adjustedHorseCount: rows.filter((horse) => horse.abilityAdjustment !== 0).length,
    abilityLeaderChanged: currentAbilityLeader.name !== shadowAbilityLeader.name,
    tmLeaderChanged: currentTmLeader.name !== shadowTmLeader.name,
    currentAbilityLeader: { ...compactHorse(currentAbilityLeader), finish: currentAbilityLeader.finish },
    shadowAbilityLeader: { ...compactHorse(shadowAbilityLeader), finish: shadowAbilityLeader.finish },
    currentTmLeader: { ...compactHorse(currentTmLeader), finish: currentTmLeader.finish },
    shadowTmLeader: { ...compactHorse(shadowTmLeader), finish: shadowTmLeader.finish },
    currentAbilityPairwise: pairwise(rows, "currentAbility"),
    shadowAbilityPairwise: pairwise(rows, "shadowAbility"),
    currentTmPairwise: pairwise(rows, "currentTm"),
    shadowTmPairwise: pairwise(rows, "shadowTm"),
    maxAbsAdjustment: Math.max(0, ...rows.map((horse) => Math.abs(horse.abilityAdjustment))),
  };
};

const aggregateAbilityCeilingEvaluation = (races) => {
  const sum = (selector) => races.reduce((total, race) => total + selector(race), 0);
  const rate = (prefix, scope) => {
    const comparable = sum((race) => race[`${prefix}${scope}Pairwise`].comparable);
    const concordant = sum((race) => race[`${prefix}${scope}Pairwise`].concordant);
    return { comparable, concordant, rate: comparable ? concordant / comparable : null };
  };
  const currentAbility = rate("current", "Ability");
  const shadowAbility = rate("shadow", "Ability");
  const currentTm = rate("current", "Tm");
  const shadowTm = rate("shadow", "Tm");
  return {
    raceCount: races.length,
    horseCount: sum((race) => race.horseCount),
    adjustedHorseCount: sum((race) => race.adjustedHorseCount),
    abilityLeaderChangedRaceCount: sum((race) => Number(race.abilityLeaderChanged)),
    tmLeaderChangedRaceCount: sum((race) => Number(race.tmLeaderChanged)),
    currentAbilityWins: sum((race) => Number(race.currentAbilityLeader.finish === 1)),
    shadowAbilityWins: sum((race) => Number(race.shadowAbilityLeader.finish === 1)),
    currentAbilityPlaces: sum((race) => Number(race.currentAbilityLeader.finish <= 3)),
    shadowAbilityPlaces: sum((race) => Number(race.shadowAbilityLeader.finish <= 3)),
    currentTmWins: sum((race) => Number(race.currentTmLeader.finish === 1)),
    shadowTmWins: sum((race) => Number(race.shadowTmLeader.finish === 1)),
    currentTmPlaces: sum((race) => Number(race.currentTmLeader.finish <= 3)),
    shadowTmPlaces: sum((race) => Number(race.shadowTmLeader.finish <= 3)),
    currentAbilityPairwiseRate: currentAbility.rate,
    shadowAbilityPairwiseRate: shadowAbility.rate,
    currentTmPairwiseRate: currentTm.rate,
    shadowTmPairwiseRate: shadowTm.rate,
    maxAbsAdjustment: Math.max(0, ...races.map((race) => race.maxAbsAdjustment)),
  };
};

export {
  aggregateAbilityCeilingEvaluation,
  buildRaceAbilityCeilingPrediction,
  evaluateRaceAbilityCeilingPrediction,
  normalizeName,
  resultFor,
};
