const isDate = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

export const buildFullRaceRuntimeConfig = ({ raceDate, allRaceSignals, sourceConfig = null }) => {
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

  const withdrawalConfig = {};
  if (sourceConfig) {
    if (sourceConfig.raceDate !== raceDate) throw new Error("Withdrawal config does not match the snapshot date");
    const exclusions = sourceConfig.excludedHorseNumbersByBundle;
    if (exclusions != null) {
      if (typeof exclusions !== "object" || Array.isArray(exclusions)) throw new Error("Withdrawal slots must be a map");
      for (const [bundle, numbers] of Object.entries(exclusions)) {
        if (!bundles.includes(bundle) || !Array.isArray(numbers)
          || numbers.some(number => !Number.isInteger(number) || number < 1 || number > 18)
          || new Set(numbers).size !== numbers.length) {
          throw new Error("Withdrawal slots do not match the full-race field");
        }
      }
      withdrawalConfig.excludedHorseNumbersByBundle = structuredClone(exclusions);
    }
    if (sourceConfig.officialWithdrawals) withdrawalConfig.officialWithdrawals = structuredClone(sourceConfig.officialWithdrawals);
  }

  return {
    raceDate,
    expectedRaceCount: bundles.length,
    bundles,
    provisional: false,
    allowMissingRaceName: true,
    allowMissingPastRuns: true,
    ...withdrawalConfig,
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
