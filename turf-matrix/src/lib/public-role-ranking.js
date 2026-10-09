const finite = value => typeof value === 'number' && Number.isFinite(value);
export const publicRoleScore = horse => horse?.aiScore ?? horse?.tmIndex;
export const rankPublicRoleHorses = race => [...(race?.horses ?? [])]
  .filter(horse => finite(publicRoleScore(horse)))
  .sort((a, b) => publicRoleScore(b) - publicRoleScore(a) || (a.number ?? 999) - (b.number ?? 999))
  .map((horse, index, ranked) => {
    const factors = horse.analysis?.factorsDetail ?? {};
    return { horse, rank: index + 1,
      competitionRank: 1 + ranked.filter(other => publicRoleScore(other) > publicRoleScore(horse)).length,
      score: publicRoleScore(horse), leaderGap: publicRoleScore(ranked[0]) - publicRoleScore(horse),
      marketGap: factors.value?.marketGap, ev: factors.value?.ev, valueEligible: factors.value?.eligible === true,
      ability: factors.ability?.score, form: factors.form?.score, training: factors.training?.score,
      pace: factors.pace?.score, distance: factors.distance?.score, course: factors.course?.score };
  });
export const hasCompletePublicDangerMarket = race => {
  const status = race?.oddsStatus ?? race?.dataStatus?.odds;
  if (status != null && status !== 'active') return false;
  const horses = race?.horses ?? [];
  return horses.length > 0 && horses.every(horse => finite(horse.odds) && horse.odds >= 1 &&
    Number.isInteger(horse.popularity) && horse.popularity >= 1);
};
