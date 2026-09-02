const finite = (value) => typeof value === "number" && Number.isFinite(value);

export const publicRoleScore = (horse) => horse?.aiScore ?? horse?.tmIndex;

const factorScore = (horse, key) => horse?.analysis?.factorsDetail?.[key]?.score;
const valueData = (horse) => horse?.analysis?.factorsDetail?.value ?? {};

export const rankPublicRoleHorses = (race) => [...(race?.horses ?? [])]
  .filter((horse) => finite(publicRoleScore(horse)))
  .sort((left, right) =>
    publicRoleScore(right) - publicRoleScore(left) ||
    (left.number ?? 999) - (right.number ?? 999)
  )
  .map((horse, index, ranked) => ({
    horse,
    rank: index + 1,
    score: publicRoleScore(horse),
    leaderGap: publicRoleScore(ranked[0]) - publicRoleScore(horse),
    marketGap: valueData(horse).marketGap,
    ev: valueData(horse).ev,
    valueEligible: valueData(horse).eligible === true,
    ability: factorScore(horse, "ability"),
    form: factorScore(horse, "form"),
    training: factorScore(horse, "training"),
    pace: factorScore(horse, "pace"),
    distance: factorScore(horse, "distance"),
    course: factorScore(horse, "course"),
  }));

export const publicRoleEvidenceScore = (candidate) => {
  const weighted = [
    [candidate.ability, 0.30],
    [candidate.form, 0.25],
    [candidate.training, 0.15],
    [candidate.pace, 0.15],
    [candidate.distance, 0.10],
    [candidate.course, 0.05],
  ].filter(([value]) => finite(value));
  const totalWeight = weighted.reduce((sum, [, weight]) => sum + weight, 0);
  return totalWeight
    ? weighted.reduce((sum, [value, weight]) => sum + value * weight, 0) / totalWeight
    : null;
};

const isValueCandidate = (candidate) =>
  candidate.rank > 2 &&
  candidate.valueEligible &&
  finite(candidate.marketGap) &&
  candidate.marketGap >= 2;

export const selectPublicValueHorse = (race) => rankPublicRoleHorses(race)
  .filter(isValueCandidate)
  .sort((left, right) =>
    right.marketGap - left.marketGap ||
    right.score - left.score ||
    (left.horse.number ?? 999) - (right.horse.number ?? 999)
  )[0]?.horse ?? null;

// Candidate v2 stays in shadow until fresh pre-race samples pass the adoption gate.
export const selectPublicValueEvidenceHorse = (race) => rankPublicRoleHorses(race)
  .filter((candidate) => isValueCandidate(candidate) && candidate.rank <= 5)
  .sort((left, right) =>
    (publicRoleEvidenceScore(right) ?? -Infinity) - (publicRoleEvidenceScore(left) ?? -Infinity) ||
    right.score - left.score ||
    (left.horse.number ?? 999) - (right.horse.number ?? 999)
  )[0]?.horse ?? null;

export const selectPublicDangerHorse = (race) => rankPublicRoleHorses(race)
  .filter((candidate) =>
    finite(candidate.horse.popularity) &&
    candidate.horse.popularity <= 4 &&
    candidate.rank - candidate.horse.popularity >= 3
  )
  .sort((left, right) =>
    (right.rank - right.horse.popularity) - (left.rank - left.horse.popularity) ||
    right.leaderGap - left.leaderGap ||
    (left.horse.number ?? 999) - (right.horse.number ?? 999)
  )[0]?.horse ?? null;

export const selectPublicRoleHorses = (race) => ({
  value: selectPublicValueHorse(race),
  danger: selectPublicDangerHorse(race),
});
