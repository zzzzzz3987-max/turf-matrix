const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// JRA weight-for-age allowances for open-class flat races. Values in
// parentheses on the official table are used for non-open races.
const THREE_YEAR_OLD_ALLOWANCE = Object.freeze({
  sprint: [7, 6, 5, 4, 4, 3, 3, 2, 2, 1, 1, 1],
  mile: [8, 7, 6, 5, 4, 4, 3, 3, 2, 2, 1, 1],
  middle: [9, 8, 7, 6, 5, 4, 4, 3, 3, 2, 2, 1],
  staying: [10, 9, 8, 7, 6, 5, 4, 4, 3, 3, 2, 2],
});

const THREE_YEAR_OLD_NON_OPEN_ALLOWANCE = Object.freeze({
  sprint: [6, 5, 4, 3, 3, 3, 3, 2, 2, 1, 1, 1],
  mile: [7, 6, 5, 4, 3, 3, 3, 3, 2, 2, 1, 1],
  middle: [8, 7, 6, 5, 4, 3, 3, 3, 3, 2, 2, 1],
  staying: [9, 8, 7, 6, 5, 4, 3, 3, 3, 3, 2, 2],
});

const FOUR_YEAR_OLD_ALLOWANCE = Object.freeze({
  sprint: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  mile: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  middle: [1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  staying: [1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
});

const distanceBand = (distance) => {
  const value = Number(distance);
  if (!Number.isFinite(value)) return "middle";
  if (value < 1400) return "sprint";
  if (value <= 1600) return "mile";
  if (value < 2200) return "middle";
  return "staying";
};

const monthFor = (raceDate) => {
  const match = String(raceDate ?? "").match(/^\d{4}-?(\d{2})/);
  const month = match ? Number(match[1]) : null;
  return Number.isInteger(month) && month >= 1 && month <= 12 ? month : null;
};

const isOpenClass = (race = {}) => {
  const text = `${race.grade ?? ""} ${race.raceName ?? ""} ${race.raceNameRaw ?? ""}`;
  return /G[1-3ⅠⅡⅢ]|J[.・]?G|\(L\)|リステッド|\bOP\b|オープン/i.test(text);
};

const ageAllowanceKg = ({ age, raceDate, distance, openClass = true }) => {
  const month = monthFor(raceDate);
  if (!month) return 0;
  const band = distanceBand(distance);
  if (Number(age) === 3) {
    const table = openClass ? THREE_YEAR_OLD_ALLOWANCE : THREE_YEAR_OLD_NON_OPEN_ALLOWANCE;
    return table[band][month - 1];
  }
  if (Number(age) === 4) return FOUR_YEAR_OLD_ALLOWANCE[band][month - 1];
  return 0;
};

const sexAllowanceKg = (sex) => String(sex ?? "").includes("牝") ? 2 : 0;

const equivalentLoadKg = (horse, race = {}) => {
  const current = horse.currentRace ?? horse;
  const carriedWeight = Number(horse.carriedWeight ?? current.carriedWeight);
  if (!Number.isFinite(carriedWeight)) return null;
  const age = Number(horse.age ?? current.age);
  const sex = horse.sex ?? current.sex;
  const raceDate = race.raceDate ?? race.date ?? current.raceDate;
  const distance = race.distance ?? current.distance;
  const openClass = race.openClass ?? isOpenClass({ ...race, ...current });
  const ageAllowance = ageAllowanceKg({ age, raceDate, distance, openClass });
  const sexAllowance = sexAllowanceKg(sex);
  return {
    carriedWeight,
    ageAllowance,
    sexAllowance,
    equivalentWeight: carriedWeight + ageAllowance + sexAllowance,
  };
};

const median = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

const buildRaceLoadContext = (horses = [], race = {}) => {
  const entries = horses
    .map((horse) => ({
      horseNumber: horse.horseNumber ?? horse.number ?? horse.currentRace?.horseNumber ?? null,
      horseName: horse.horseName ?? horse.name ?? horse.currentRace?.horseName ?? null,
      load: equivalentLoadKg(horse, race),
    }))
    .filter((entry) => entry.load);
  const weights = entries.map((entry) => entry.load.equivalentWeight);
  return {
    status: entries.length ? "active" : "missing",
    method: "jra-age-sex-equivalent-median",
    raceDate: race.raceDate ?? race.date ?? null,
    distance: Number(race.distance) || null,
    openClass: isOpenClass(race),
    sample: entries.length,
    medianEquivalentWeight: median(weights),
    minEquivalentWeight: weights.length ? Math.min(...weights) : null,
    maxEquivalentWeight: weights.length ? Math.max(...weights) : null,
    entries,
  };
};

const comparableLoadSuccesses = (horse) => {
  const current = horse.currentRace ?? {};
  const targetDistance = Number(current.distance);
  const currentWeight = Number(current.carriedWeight ?? horse.carriedWeight);
  if (!Number.isFinite(targetDistance) || !Number.isFinite(currentWeight)) return [];
  return (horse.pastRuns ?? []).filter((run) => (
    Number(run.finishPosition) > 0
    && Number(run.finishPosition) <= 3
    && Number.isFinite(Number(run.carriedWeight))
    && Number(run.carriedWeight) >= currentWeight - 0.5
    && (!current.surface || run.surface === current.surface)
    && Number.isFinite(Number(run.distance))
    && Math.abs(Number(run.distance) - targetDistance) <= 200
  ));
};

const roundAwayFromZero = (value) => Math.sign(value) * Math.round(Math.abs(value));

const buildLoadAnalysis = (horse, context = {}) => {
  const race = {
    ...(horse.currentRace ?? {}),
    raceDate: context.raceDate ?? horse.currentRace?.raceDate,
    distance: context.distance ?? horse.currentRace?.distance,
    grade: context.grade ?? horse.currentRace?.grade,
    raceName: context.raceName ?? horse.currentRace?.raceName,
    raceNameRaw: context.raceNameRaw ?? horse.currentRace?.raceNameRaw,
    openClass: context.load?.openClass,
  };
  const load = equivalentLoadKg(horse, race);
  const fieldMedian = Number(context.load?.medianEquivalentWeight);
  if (!load || !Number.isFinite(fieldMedian)) {
    return {
      key: "load",
      label: "斤量",
      score: 65,
      maxScore: 100,
      status: "missing",
      adjustment: 0,
      summary: "レース内の年齢・性別補正後斤量を算出できないため、指数補正は行いません。",
      evidence: [],
    };
  }

  const relativeKg = load.equivalentWeight - fieldMedian;
  const comparableSuccesses = comparableLoadSuccesses(horse);
  const rawAdjustment = clamp(roundAwayFromZero(-relativeKg * 0.75), -2, 2);
  const provenMitigation = rawAdjustment < 0 && comparableSuccesses.length >= 2 ? 1 : 0;
  const adjustment = clamp(rawAdjustment + provenMitigation, -2, 2);
  const score = clamp(65 + adjustment * 6, 45, 85);
  const relativeText = relativeKg === 0
    ? "レース中央値と同水準"
    : `レース中央値より${Math.abs(relativeKg).toFixed(1)}kg${relativeKg > 0 ? "重い" : "軽い"}`;
  const allowanceParts = [
    load.ageAllowance ? `馬齢差${load.ageAllowance}kg` : null,
    load.sexAllowance ? `牝馬差${load.sexAllowance}kg` : null,
  ].filter(Boolean);
  const allowanceText = allowanceParts.length ? `${allowanceParts.join("・")}を補正` : "年齢・性別差の補正なし";
  const adjustmentText = adjustment === 0 ? "指数補正なし" : `TM INDEX ${adjustment > 0 ? "+" : ""}${adjustment}点`;

  return {
    key: "load",
    label: "斤量",
    score,
    maxScore: 100,
    status: "active",
    adjustment,
    carriedWeight: load.carriedWeight,
    ageAllowance: load.ageAllowance,
    sexAllowance: load.sexAllowance,
    equivalentWeight: load.equivalentWeight,
    fieldMedianEquivalentWeight: fieldMedian,
    relativeKg,
    comparableSuccessCount: comparableSuccesses.length,
    summary: `${allowanceText}。実質負担${load.equivalentWeight.toFixed(1)}kgは${relativeText}。${adjustmentText}。`,
    evidence: [
      `今回斤量 ${load.carriedWeight.toFixed(1)}kg`,
      `年齢・性別基準換算 ${load.equivalentWeight.toFixed(1)}kg / レース中央値 ${fieldMedian.toFixed(1)}kg`,
      `今回距離±200mで同等以上の斤量を背負った3着内 ${comparableSuccesses.length}走`,
      ...(provenMitigation ? ["近似条件での斤量克服実績により減点を1点緩和"] : []),
    ],
  };
};

export {
  ageAllowanceKg,
  buildLoadAnalysis,
  buildRaceLoadContext,
  equivalentLoadKg,
  isOpenClass,
  sexAllowanceKg,
};
