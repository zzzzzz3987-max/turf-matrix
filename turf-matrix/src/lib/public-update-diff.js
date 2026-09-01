import { buildHorseRiskFlags, buildRacePublicConclusion } from "./public-view-model.js";

const ROLE_LABELS = {
  favorite: "本命",
  challenger: "逆転候補",
  value: "注目穴",
  danger: "人気馬注意",
};

const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);
const scoreFor = (horse) => horse?.aiScore ?? horse?.tmIndex;
const raceDateFor = (data) => data?.meta?.date ?? data?.races?.[0]?.id?.slice(0, 10) ?? null;

const parseTime = (value) => {
  const time = value ? new Date(value).getTime() : Number.NaN;
  return Number.isFinite(time) ? time : null;
};

const latestTimestamp = (values) => values
  .map((value) => ({ value, time: parseTime(value) }))
  .filter((entry) => entry.time != null)
  .sort((left, right) => right.time - left.time)[0]?.value ?? null;

const dataUpdatedAt = (data) => latestTimestamp([
  data?.generatedAt,
  data?.meta?.updatedAt,
  data?.meta?.oddsUpdatedAt,
  ...(data?.races ?? []).flatMap((race) => [race.oddsUpdatedAt, race.goingUpdatedAt]),
]);

const raceUpdatedAt = (race, data) => latestTimestamp([
  race?.updatedAt,
  race?.oddsUpdatedAt,
  race?.goingUpdatedAt,
  data?.meta?.oddsUpdatedAt,
]);

const horseKey = (horse) => horse?.id ?? `${horse?.number ?? "?"}|${horse?.name ?? "?"}`;

const rankRaceHorses = (race) => [...(race?.horses ?? [])]
  .filter((horse) => isFiniteNumber(scoreFor(horse)))
  .sort((left, right) => scoreFor(right) - scoreFor(left) || (left.number ?? 999) - (right.number ?? 999))
  .map((horse, index) => ({ horse, rank: index + 1 }));

const roleMapFor = (race) => {
  const conclusion = buildRacePublicConclusion(race);
  const roles = new Map();
  for (const key of Object.keys(ROLE_LABELS)) {
    const horse = conclusion?.[key]?.horse;
    if (horse?.id) roles.set(horse.id, { key, label: ROLE_LABELS[key] });
  }
  return roles;
};

const eventId = (type, horse, suffix = "") => [type, horse ? horseKey(horse) : "race", suffix]
  .filter(Boolean)
  .join(":");

const horseEvent = ({ type, priority, horse, label, before, after, tone = "neutral", detail = null }) => ({
  id: eventId(type, horse, `${before ?? ""}-${after ?? ""}`),
  type,
  priority,
  horseId: horse?.id ?? null,
  horseNumber: horse?.number ?? null,
  horseName: horse?.name ?? null,
  label,
  before,
  after,
  tone,
  detail,
});

const raceEvent = ({ type, priority, label, before, after, tone = "neutral" }) => ({
  id: eventId(type, null, `${before ?? ""}-${after ?? ""}`),
  type,
  priority,
  horseId: null,
  horseNumber: null,
  horseName: null,
  label,
  before,
  after,
  tone,
  detail: null,
});

