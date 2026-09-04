const EVIDENCE_FACTOR_KEYS = ["ability", "form", "training", "pace"];
const VALUE_WATCH_MIN_EV = 1.15;
const VALUE_WATCH_MAX_EV = 3.0;
const VALUE_WATCH_MIN_GAP = 2;
const CLEAR_LEADER_MIN_GAP = 3;

const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);
const scoreOf = (horse) => horse?.tmIndex ?? horse?.aiScore ?? horse?.analysis?.tmIndex ?? null;
const valueOf = (horse) => horse?.analysis?.factorsDetail?.value ?? null;
const factorOf = (horse, key) => horse?.analysis?.factorsDetail?.[key] ?? null;
const horseKey = (horse) => horse?.id ?? `${horse?.number}:${horse?.name}`;

const indexRanking = (race) => {
  const horses = [...(race.horses ?? [])];
  const hasPublishedMarket = horses.some((horse) => isFiniteNumber(horse?.odds));
  return horses
  .filter((horse) => isFiniteNumber(scoreOf(horse)) && (!hasPublishedMarket || isFiniteNumber(horse?.odds)))
  .sort((left, right) => scoreOf(right) - scoreOf(left) || left.number - right.number);
};

const evidenceProfile = (horse) => {
  const components = Object.fromEntries(EVIDENCE_FACTOR_KEYS.map((key) => [key, factorOf(horse, key)?.score ?? null]));
  const available = Object.values(components).filter(isFiniteNumber);
  return {
    score: available.length ? available.reduce((sum, value) => sum + value, 0) / available.length : null,
    coverage: available.length / EVIDENCE_FACTOR_KEYS.length,
    components,
  };
};

const evidenceOpponent = (race) => {
  const ranked = indexRanking(race);
  return ranked.slice(2, 5)
    .map((horse) => ({ horse, profile: evidenceProfile(horse) }))
    .filter(({ profile }) => isFiniteNumber(profile.score))
    .sort((left, right) => right.profile.score - left.profile.score
      || right.profile.coverage - left.profile.coverage
      || (valueOf(right.horse)?.ev ?? -Infinity) - (valueOf(left.horse)?.ev ?? -Infinity)
      || scoreOf(right.horse) - scoreOf(left.horse)
      || left.horse.number - right.horse.number)[0] ?? null;
};

const leaderState = (race) => {
  const ranked = indexRanking(race);
  const leader = ranked[0] ?? null;
  const second = ranked[1] ?? null;
  if (!leader) return { status: "missing", gap: null, leader: null, contenders: [] };
  if (!second) return { status: "clear", gap: null, leader, contenders: [leader] };
  const gap = scoreOf(leader) - scoreOf(second);
  return {
    status: gap === 0 ? "tied" : gap >= CLEAR_LEADER_MIN_GAP ? "clear" : "contested",
    gap,
    leader,
    contenders: ranked.filter((horse) => scoreOf(leader) - scoreOf(horse) < CLEAR_LEADER_MIN_GAP),
  };
};

const valueWatch = (race, excluded = new Set()) => [...(race.horses ?? [])]
  .filter((horse) => {
    const value = valueOf(horse);
    return !excluded.has(horseKey(horse))
      && isFiniteNumber(value?.ev)
      && value.ev >= VALUE_WATCH_MIN_EV
      && value.ev < VALUE_WATCH_MAX_EV
      && isFiniteNumber(value?.marketGap)
      && value.marketGap >= VALUE_WATCH_MIN_GAP;
  })
  .sort((left, right) => {
    const leftValue = valueOf(left);
    const rightValue = valueOf(right);
    return rightValue.marketGap - leftValue.marketGap
      || rightValue.ev - leftValue.ev
      || scoreOf(right) - scoreOf(left)
      || left.number - right.number;
  })[0] ?? null;

export {
  EVIDENCE_FACTOR_KEYS,
  CLEAR_LEADER_MIN_GAP,
  VALUE_WATCH_MAX_EV,
  VALUE_WATCH_MIN_EV,
  VALUE_WATCH_MIN_GAP,
  evidenceOpponent,
  evidenceProfile,
  horseKey,
  indexRanking,
  leaderState,
  isFiniteNumber,
  scoreOf,
  valueOf,
  valueWatch,
};
