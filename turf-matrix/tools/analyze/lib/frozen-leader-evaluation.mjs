const normalizeName = (value) => String(value ?? "").normalize("NFKC").replace(/\s/g, "");

// Callers must validate their frozen artifact before joining results.
export const evaluateFrozenLeaders = (artifact, results) => {
  if (results.date !== artifact.raceDate) throw new Error("Result date mismatch");
  const evaluated = [];
  const skipped = [];
  for (const race of artifact.predictions) {
    const matches = (results.races ?? []).filter((result) => (result.bundleId ?? result.id) === race.raceId);
    if (matches.length !== 1) { skipped.push({ raceId: race.raceId, reason: "Missing or duplicate race result" }); continue; }
    const horses = race.horses.map((horse) => {
      const found = (matches[0].horses ?? []).filter((result) => Number(result.horseNumber ?? result.number) === horse.number);
      const result = found.length === 1 ? found[0] : null;
      if (!result || normalizeName(result.horseName ?? result.name) !== normalizeName(horse.name) ||
          !Number.isInteger(result.finishPosition) || result.finishPosition < 1 ||
          result.finishPosition > race.horses.length ||
          !Number.isFinite(result.winPayout) || result.winPayout < 0 ||
          !Number.isFinite(result.placePayout) || result.placePayout < 0) return null;
      return { ...horse, result };
    });
    // Do not replace a missing frozen leader with a lower-ranked finisher.
    if (horses.some((horse) => !horse)) { skipped.push({ raceId: race.raceId, reason: "Incomplete results, non-finish or identity mismatch" }); continue; }
    const metric = (number) => {
      const horse = horses.find((item) => item.number === number);
      if (!horse) throw new Error("Frozen leader not in prediction");
      return {
        number, name: horse.name, finish: horse.result.finishPosition,
        win: horse.result.finishPosition === 1, place: horse.result.placePayout > 0,
        winReturn: horse.result.winPayout, placeReturn: horse.result.placePayout,
      };
    };
    evaluated.push({ raceId: race.raceId, leaderChanged: race.leaderChanged, current: metric(race.currentLeader), shadow: metric(race.shadowLeader) });
  }
  const summary = Object.fromEntries(["current", "shadow"].map((mode) => [mode, {
    races: evaluated.length,
    wins: evaluated.filter((race) => race[mode].win).length,
    placeHits: evaluated.filter((race) => race[mode].place).length,
    winReturn: evaluated.reduce((sum, race) => sum + race[mode].winReturn, 0),
    placeReturn: evaluated.reduce((sum, race) => sum + race[mode].placeReturn, 0),
  }]));
  return { raceDate: artifact.raceDate, productionConnected: false, adoptionDecision: "manual-review-required", summary, evaluated, skipped };
};
