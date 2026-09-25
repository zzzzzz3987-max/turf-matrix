const isDate = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

export const buildFullRaceRuntimeConfig = ({ raceDate, allRaceSignals }) => {
  if (!isDate(raceDate) || allRaceSignals?.date !== raceDate) {
    throw new Error("Full-race signals do not match the odds snapshot date");
  }
  const races = allRaceSignals.races;
  if (!Array.isArray(races) || races.length === 0) {
    throw new Error("Full-race signals are missing their race list");
  }

  const ids = new Set();
  const bundles = races.map((race) => {
    if (typeof race.id !== "string" || !race.id.startsWith(`${raceDate}-`)
      || typeof race.bundleId !== "string" || !race.bundleId.startsWith(`${raceDate}-`)) {
      throw new Error("Full-race signals contain an invalid race identity");
    }
    if (ids.has(race.id) || ids.has(race.bundleId)) {
      throw new Error("Full-race signals contain duplicate race identities");
    }
    ids.add(race.id);
    ids.add(race.bundleId);
    return race.bundleId;
  });

  if (allRaceSignals.raceCount != null && allRaceSignals.raceCount !== bundles.length) {
    throw new Error("Full-race signal count does not match its race list");
  }

  return {
    raceDate,
    expectedRaceCount: bundles.length,
    bundles,
    provisional: false,
    allowMissingRaceName: true,
    allowMissingPastRuns: true,
  };
};

export const buildOddsSnapshotSchedule = ({ raceDate, races, leadMinutes = 7, raceNumbers = [1, 6] }) => {
  if (!isDate(raceDate)) throw new Error("Odds snapshot date is invalid");
  if (!Number.isFinite(leadMinutes) || leadMinutes < 0) throw new Error("Odds snapshot lead time is invalid");

  return raceNumbers.flatMap((raceNumber) => {
    const targetRaces = (races ?? []).filter((race) => Number(race.number) === raceNumber);
    if (!targetRaces.length) return [];

    const starts = targetRaces.map((race) => {
      if (!/^\d{1,2}:\d{2}$/.test(race.time ?? "")) {
        throw new Error(`${race.id ?? `R${raceNumber}`}: race time is missing`);
      }
      const postTime = new Date(`${raceDate}T${race.time}:00+09:00`);
      if (Number.isNaN(postTime.getTime())) throw new Error(`${race.id}: race time is invalid`);
      return { race, postTime };
    }).sort((left, right) => left.postTime - right.postTime);
    const anchor = starts[0];
    const triggerTime = new Date(anchor.postTime.getTime() - leadMinutes * 60_000);

    return [{
      id: `before-${raceNumber}R`,
      raceNumber,
      label: `${raceNumber}R前`,
      anchorRace: `${anchor.race.track}${raceNumber}R`,
      triggerTime: triggerTime.toISOString(),
      postTime: anchor.postTime.toISOString(),
    }];
  }).sort((left, right) => left.triggerTime.localeCompare(right.triggerTime));
};
