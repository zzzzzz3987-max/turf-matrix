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

const pairPayoutEntries = (race, type) => {
  if (Object.prototype.hasOwnProperty.call(race?.payouts ?? {}, type)) {
    return { available: true, entries: race.payouts[type] ?? [] };
  }
  const entries = (race?.Payouts ?? []).filter((entry) => entry.Type === type);
  return { available: entries.length > 0, entries };
};

const pairPayoutFor = (race, type, first, second) => {
  const target = sortedPair(first, second);
  const source = pairPayoutEntries(race, type);
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

const quinellaPayoutEntries = (race) => pairPayoutEntries(race, "quinella");
const widePayoutEntries = (race) => pairPayoutEntries(race, "wide");
const quinellaPayoutFor = (race, first, second) => pairPayoutFor(race, "quinella", first, second);
const widePayoutFor = (race, first, second) => pairPayoutFor(race, "wide", first, second);

export {
  payoutNumbers,
  pairPayoutEntries,
  pairPayoutFor,
  quinellaPayoutEntries,
  quinellaPayoutFor,
  widePayoutEntries,
  widePayoutFor,
};
