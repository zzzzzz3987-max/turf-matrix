import { buildPublicBattleTicketPlan } from './public-battle-ticket-plan.mjs';

export const publicBattlePostTime = race => {
  const date = race?.id?.match(/^(\d{4}-\d{2}-\d{2})-/)?.[1];
  return date && /^\d{2}:\d{2}$/.test(race.time ?? '')
    ? Date.parse(`${date}T${race.time}:00+09:00`) : NaN;
};

export const validPublicBattleSnapshot = (snapshot, raceDate) => {
  const race = snapshot?.race;
  const postTime = publicBattlePostTime(race);
  const capturedAt = Date.parse(snapshot?.capturedAt);
  return snapshot?.schemaVersion === 1 && snapshot.raceDate === raceDate
    && race?.id?.startsWith(`${raceDate}-`) && Number.isFinite(postTime)
    && Number.isFinite(capturedAt) && capturedAt < postTime
    && snapshot.postTime === new Date(postTime).toISOString()
    && race.oddsStatus === 'active'
    && race.publicTicketPlan?.status === 'ready'
    && race.publicTicketPlan.axis?.number === race.indexTop?.number
    && race.publicTicketPlan.tickets?.length > 0;
};

export const buildPublicBattleSnapshot = ({ raceDate, selectedRace, previous, now = Date.now(), provenance = null }) => {
  const saved = previous?.date === raceDate ? previous.battleRaceSnapshot : null;
  // After the race starts, retain only an actual pre-start public selection.
  if (validPublicBattleSnapshot(saved, raceDate) && now >= publicBattlePostTime(saved.race)) return saved;
  const postTime = publicBattlePostTime(selectedRace);
  if (!selectedRace?.id?.startsWith(`${raceDate}-`) || !Number.isFinite(postTime)
      || !Number.isFinite(now) || now >= postTime) return null;
  const plan = buildPublicBattleTicketPlan(selectedRace);
  if (plan.status !== 'ready') return null;
  return {
    schemaVersion: 1, raceDate, capturedAt: new Date(now).toISOString(),
    postTime: new Date(postTime).toISOString(),
    race: { ...structuredClone(selectedRace), publicTicketPlan: plan },
    ...(provenance ? { provenance } : {}),
  };
};

export const publicBattleRaceForDisplay = signals => {
  const snapshot = signals?.battleRaceSnapshot;
  if (validPublicBattleSnapshot(snapshot, signals?.date)) return { race: snapshot.race, snapshot };
  return { race: signals?.races?.find(race => race.id === signals.battleRaceId) ?? null, snapshot: null };
};
