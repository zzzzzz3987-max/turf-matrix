const finite = (value) => typeof value === "number" && Number.isFinite(value);
const between = (value, minimum, maximum) => finite(value) && value >= minimum && value <= maximum;

export const BATTLE_TICKET_RULE_VERSION = "battle-ticket-shadow-v1";
export const BATTLE_TICKET_THRESHOLDS = Object.freeze({
  readiness: 74,
  readinessCoverage: 0.75,
  winOddsMin: 1.5,
  winOddsMax: 30,
  winEvMin: 0.9,
  winEvMax: 3,
  quinellaOpponentIndex: 75,
  quinellaMaxIndexSpread: 6,
  quinellaOddsMin: 4,
  wideOpponentIndex: 68,
  wideEvidenceScore: 68,
  wideEvidenceCoverage: 0.75,
  wideMaxIndexSpread: 12,
  wideOddsMin: 2,
});

const ticket = (type, horses, rationale, market = null) => ({
  type,
  horses: horses.map((horse) => ({ number: horse.number, name: horse.name })),
  units: 1,
  rationale,
  market,
});

const finishPlan = (tickets, reasons, rejected = []) => ({
  ruleVersion: BATTLE_TICKET_RULE_VERSION,
  status: tickets.length ? "bet" : "skip",
  tickets,
  reasons,
  rejected,
  totalUnits: tickets.reduce((sum, item) => sum + item.units, 0),
});

export const buildBaselineBattleTicketPlan = (race) => {
  const axis = race?.indexTop;
  if (!axis) return finishPlan([], ["勝負レースまたは軸馬が未確定"]);
  const opponent1 = race.opponents?.[0];
  const opponent2 = race.opponents?.[1];
  const tickets = [ticket("win", [axis], "現行表示の軸単勝", { minOdds: axis.odds, maxOdds: axis.odds })];
  if (opponent1) tickets.push(ticket("quinella", [axis, opponent1], "現行表示の軸－相手1馬連", race.ticketOdds?.quinella ?? null));
  if (opponent2) tickets.push(ticket("wide", [axis, opponent2], "現行表示の軸－相手2ワイド", race.ticketOdds?.wide ?? null));
  return finishPlan(tickets, ["現行の公開買い目を再現"]);
};

export const buildBattleTicketPlan = (race) => {
  const axis = race?.indexTop;
  if (!axis) return finishPlan([], ["勝負レースまたは軸馬が未確定"]);

  const opponent1 = race.opponents?.[0];
  const opponent2 = race.opponents?.[1];
  const profile = race.battleProfile;
  const reasons = [];
  const rejected = [];
  const tickets = [];
  const marketReady = race.oddsStatus === "active" && finite(axis.odds) && finite(axis.ev);
  const readinessReady = finite(profile?.score)
    && profile.score >= BATTLE_TICKET_THRESHOLDS.readiness
    && finite(profile.coverage)
    && profile.coverage >= BATTLE_TICKET_THRESHOLDS.readinessCoverage;

  if (!marketReady) reasons.push("軸の実オッズまたは期待値が未取得");
  if (!readinessReady) reasons.push("勝負度または分析充足率が基準未満");
  if (!marketReady || !readinessReady) return finishPlan([], reasons);

  if (between(axis.odds, BATTLE_TICKET_THRESHOLDS.winOddsMin, BATTLE_TICKET_THRESHOLDS.winOddsMax)
      && axis.ev >= BATTLE_TICKET_THRESHOLDS.winEvMin
      && axis.ev < BATTLE_TICKET_THRESHOLDS.winEvMax) {
    tickets.push(ticket("win", [axis], "指数首位の強さと単勝期待値が両立", { minOdds: axis.odds, maxOdds: axis.odds }));
  } else {
    rejected.push("単勝: オッズまたは期待値が採用帯外");
  }

  const opponent1Spread = opponent1 ? axis.tmIndex - opponent1.tmIndex : null;
  const quinellaOdds = race.ticketOdds?.quinella;
  if (opponent1
      && finite(opponent1.odds)
      && finite(opponent1.tmIndex)
      && opponent1.tmIndex >= BATTLE_TICKET_THRESHOLDS.quinellaOpponentIndex
      && between(opponent1Spread, 0, BATTLE_TICKET_THRESHOLDS.quinellaMaxIndexSpread)
      && quinellaOdds?.status === "active"
      && finite(quinellaOdds.minOdds)
      && quinellaOdds.minOdds >= BATTLE_TICKET_THRESHOLDS.quinellaOddsMin) {
    tickets.push(ticket("quinella", [axis, opponent1], "指数2位の地力と首位との差、馬連オッズが基準内", quinellaOdds));
  } else {
    rejected.push("馬連: 相手1の指数、首位との差、または組み合わせオッズが基準未満");
  }

  const opponent2Spread = opponent2 ? axis.tmIndex - opponent2.tmIndex : null;
  const wideOdds = race.ticketOdds?.wide;
  if (opponent2
      && finite(opponent2.odds)
      && finite(opponent2.tmIndex)
      && opponent2.tmIndex >= BATTLE_TICKET_THRESHOLDS.wideOpponentIndex
      && finite(opponent2.selectionScore)
      && opponent2.selectionScore >= BATTLE_TICKET_THRESHOLDS.wideEvidenceScore
      && finite(opponent2.selectionCoverage)
      && opponent2.selectionCoverage >= BATTLE_TICKET_THRESHOLDS.wideEvidenceCoverage
      && between(opponent2Spread, 0, BATTLE_TICKET_THRESHOLDS.wideMaxIndexSpread)
      && wideOdds?.status === "active"
      && finite(wideOdds.minOdds)
      && wideOdds.minOdds >= BATTLE_TICKET_THRESHOLDS.wideOddsMin) {
    tickets.push(ticket("wide", [axis, opponent2], "相手2の総合Evidence、分析充足率、ワイド下限オッズが基準内", wideOdds));
  } else {
    rejected.push("ワイド: 相手2の指数、Evidence、分析充足率、または組み合わせオッズが基準未満");
  }

  if (tickets.length) reasons.push(`${tickets.length}券種だけを採用`);
  else reasons.push("採用条件を満たす券種なし");
  return finishPlan(tickets, reasons, rejected);
};

export const battleTicketKey = (item) => `${item.type}:${item.horses.map((horse) => horse.number).sort((a, b) => a - b).join("-")}`;

export const sameBattleTicketPlan = (left, right) => {
  const leftKeys = (left?.tickets ?? []).map(battleTicketKey).sort();
  const rightKeys = (right?.tickets ?? []).map(battleTicketKey).sort();
  return JSON.stringify(leftKeys) === JSON.stringify(rightKeys);
};
