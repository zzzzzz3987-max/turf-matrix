const finite = (value) => typeof value === "number" && Number.isFinite(value);
const normalizeName = (value) => String(value ?? "").normalize("NFKC").replace(/[\s\u3000]/g, "");

export const resultForBattleHorse = (horse, race) => {
  if (!horse || !race) return null;
  const result = (race.horses ?? []).find((item) => Number(item.horseNumber) === Number(horse.number));
  return result && normalizeName(result.horseName) === normalizeName(horse.name) ? result : null;
};

export const evaluateBattleSelection = (selection, resultsByRace) => {
  if (!selection) return null;
  const race = resultsByRace.get(selection.bundleId);
  const axis = resultForBattleHorse(selection.axis, race);
  const opponent1 = resultForBattleHorse(selection.opponents?.[0], race);
  const opponent2 = resultForBattleHorse(selection.opponents?.[1], race);
  if (!axis) return null;
  const axisFinish = Number(axis.finishPosition);
  if (!finite(axisFinish)) return null;
  const opponent1Finish = finite(Number(opponent1?.finishPosition)) ? Number(opponent1.finishPosition) : null;
  const opponent2Finish = finite(Number(opponent2?.finishPosition)) ? Number(opponent2.finishPosition) : null;

  return {
    date: selection.date,
    raceId: selection.raceId,
    race: `${selection.track}${selection.raceNumber}R`,
    horseName: selection.axis.name,
    axisFinish,
    axisWin: axisFinish === 1,
    axisPlace: axisFinish <= 3,
    winPayout: finite(axis.winPayout) ? axis.winPayout : null,
    placePayout: finite(axis.placePayout) ? axis.placePayout : null,
    opponent1Finish,
    opponent2Finish,
    pair1Comparable: opponent1Finish !== null,
    pair2Comparable: opponent2Finish !== null,
    pair1Hit: opponent1Finish !== null && axisFinish <= 3 && opponent1Finish <= 3,
    pair2Hit: opponent2Finish !== null && axisFinish <= 3 && opponent2Finish <= 3,
  };
};

export const aggregateBattleRows = (rows) => {
  const winPayoutRows = rows.filter((row) => finite(row.winPayout));
  const placePayoutRows = rows.filter((row) => finite(row.placePayout));
  const pair1Comparable = rows.filter((row) => row.pair1Comparable);
  const pair2Comparable = rows.filter((row) => row.pair2Comparable);
  return {
    count: rows.length,
    wins: rows.filter((row) => row.axisWin).length,
    places: rows.filter((row) => row.axisPlace).length,
    winReturnRate: winPayoutRows.length
      ? winPayoutRows.reduce((sum, row) => sum + row.winPayout, 0) / winPayoutRows.length
      : null,
    placeReturnRate: placePayoutRows.length
      ? placePayoutRows.reduce((sum, row) => sum + row.placePayout, 0) / placePayoutRows.length
      : null,
    pair1Comparable: pair1Comparable.length,
    pair1Hits: pair1Comparable.filter((row) => row.pair1Hit).length,
    pair2Comparable: pair2Comparable.length,
    pair2Hits: pair2Comparable.filter((row) => row.pair2Hit).length,
  };
};

export const sameBattleSelection = (left, right) =>
  left?.raceId === right?.raceId && Number(left?.axis?.number) === Number(right?.axis?.number);
