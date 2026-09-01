const finiteNumber = (value) => Number.isFinite(Number(value)) ? Number(value) : null;

const payoutNumbers = (entry) => {
  const values = entry?.numbers ?? entry?.HorseNumbers ?? entry?.horseNumbers;
  if (Array.isArray(values)) return values.map(finiteNumber).filter((value) => value != null);
  const first = finiteNumber(entry?.firstNumber ?? entry?.FirstNumber);
  const second = finiteNumber(entry?.secondNumber ?? entry?.SecondNumber);
  return [first, second].filter((value) => value != null);
};

const sortedPair = (first, second) => [finiteNumber(first), finiteNumber(second)]
  .filter((value) => value != null)
  .sort((a, b) => a - b);

const widePayoutEntries = (race) => {
  if (Object.prototype.hasOwnProperty.call(race?.payouts ?? {}, "wide")) {
    return { available: true, entries: race.payouts.wide ?? [] };
  }
  const entries = (race?.Payouts ?? []).filter((entry) => entry.Type === "wide");
  return { available: entries.length > 0, entries };
};

const widePayoutFor = (race, first, second) => {
  const target = sortedPair(first, second);
  const source = widePayoutEntries(race);
  if (!source.available || target.length !== 2) return { available: false, hit: false, payout: 0 };
  const match = source.entries.find((entry) => {
    const pair = payoutNumbers(entry).sort((a, b) => a - b);
    return pair.length === 2 && pair[0] === target[0] && pair[1] === target[1];
  });
  return {
    available: true,
    hit: Boolean(match),
    payout: finiteNumber(match?.payout ?? match?.Payout) ?? 0,
  };
};

export { payoutNumbers, widePayoutEntries, widePayoutFor };
