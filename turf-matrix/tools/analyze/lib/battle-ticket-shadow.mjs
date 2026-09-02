import { quinellaPayoutFor, widePayoutFor } from "../../result-payouts.mjs";

const finite = (value) => typeof value === "number" && Number.isFinite(value);
const normalizeName = (value) => String(value ?? "").normalize("NFKC").replace(/[\s\u3000]/g, "");

const horseResult = (horse, race) => {
  const result = (race?.horses ?? []).find((item) => Number(item.horseNumber) === Number(horse?.number));
  return result && normalizeName(result.horseName) === normalizeName(horse.name) ? result : null;
};

const singlePayoutFor = (race, horse) => {
  const result = horseResult(horse, race);
  if (!result || !finite(result.finishPosition) || !finite(result.winPayout)) {
    return { available: false, hit: false, payout: 0 };
  }
  return { available: true, hit: result.finishPosition === 1, payout: result.winPayout };
};

export const evaluateBattleTicket = (item, race) => {
  if (item?.type === "win") return { ...item, ...singlePayoutFor(race, item.horses?.[0]) };
  if (item?.type === "quinella") {
    if (!(item.horses ?? []).every((horse) => finite(horseResult(horse, race)?.finishPosition))) {
      return { ...item, available: false, hit: false, payout: 0 };
    }
    return { ...item, ...quinellaPayoutFor(race, item.horses?.[0]?.number, item.horses?.[1]?.number) };
  }
  if (item?.type === "wide") {
    if (!(item.horses ?? []).every((horse) => finite(horseResult(horse, race)?.finishPosition))) {
      return { ...item, available: false, hit: false, payout: 0 };
    }
    return { ...item, ...widePayoutFor(race, item.horses?.[0]?.number, item.horses?.[1]?.number) };
  }
  return { ...item, available: false, hit: false, payout: 0 };
};

export const evaluateBattleTicketPlan = (plan, race) => {
  if (!plan) return null;
  const tickets = (plan.tickets ?? []).map((item) => evaluateBattleTicket(item, race));
  const complete = tickets.every((item) => item.available);
  const comparable = tickets.filter((item) => item.available);
  const stake = comparable.reduce((sum, item) => sum + item.units * 100, 0);
  const returnAmount = comparable.reduce((sum, item) => sum + item.payout * item.units, 0);
  return {
    status: plan.status,
    complete,
    plannedTicketCount: tickets.length,
    comparableTicketCount: comparable.length,
    stake,
    return: returnAmount,
    profit: returnAmount - stake,
    hits: comparable.filter((item) => item.hit).length,
    roi: stake ? returnAmount / stake * 100 : null,
    tickets,
  };
};

export const aggregateBattleTicketRows = (rows) => {
  const stake = rows.reduce((sum, row) => sum + row.stake, 0);
  const returnAmount = rows.reduce((sum, row) => sum + row.return, 0);
  const types = ["win", "quinella", "wide"];
  return {
    days: rows.length,
    betDays: rows.filter((row) => row.stake > 0).length,
    skippedDays: rows.filter((row) => row.stake === 0).length,
    hitDays: rows.filter((row) => row.hits > 0).length,
    tickets: rows.reduce((sum, row) => sum + row.comparableTicketCount, 0),
    hits: rows.reduce((sum, row) => sum + row.hits, 0),
    stake,
    return: returnAmount,
    profit: returnAmount - stake,
    roi: stake ? returnAmount / stake * 100 : null,
    byType: Object.fromEntries(types.map((type) => {
      const tickets = rows.flatMap((row) => row.tickets).filter((item) => item.available && item.type === type);
      const typeStake = tickets.reduce((sum, item) => sum + item.units * 100, 0);
      const typeReturn = tickets.reduce((sum, item) => sum + item.payout * item.units, 0);
      return [type, {
        tickets: tickets.length,
        hits: tickets.filter((item) => item.hit).length,
        stake: typeStake,
        return: typeReturn,
        roi: typeStake ? typeReturn / typeStake * 100 : null,
      }];
    })),
  };
};
