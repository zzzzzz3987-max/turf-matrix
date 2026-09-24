const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const numericValue = (value) => {
  if (value == null || (typeof value === "string" && !value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};
const validCarriedWeight = (value) => {
  const weight = numericValue(value);
  return weight != null && weight >= 30 && weight <= 80 ? weight : null;
};

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

const sexAllowanceKg = (sex, age, raceDate) => {
  if (!String(sex ?? "").includes("牝")) return 0;
  if (Number(age) === 2) {
    const month = monthFor(raceDate);
    return month && month >= 10 ? 1 : 0;
  }
  return 2;
};

const equivalentLoadKg = (horse, race = {}) => {
  const current = horse.currentRace ?? horse;
  const carriedWeight = validCarriedWeight(horse.carriedWeight ?? current.carriedWeight);
  if (carriedWeight == null) return null;
  const age = Number(horse.age ?? current.age);
  const sex = horse.sex ?? current.sex;
  const raceDate = race.raceDate ?? race.date ?? current.raceDate;
  const distance = race.distance ?? current.distance;
  const openClass = race.openClass ?? isOpenClass({ ...race, ...current });
  const ageAllowance = ageAllowanceKg({ age, raceDate, distance, openClass });
  const sexAllowance = sexAllowanceKg(sex, age, raceDate);
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
  const targetDistance = numericValue(current.distance);
  const currentWeight = validCarriedWeight(current.carriedWeight ?? horse.carriedWeight);
  if (targetDistance == null || targetDistance <= 0 || currentWeight == null) return [];
  return (horse.pastRuns ?? []).filter((run) => (
    Number.isInteger(numericValue(run.finishPosition))
    && numericValue(run.finishPosition) >= 1
    && numericValue(run.finishPosition) <= 3
    && validCarriedWeight(run.carriedWeight) != null
    && validCarriedWeight(run.carriedWeight) >= currentWeight - 0.5
    && (!current.surface || run.surface === current.surface)
    && numericValue(run.distance) != null
    && numericValue(run.distance) > 0
    && Math.abs(numericValue(run.distance) - targetDistance) <= 200
  ));
};

const loadRunQuality = (run) => {
  const finish = numericValue(run?.finishPosition);
  const suppliedFieldSize = numericValue(run?.fieldSize);
  const fieldSize = suppliedFieldSize != null && Number.isInteger(suppliedFieldSize) && suppliedFieldSize > 0 ? suppliedFieldSize : 16;
  if (finish == null || !Number.isInteger(finish) || finish <= 0 || finish > fieldSize) return null;
  const finishScore = ((fieldSize - Math.min(finish, fieldSize) + 1) / fieldSize) * 100;
  const margin = numericValue(run?.margin);
  const marginScore = margin != null && margin >= 0 && margin <= 20 ? 74 - margin * 18 : 60;
  return clamp(finishScore * 0.6 + marginScore * 0.4, 35, 96);
};

const buildLoadToleranceProfile = (horse) => {
  const current = horse.currentRace ?? {};
  const currentWeight = validCarriedWeight(current.carriedWeight ?? horse.carriedWeight);
  const targetDistance = numericValue(current.distance);
  if (currentWeight == null) {
    return { status: "missing", score: null, adjustment: 0, sampleCount: 0, maxPastWeight: null, runs: [] };
  }
  const targetSurface = current.surface;
  const runs = (horse.pastRuns ?? [])
    .filter((run) => validCarriedWeight(run.carriedWeight) != null)
    .filter((run) => !targetSurface || run.surface === targetSurface)
    .filter((run) => targetDistance == null || targetDistance <= 0 || (numericValue(run.distance) != null && numericValue(run.distance) > 0 && Math.abs(numericValue(run.distance) - targetDistance) <= 400))
    .map((run, index) => ({ ...run, quality: loadRunQuality(run), recencyWeight: Math.max(0.65, 1 - index * 0.06) }))
    .filter((run) => Number.isFinite(run.quality))
    .slice(0, 10);
  const maxPastWeight = runs.length ? Math.max(...runs.map((run) => validCarriedWeight(run.carriedWeight))) : null;
  const comparable = runs.filter((run) => validCarriedWeight(run.carriedWeight) >= currentWeight - 0.5);
  const totalWeight = comparable.reduce((sum, run) => sum + run.recencyWeight, 0);
  const observed = totalWeight
    ? comparable.reduce((sum, run) => sum + run.quality * run.recencyWeight, 0) / totalWeight
    : null;
  const score = observed == null ? null : Math.round((60 * 3 + observed * totalWeight) / (3 + totalWeight));
  const unprovenHigh = maxPastWeight != null && currentWeight > maxPastWeight + 0.5;
  const adjustment = comparable.length >= 2 && score >= 68
    ? 1
    : comparable.length >= 2 && score <= 52
      ? -1
      : unprovenHigh ? -1 : 0;
  return {
    status: comparable.length >= 3 ? "active" : comparable.length ? "partial" : runs.length ? "unproven" : "missing",
    score,
    adjustment,
    sampleCount: comparable.length,
    maxPastWeight,
    currentWeight,
    unprovenHigh,
    runs: comparable.map((run) => ({
      date: run.date ?? null,
      distance: Number(run.distance) || null,
      carriedWeight: validCarriedWeight(run.carriedWeight),
      finishPosition: Number(run.finishPosition),
      quality: run.quality,
    })),
  };
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
  const fieldMedian = validCarriedWeight(context.load?.medianEquivalentWeight);
  if (!load || fieldMedian == null) {
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
  const tolerance = buildLoadToleranceProfile(horse);
  const rawAdjustment = clamp(roundAwayFromZero(-relativeKg * 0.75), -2, 2);
  const provenLoadMitigation = rawAdjustment < 0 && comparableSuccesses.length >= 3 ? 1 : 0;
  const individualAdjustment = provenLoadMitigation
    ? Math.max(tolerance.adjustment, provenLoadMitigation)
    : tolerance.adjustment;
  const adjustment = clamp(rawAdjustment + individualAdjustment, -2, 2);
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
  const experienceText = comparableSuccesses.length >= 3
    ? `同等斤量・近似距離で3着内${comparableSuccesses.length}走があり、斤量実績を反映。`
    : tolerance.sampleCount
      ? `同等斤量の過去${tolerance.sampleCount}走から個体差も評価。`
      : "同等斤量の直接実績は限定的。";

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
    rawAdjustment,
    provenLoadMitigation,
    tolerance,
    summary: `${allowanceText}。実質負担${load.equivalentWeight.toFixed(1)}kgは${relativeText}。${experienceText}${adjustmentText}。`,
    evidence: [
      `今回斤量 ${load.carriedWeight.toFixed(1)}kg`,
      `年齢・性別基準換算 ${load.equivalentWeight.toFixed(1)}kg / レース中央値 ${fieldMedian.toFixed(1)}kg`,
      `今回距離±200mで同等以上の斤量を背負った3着内 ${comparableSuccesses.length}走`,
      ...(tolerance.sampleCount ? [`同じ馬場・今回距離±400mの同等斤量 ${tolerance.sampleCount}走 / 個体補正 ${individualAdjustment >= 0 ? "+" : ""}${individualAdjustment}`] : []),
      ...(tolerance.unprovenHigh ? [`過去最高${tolerance.maxPastWeight.toFixed(1)}kgを上回る未経験負担`] : []),
    ],
  };
};

export {
  ageAllowanceKg,
  buildLoadAnalysis,
  buildLoadToleranceProfile,
  buildRaceLoadContext,
  equivalentLoadKg,
  isOpenClass,
  sexAllowanceKg,
};
