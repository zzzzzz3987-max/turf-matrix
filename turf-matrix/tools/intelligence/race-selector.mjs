// Deterministic race-level selection for multi-race week data.

const GRADE_PRIORITY = {
  GI: 500,
  G1: 500,
  GII: 450,
  G2: 450,
  GIII: 400,
  G3: 400,
};

const gradePriority = (grade) => GRADE_PRIORITY[String(grade ?? "").trim().toUpperCase()] ?? 0;

const topIndex = (race) => {
  const scores = (race?.horses ?? [])
    .map((horse) => horse.tmIndex ?? horse.aiScore)
    .filter((score) => Number.isFinite(score));
  return scores.length ? Math.max(...scores) : 0;
};

const scoreRacePriority = (race) =>
  Number(race?.featuredPriority ?? 0) +
  gradePriority(race?.grade) +
  (race?.category === "special" || race?.isSpecial === true ? 100 : 0) +
  topIndex(race) / 100;

const selectFeaturedRace = (weekData) => {
  const races = weekData?.races ?? [];
  if (!races.length) return null;

  const explicit = races.find((race) => race.id === weekData?.meta?.featuredRaceId);
  if (explicit) return explicit;

  const flagged = races.find((race) => race.featured === true || race.isFeatured === true);
  if (flagged) return flagged;

  return [...races].sort(
    (left, right) =>
      scoreRacePriority(right) - scoreRacePriority(left) ||
      Number(right.number ?? 0) - Number(left.number ?? 0) ||
      String(left.id ?? "").localeCompare(String(right.id ?? ""), "ja")
  )[0];
};

export { gradePriority, scoreRacePriority, selectFeaturedRace };
