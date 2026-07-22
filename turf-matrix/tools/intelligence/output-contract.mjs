import { FACTOR_KEYS } from "./constants.mjs";
import { starsForEv } from "./value-ai.mjs";

const MOJIBAKE_PATTERN = /譛|繧|邉|隱|陦|蠑|荳|縺|逶|髯|蜿|鬥|雎|蟇/;
const CORE_DETAIL_KEYS = ["blood", "training", "course", "pace", "form", "value"];
const normalizeHorseKey = (value) =>
  String(value ?? "").normalize("NFKC").replace(/[＊*$]/g, "").replace(/\u3000/g, " ").replace(/\s+/g, "").trim();

const validateOddsJoinIntegrity = (weekData) => {
  const errors = [];
  for (const race of weekData?.races ?? []) {
    for (const horse of race?.horses ?? []) {
      const prefix = `${race?.id ?? "unknown-race"}/${horse?.name ?? horse?.number ?? "unknown-horse"}`;
      const detail = horse?.oddsDetail;
      if (race?.oddsStatus === "active" && !detail) {
        errors.push(`${prefix}: active odds are missing oddsDetail`);
        continue;
      }
      if (!detail) continue;
      if (normalizeHorseKey(detail.horseName) !== normalizeHorseKey(horse.name)) {
        errors.push(`${prefix}: odds horse name mismatch (${detail.horseName ?? "missing"})`);
      }
      if (Number.isFinite(detail.horseNumber) && Number.isFinite(horse.number) && detail.horseNumber !== horse.number) {
        errors.push(`${prefix}: odds horse number mismatch (${detail.horseNumber} != ${horse.number})`);
      }
    }
  }
  return errors;
};

const validateValueDisplayIntegrity = (weekData) => {
  const errors = [];
  for (const race of weekData?.races ?? []) {
    const probabilities = [];
    for (const horse of race?.horses ?? []) {
      const prefix = `${race?.id ?? "unknown-race"}/${horse?.name ?? horse?.number ?? "unknown-horse"}`;
      const value = horse?.analysis?.factorsDetail?.value;
      if (!value) continue;
      if (Number.isFinite(horse.tmValue) && value.score !== horse.tmValue) {
        errors.push(`${prefix}: TM VALUE score mismatch (${value.score} != ${horse.tmValue})`);
      }
      if (horse?.analysis?.value?.score != null && horse.analysis.value.score !== value.score) {
        errors.push(`${prefix}: analysis.value score mismatch (${horse.analysis.value.score} != ${value.score})`);
      }
      if (value.status !== "active") continue;
      if (!Number.isFinite(value.probability) || !Number.isFinite(value.ev)) {
        errors.push(`${prefix}: active Value metrics are missing probability or EV`);
        continue;
      }
      probabilities.push(value.probability);
      const expectedEv = value.probability * horse.odds;
      if (!Number.isFinite(expectedEv) || Math.abs(value.ev - expectedEv) > 1e-9) {
        errors.push(`${prefix}: EV does not equal probability x odds`);
      }
      if (value.stars !== starsForEv(value.ev)) {
        errors.push(`${prefix}: TM VALUE stars mismatch (${value.stars} != ${starsForEv(value.ev)})`);
      }
    }
    if (probabilities.length) {
      const probabilitySum = probabilities.reduce((sum, value) => sum + value, 0);
      if (Math.abs(probabilitySum - 1) > 0.01) {
        errors.push(`${race?.id ?? "unknown-race"}: Value probabilities sum to ${probabilitySum}`);
      }
    }
  }
  return errors;
};

const collectDuplicates = (values) => {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (value == null || value === "") continue;
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
};

const collectInvalidNumbers = (value, path = "$", errors = []) => {
  if (typeof value === "number" && !Number.isFinite(value)) errors.push(path);
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectInvalidNumbers(item, `${path}[${index}]`, errors));
  } else if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, item]) => collectInvalidNumbers(item, `${path}.${key}`, errors));
  }
  return errors;
};

const validateIntelligenceOutput = (weekData) => {
  const errors = [];
  const races = weekData?.races ?? [];

  if (!weekData || typeof weekData !== "object") errors.push("week data is missing");
  if (!races.length && weekData?.meta?.dataStatus !== "missing") errors.push("races are missing");

  for (const race of races) {
    const horses = race?.horses ?? [];
    const prefix = race?.id ?? "unknown-race";
    if (!horses.length) errors.push(`${prefix}: horses are missing`);
    if (race.fieldSize != null && race.fieldSize !== horses.length) {
      errors.push(`${prefix}: fieldSize ${race.fieldSize} does not match horses ${horses.length}`);
    }

    const duplicateNumbers = collectDuplicates(horses.map((horse) => horse.number));
    const duplicateNames = collectDuplicates(horses.map((horse) => horse.name));
    const duplicateIds = collectDuplicates(horses.map((horse) => horse.id));
    if (duplicateNumbers.length) errors.push(`${prefix}: duplicate horse numbers ${duplicateNumbers.join(", ")}`);
    if (duplicateNames.length) errors.push(`${prefix}: duplicate horse names ${duplicateNames.join(", ")}`);
    if (duplicateIds.length) errors.push(`${prefix}: duplicate horse ids ${duplicateIds.join(", ")}`);

    for (const horse of horses) {
      const horsePrefix = `${prefix}/${horse.name ?? horse.number ?? "unknown-horse"}`;
      if (!Number.isFinite(horse.tmIndex)) errors.push(`${horsePrefix}: tmIndex is missing`);
      if (Number.isFinite(horse.tmIndex) && (horse.tmIndex < 0 || horse.tmIndex > 100)) {
        errors.push(`${horsePrefix}: tmIndex is outside 0-100`);
      }
      for (const factor of FACTOR_KEYS) {
        if (!Number.isFinite(horse.analysis?.factors?.[factor])) {
          errors.push(`${horsePrefix}: factors.${factor} is missing`);
        }
      }
      for (const key of CORE_DETAIL_KEYS) {
        if (!horse.analysis?.factorsDetail?.[key]) {
          errors.push(`${horsePrefix}: factorsDetail.${key} is missing`);
        }
      }
      if (!horse.analysis?.verdict || !horse.analysis?.topSignal) {
        errors.push(`${horsePrefix}: verdict output is incomplete`);
      }
      if (horse.analysis?.dataQuality && !Number.isFinite(horse.analysis.dataQuality.score)) {
        errors.push(`${horsePrefix}: dataQuality.score is missing`);
      }
      if (horse.analysis?.relative) {
        if (!Number.isFinite(horse.analysis.relative.rank)) errors.push(`${horsePrefix}: relative.rank is missing`);
        if (!Number.isFinite(horse.analysis.relative.percentile)) errors.push(`${horsePrefix}: relative.percentile is missing`);
      }
    }
  }

  const invalidNumbers = collectInvalidNumbers(weekData);
  if (invalidNumbers.length) errors.push(`invalid numeric values: ${invalidNumbers.join(", ")}`);
  if (MOJIBAKE_PATTERN.test(JSON.stringify(weekData))) errors.push("mojibake markers detected");
  errors.push(...validateOddsJoinIntegrity(weekData));
  errors.push(...validateValueDisplayIntegrity(weekData));

  return { valid: errors.length === 0, errors };
};

export {
  collectDuplicates,
  collectInvalidNumbers,
  validateIntelligenceOutput,
  validateOddsJoinIntegrity,
  validateValueDisplayIntegrity,
};
