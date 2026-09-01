import { buildPairingCrossShadow } from "../../intelligence/blood-pairing-statistics.mjs";
import { resolvePedigreeLineIds } from "../../intelligence/bloodline-resolver.mjs";

const round4 = (value) => Number(Number(value).toFixed(4));
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const normalizeName = (value) => String(value ?? "").normalize("NFKC").replace(/[\s\u3000]/g, "");

const bloodFor = (horse) => horse?.analysis?.factorsDetail?.blood ?? horse?.analysis?.factors?.blood ?? null;

const rankedRows = (rows, scoreKey) => {
  const sorted = [...rows].sort((left, right) => right[scoreKey] - left[scoreKey] || left.number - right.number);
  let rank = 0;
  let previousScore = null;
  return sorted.map((row, index) => {
    if (previousScore === null || row[scoreKey] !== previousScore) rank = index + 1;
    previousScore = row[scoreKey];
    return { ...row, rank };
  });
};

const compactPairing = (shadow) => {
  const active = shadow.pairing;
  const reference = shadow.pairingReference;
  const attempt = active ?? reference;
  if (!attempt) return null;
  const selection = attempt.selection;
  const candidate = selection.statistic ? selection : selection.reference;
  return {
    status: active ? "active" : "reference_only",
    fallbackLevel: attempt.fallbackLevel,
    label: attempt.label,
    scope: candidate?.scope ?? null,
    sampleSize: candidate?.statistic?.sampleSize ?? 0,
    uniqueHorseCount: candidate?.statistic?.uniqueHorseCount ?? 0,
    hitRate: candidate?.statistic?.hitRate ?? null,
    confidence: candidate?.statistic?.confidence ?? "low",
  };
};

const compactCrosses = (shadow) => shadow.crosses.map((cross) => {
  const candidate = cross.selection.statistic ? cross.selection : cross.selection.reference;
  return {
    ancestor: cross.ancestor,
    pattern: cross.pattern,
    status: cross.selection.status,
    scope: candidate?.scope ?? null,
    sampleSize: candidate?.statistic?.sampleSize ?? 0,
    uniqueHorseCount: candidate?.statistic?.uniqueHorseCount ?? 0,
  };
});

const buildRaceShadowPrediction = (race, statistics) => {
  const horses = (race.horses ?? []).map((horse) => {
    const blood = bloodFor(horse);
    if (!Number.isFinite(Number(blood?.score))) return null;
    const shadow = buildPairingCrossShadow({ horse, statistics });
    const currentBlood = round4(Number(blood.score));
    const shadowBlood = round4(clamp(currentBlood + shadow.adjustment, 0, 100));
    const lines = resolvePedigreeLineIds(horse.pedigree);
    return {
      number: Number(horse.number ?? horse.horseNumber ?? horse.currentRace?.horseNumber),
      name: horse.name ?? horse.horseName,
      currentBlood,
      shadowAdjustment: shadow.adjustment,
      shadowBlood,
      pairingAdjustment: shadow.pairingAdjustment,
      crossAdjustment: shadow.crossAdjustment,
      pairing: compactPairing(shadow),
      crosses: compactCrosses(shadow),
      lineIds: {
        sire: lines.sireLine?.id ?? null,
        sireLabel: lines.sireLine?.label ?? null,
        sireBranch: lines.sireLine?.branch ?? null,
        broodmareSire: lines.broodmareSireLine?.id ?? null,
        broodmareSireLabel: lines.broodmareSireLine?.label ?? null,
        broodmareSireBranch: lines.broodmareSireLine?.branch ?? null,
      },
    };
  }).filter(Boolean);
  const currentRanks = new Map(rankedRows(horses, "currentBlood").map((row) => [row.name, row.rank]));
  const shadowRanks = new Map(rankedRows(horses, "shadowBlood").map((row) => [row.name, row.rank]));
  const rankedHorses = horses.map((horse) => ({
    ...horse,
    currentRank: currentRanks.get(horse.name),
    shadowRank: shadowRanks.get(horse.name),
  }));
  const currentLeaders = rankedHorses.filter((horse) => horse.currentRank === 1).map(({ number, name, currentBlood }) => ({ number, name, score: currentBlood }));
  const shadowLeaders = rankedHorses.filter((horse) => horse.shadowRank === 1).map(({ number, name, shadowBlood }) => ({ number, name, score: shadowBlood }));
  return {
    raceId: race.id ?? null,
    bundleId: race.bundleId ?? null,
    track: race.track ?? race.course ?? race.venue ?? null,
    raceNumber: Number(race.number ?? race.raceNo),
    raceName: race.name ?? race.raceName,
    horseCount: rankedHorses.length,
    currentLeaders,
    shadowLeaders,
    leaderSetChanged: currentLeaders.map((horse) => horse.name).sort().join("|") !== shadowLeaders.map((horse) => horse.name).sort().join("|"),
    horses: rankedHorses,
  };
};

const resultFor = (horse, resultRace) => {
  if (!horse || !resultRace) return null;
  const result = (resultRace.horses ?? []).find((item) =>
    Number(item.horseNumber ?? item.number) === Number(horse.number)
  );
  return result && normalizeName(result.horseName ?? result.name) === normalizeName(horse.name) ? result : null;
};