const compareRace = (previousRace, currentRace, previousData, currentData) => {
  const previousRanked = rankRaceHorses(previousRace);
  const currentRanked = rankRaceHorses(currentRace);
  const previousByKey = new Map((previousRace.horses ?? []).map((horse) => [horseKey(horse), horse]));
  const currentByKey = new Map((currentRace.horses ?? []).map((horse) => [horseKey(horse), horse]));
  const previousRanks = new Map(previousRanked.map(({ horse, rank }) => [horseKey(horse), rank]));
  const currentRanks = new Map(currentRanked.map(({ horse, rank }) => [horseKey(horse), rank]));
  const previousRoles = roleMapFor(previousRace);
  const currentRoles = roleMapFor(currentRace);
  const events = [];

  if (previousRace.going && currentRace.going && previousRace.going !== currentRace.going) {
    events.push(raceEvent({
      type: "going",
      priority: 0,
      label: "馬場",
      before: previousRace.going,
      after: currentRace.going,
      tone: "condition",
    }));
  }
  if (previousRace.weather && currentRace.weather && previousRace.weather !== currentRace.weather) {
    events.push(raceEvent({
      type: "weather",
      priority: 1,
      label: "天候",
      before: previousRace.weather,
      after: currentRace.weather,
      tone: "condition",
    }));
  }

  const changedRoleHorses = new Set();
  const roleHorseIds = new Set([...previousRoles.keys(), ...currentRoles.keys()]);
  for (const horseId of roleHorseIds) {
    const previousRole = previousRoles.get(horseId) ?? null;
    const currentRole = currentRoles.get(horseId) ?? null;
    if (previousRole?.key === currentRole?.key) continue;
    const horse = currentByKey.get(horseId) ?? previousByKey.get(horseId);
    if (!horse) continue;
    changedRoleHorses.add(horseKey(horse));
    events.push(horseEvent({
      type: "role",
      priority: 2,
      horse,
      label: currentRole ? `${currentRole.label}に更新` : `${previousRole.label}から変更`,
      before: previousRole?.label ?? "候補外",
      after: currentRole?.label ?? "候補外",
      tone: currentRole?.key === "danger" ? "warning" : "accent",
    }));
  }

  const importantKeys = new Set([
    ...roleHorseIds,
    ...previousRanked.slice(0, 5).map(({ horse }) => horseKey(horse)),
    ...currentRanked.slice(0, 5).map(({ horse }) => horseKey(horse)),
  ]);

  for (const key of importantKeys) {
    const previousHorse = previousByKey.get(key);
    const currentHorse = currentByKey.get(key);
    if (!previousHorse || !currentHorse) continue;

    const previousRank = previousRanks.get(key);
    const currentRank = currentRanks.get(key);
    if (previousRank !== currentRank && !changedRoleHorses.has(key)) {
      events.push(horseEvent({
        type: "index_rank",
        priority: 3,
        horse: currentHorse,
        label: "指数順位",
        before: `${previousRank}位`,
        after: `${currentRank}位`,
        tone: currentRank < previousRank ? "accent" : "neutral",
      }));
    }

    const previousRisks = new Map(buildHorseRiskFlags(previousHorse, { limit: 10 }).map((flag) => [flag.key, flag]));
    const currentRisks = new Map(buildHorseRiskFlags(currentHorse, { limit: 10 }).map((flag) => [flag.key, flag]));
    for (const [riskKey, risk] of currentRisks) {
      if (previousRisks.has(riskKey)) continue;
      events.push(horseEvent({
        type: "risk_added",
        priority: 4,
        horse: currentHorse,
        label: `${risk.label}を追加`,
        before: "なし",
        after: risk.label,
        tone: "warning",
        detail: risk.detail,
      }));
    }
    for (const [riskKey, risk] of previousRisks) {
      if (currentRisks.has(riskKey)) continue;
      events.push(horseEvent({
        type: "risk_removed",
        priority: 5,
        horse: currentHorse,
        label: `${risk.label}を解除`,
        before: risk.label,
        after: "なし",
        tone: "positive",
      }));
    }

    if (
      isFiniteNumber(previousHorse.popularity) &&
      isFiniteNumber(currentHorse.popularity) &&
      previousHorse.popularity !== currentHorse.popularity
    ) {
      events.push(horseEvent({
        type: "popularity",
        priority: 6,
        horse: currentHorse,
        label: "人気",
        before: `${previousHorse.popularity}人気`,
        after: `${currentHorse.popularity}人気`,
      }));
    }

    if (isFiniteNumber(previousHorse.odds) && isFiniteNumber(currentHorse.odds) && previousHorse.odds > 0) {
      const absoluteChange = Math.abs(currentHorse.odds - previousHorse.odds);
      const relativeChange = absoluteChange / previousHorse.odds;
      if (absoluteChange >= 0.5 && relativeChange >= 0.1) {
        events.push(horseEvent({
          type: "odds",
          priority: 7,
          horse: currentHorse,
          label: "単勝オッズ",
          before: `${previousHorse.odds.toFixed(1)}倍`,
          after: `${currentHorse.odds.toFixed(1)}倍`,
        }));
      }
    }
  }

  const stableEvents = events
    .sort((left, right) =>
      left.priority - right.priority ||
      (left.horseNumber ?? 999) - (right.horseNumber ?? 999) ||
      left.type.localeCompare(right.type, "ja")
    )
    .slice(0, 24);

  return stableEvents.length ? {
    raceId: currentRace.id,
    previousUpdatedAt: raceUpdatedAt(previousRace, previousData),
    currentUpdatedAt: raceUpdatedAt(currentRace, currentData),
    events: stableEvents,
  } : null;
};

export const buildPublicUpdateDiff = (previousData, currentData) => {
  const raceDate = raceDateFor(currentData);
  const previousRaceDate = raceDateFor(previousData);
  const previousUpdatedAt = dataUpdatedAt(previousData);
  const currentUpdatedAt = dataUpdatedAt(currentData);
  const empty = {
    schemaVersion: 1,
    raceDate,
    previousUpdatedAt: previousRaceDate === raceDate ? previousUpdatedAt : null,
    currentUpdatedAt,
    generatedAt: currentUpdatedAt,
    races: [],
  };

  if (!raceDate || previousRaceDate !== raceDate) return empty;
  const previousRaces = new Map((previousData?.races ?? []).map((race) => [race.id, race]));
  const races = (currentData?.races ?? [])
    .map((race) => previousRaces.has(race.id)
      ? compareRace(previousRaces.get(race.id), race, previousData, currentData)
      : null)
    .filter(Boolean);

  return { ...empty, races };
};

export const updateDiffForRace = (payload, raceId, raceDate) => {
  if (!payload || payload.raceDate !== raceDate) return null;
  return payload.races?.find((race) => race.raceId === raceId) ?? null;
};
