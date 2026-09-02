const finiteNumber = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
const normalizeType = (value) => String(value ?? "").toLowerCase();
const normalizePair = (first, second) => [finiteNumber(first), finiteNumber(second)]
  .filter((value) => value != null)
  .sort((left, right) => left - right);

export const pairOddsKey = ({ track, raceNo, type, first, second }) => {
  const pair = normalizePair(first, second);
  if (!track || !finiteNumber(raceNo) || !["quinella", "wide"].includes(normalizeType(type)) || pair.length !== 2) return null;
  return `${track}|${Number(raceNo)}|${normalizeType(type)}|${pair[0]}-${pair[1]}`;
};

export const buildPairOddsIndex = (payload) => {
  const index = new Map();
  for (const raceOdds of payload?.Races ?? payload?.races ?? []) {
    const race = raceOdds.Race ?? raceOdds.race ?? {};
    const track = race.CourseName ?? race.courseName ?? race.track;
    const raceNo = finiteNumber(race.RaceNo ?? race.raceNo ?? race.number);
    const type = normalizeType(raceOdds.Type ?? raceOdds.type);
    for (const entry of raceOdds.Entries ?? raceOdds.entries ?? []) {
      const numbers = entry.HorseNumbers ?? entry.horseNumbers ?? entry.numbers ?? [];
      const key = pairOddsKey({ track, raceNo, type, first: numbers[0], second: numbers[1] });
      if (!key) continue;
      index.set(key, {
        type,
        numbers: normalizePair(numbers[0], numbers[1]),
        minOdds: finiteNumber(entry.MinOdds ?? entry.minOdds ?? entry.odds),
        maxOdds: finiteNumber(entry.MaxOdds ?? entry.maxOdds ?? entry.odds),
        popularity: finiteNumber(entry.Popularity ?? entry.popularity),
        updatedAt: raceOdds.UpdatedAt ?? raceOdds.updatedAt ?? null,
        source: raceOdds.Source ?? raceOdds.source ?? payload.Source ?? payload.source ?? null,
        status: raceOdds.Status ?? raceOdds.status ?? null,
      });
    }
  }
  return index;
};

export const pairOddsFor = (index, query) => {
  const key = pairOddsKey(query);
  return key ? index.get(key) ?? null : null;
};