const pairwiseScore = (rows, scoreKey) => {
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

const evaluateRaceShadowPrediction = (prediction, resultRace) => {
  const matchedRows = prediction.horses.map((horse) => {
    const result = resultFor(horse, resultRace);
    if (!result) return null;
    return { ...horse, finish: Number(result.finishPosition ?? result.finish) };
  }).filter((row) => Number.isFinite(row?.finish) && row.finish > 0);
  if (matchedRows.length < 2) return null;
  const currentRanks = new Map(rankedRows(matchedRows, "currentBlood").map((row) => [row.name, row.rank]));
  const shadowRanks = new Map(rankedRows(matchedRows, "shadowBlood").map((row) => [row.name, row.rank]));
  const rows = matchedRows.map((row) => ({
    ...row,
    currentRank: currentRanks.get(row.name),
    shadowRank: shadowRanks.get(row.name),
  }));
  const currentLeaderRows = rows.filter((row) => row.currentRank === 1);
  const shadowLeaderRows = rows.filter((row) => row.shadowRank === 1);
  const currentTop3Rows = rows.filter((row) => row.currentRank <= 3);
  const shadowTop3Rows = rows.filter((row) => row.shadowRank <= 3);
  const currentPairwise = pairwiseScore(rows, "currentBlood");
  const shadowPairwise = pairwiseScore(rows, "shadowBlood");
  return {
    raceId: prediction.raceId,
    bundleId: prediction.bundleId,
    track: prediction.track,
    raceNumber: prediction.raceNumber,
    raceName: prediction.raceName,
    horseCount: rows.length,
    leaderSetChanged: currentLeaderRows.map((row) => row.name).sort().join("|") !== shadowLeaderRows.map((row) => row.name).sort().join("|"),
    scratchedOrUnmatchedCount: prediction.horses.length - rows.length,
    rankChangedHorseCount: rows.filter((row) => row.currentRank !== row.shadowRank).length,
    adjustedHorseCount: rows.filter((row) => row.shadowAdjustment !== 0).length,
    currentLeaderTieCount: currentLeaderRows.length,
    shadowLeaderTieCount: shadowLeaderRows.length,
    currentLeaders: currentLeaderRows.map((row) => ({
      number: row.number,
      name: row.name,
      score: row.currentBlood,
      finish: row.finish,
      adjustment: row.shadowAdjustment,
      pairing: row.pairing,
    })),
    shadowLeaders: shadowLeaderRows.map((row) => ({
      number: row.number,
      name: row.name,
      score: row.shadowBlood,
      finish: row.finish,
      adjustment: row.shadowAdjustment,
      pairing: row.pairing,
    })),
    currentLeaderBestFinish: Math.min(...currentLeaderRows.map((row) => row.finish)),
    shadowLeaderBestFinish: Math.min(...shadowLeaderRows.map((row) => row.finish)),
    currentTop3ActualPlaces: currentTop3Rows.filter((row) => row.finish <= 3).length,
    shadowTop3ActualPlaces: shadowTop3Rows.filter((row) => row.finish <= 3).length,
    currentWinnerInTop3: currentTop3Rows.some((row) => row.finish === 1),
    shadowWinnerInTop3: shadowTop3Rows.some((row) => row.finish === 1),
    currentPairwise,
    shadowPairwise,
    maxAbsAdjustment: Math.max(0, ...rows.map((row) => Math.abs(row.shadowAdjustment))),
    horses: rows,
  };
};

const aggregateShadowEvaluation = (races) => {
  const sum = (selector) => races.reduce((total, race) => total + selector(race), 0);
  const currentComparable = sum((race) => race.currentPairwise.comparable);
  const shadowComparable = sum((race) => race.shadowPairwise.comparable);
  const currentConcordant = sum((race) => race.currentPairwise.concordant);
  const shadowConcordant = sum((race) => race.shadowPairwise.concordant);
  return {
    raceCount: races.length,
    horseCount: sum((race) => race.horseCount),
    adjustedHorseCount: sum((race) => race.adjustedHorseCount),
    rankChangedHorseCount: sum((race) => race.rankChangedHorseCount),
    leaderSetChangedRaceCount: sum((race) => Number(race.leaderSetChanged)),
    currentLeaderWins: sum((race) => Number(race.currentLeaderBestFinish === 1)),
    shadowLeaderWins: sum((race) => Number(race.shadowLeaderBestFinish === 1)),
    currentLeaderPlaces: sum((race) => Number(race.currentLeaderBestFinish <= 3)),
    shadowLeaderPlaces: sum((race) => Number(race.shadowLeaderBestFinish <= 3)),
    currentTop3ActualPlaces: sum((race) => race.currentTop3ActualPlaces),
    shadowTop3ActualPlaces: sum((race) => race.shadowTop3ActualPlaces),
    currentWinnerInTop3: sum((race) => Number(race.currentWinnerInTop3)),
    shadowWinnerInTop3: sum((race) => Number(race.shadowWinnerInTop3)),
    currentPairwiseComparable: currentComparable,
    shadowPairwiseComparable: shadowComparable,
    currentPairwiseConcordant: currentConcordant,
    shadowPairwiseConcordant: shadowConcordant,
    currentPairwiseRate: currentComparable ? currentConcordant / currentComparable : null,
    shadowPairwiseRate: shadowComparable ? shadowConcordant / shadowComparable : null,
    currentLeaderTieRaces: sum((race) => Number(race.currentLeaderTieCount > 1)),
    shadowLeaderTieRaces: sum((race) => Number(race.shadowLeaderTieCount > 1)),
    maxAbsAdjustment: Math.max(0, ...races.map((race) => race.maxAbsAdjustment)),
  };
};

export {
  aggregateShadowEvaluation,
  buildRaceShadowPrediction,
  evaluateRaceShadowPrediction,
  normalizeName,
  resultFor,
};
