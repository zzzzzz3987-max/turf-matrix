const finite = (value) => typeof value === "number" && Number.isFinite(value);

const round1 = (value) => Number(value.toFixed(1));

export const summarizePublicRoleRecords = (records) => {
  const settled = records.filter((record) => finite(record.finishPosition));
  const payoutKnown = settled.filter((record) => record.payoutAvailable === true);
  const wins = settled.filter((record) => record.finishPosition === 1).length;
  const topThree = settled.filter((record) => record.finishPosition <= 3).length;
  const missedTopThree = settled.length - topThree;
  const winPayout = payoutKnown.reduce((sum, record) => sum + (record.winPayout ?? 0), 0);
  const placePayout = payoutKnown.reduce((sum, record) => sum + (record.placePayout ?? 0), 0);

  return {
    sampleSize: settled.length,
    wins,
    topThree,
    missedTopThree,
    winRate: settled.length ? round1((wins / settled.length) * 100) : null,
    topThreeRate: settled.length ? round1((topThree / settled.length) * 100) : null,
    missedTopThreeRate: settled.length ? round1((missedTopThree / settled.length) * 100) : null,
    payoutSampleSize: payoutKnown.length,
    winReturnRate: payoutKnown.length ? round1(winPayout / payoutKnown.length) : null,
    placeReturnRate: payoutKnown.length ? round1(placePayout / payoutKnown.length) : null,
    status: settled.length >= 30 ? "active" : "building",
  };
};

export const collectPublicRoleRecords = ({ date, snapshot, results, selectConclusion }) => {
  const resultByRace = new Map((results?.races ?? []).map((race) => [race.bundleId, race]));
  const records = [];

  for (const race of snapshot?.races ?? []) {
    const resultRace = resultByRace.get(race.bundleId);
    const conclusion = selectConclusion(race);
    if (!resultRace || !conclusion) continue;

    for (const role of ["value", "danger"]) {
      const selected = conclusion[role]?.horse;
      if (!selected?.number) continue;
      const resultHorse = (resultRace.horses ?? []).find((horse) => horse.horseNumber === selected.number);
      if (!resultHorse || !finite(resultHorse.finishPosition)) continue;
      const payoutAvailable = Object.hasOwn(resultHorse, "winPayout") && Object.hasOwn(resultHorse, "placePayout") &&
        finite(resultHorse.winPayout) && finite(resultHorse.placePayout);
      records.push({
        role,
        date,
        raceId: race.bundleId,
        horseNumber: selected.number,
        horseName: selected.name,
        popularity: selected.popularity ?? null,
        finishPosition: resultHorse.finishPosition,
        payoutAvailable,
        winPayout: payoutAvailable ? resultHorse.winPayout : null,
        placePayout: payoutAvailable ? resultHorse.placePayout : null,
      });
    }
  }

  return records;
};
