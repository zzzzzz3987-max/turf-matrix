const finite = Number.isFinite;

// Keep this public format separate from the historical win/quinella/wide shadow.
export const buildPublicBattleTicketPlan = (race) => {
  const axis = race?.indexTop;
  const plan = { ruleVersion: 'public-win-trio-v1', axis: axis ?? null, opponents: [], valueHorse: null, tickets: [], totalUnits: 0, status: 'pending' };
  if (!axis || !Number.isInteger(axis.number) || !finite(axis.tmIndex)
      || !finite(axis.odds) || axis.odds <= 0 || race.oddsStatus !== 'active') return plan;

  const seen = new Set([axis.number]);
  const candidates = [...(race.battleCandidates ?? [])]
    .filter(horse => Number.isInteger(horse.number) && horse.number > 0
      && finite(horse.odds) && horse.odds > 0 && finite(horse.tmIndex)
      && horse.tmIndex >= 68 && axis.tmIndex - horse.tmIndex >= 0
      && axis.tmIndex - horse.tmIndex <= 12)
    .sort((a, b) => b.tmIndex - a.tmIndex || a.number - b.number);
  for (const horse of candidates) {
    if (seen.has(horse.number)) continue;
    seen.add(horse.number);
    plan.opponents.push(horse);
    if (plan.opponents.length === 3) break;
  }
  const valueHorse = race.valueWatch;
  if (Number.isInteger(valueHorse?.number)
      && !seen.has(valueHorse.number)
      && finite(valueHorse.tmIndex)
      && finite(valueHorse.odds) && valueHorse.odds > 0
      && finite(valueHorse.ev) && valueHorse.ev >= 1.15 && valueHorse.ev < 3
      && finite(valueHorse.marketGap) && valueHorse.marketGap >= 2) {
    plan.valueHorse = valueHorse;
    seen.add(valueHorse.number);
  }

  const partners = [...plan.opponents, ...(plan.valueHorse ? [plan.valueHorse] : [])];
  plan.tickets.push({ type: 'win', numbers: [axis.number], units: 1 });
  for (let i = 0; i < partners.length; i++) {
    for (let j = i + 1; j < partners.length; j++) {
      plan.tickets.push({ type: 'trio', numbers: [axis.number, partners[i].number, partners[j].number].sort((a, b) => a - b), units: 1 });
    }
  }
  // Do not display selections that cannot form a trio on their own.
  if (partners.length < 2) {
    plan.opponents = [];
    plan.valueHorse = null;
  }
  plan.totalUnits = plan.tickets.length;
  plan.status = 'ready';
  return plan;
};
