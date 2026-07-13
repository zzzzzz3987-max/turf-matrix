import { FACTOR_KEYS } from "./constants.mjs";

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
      if (!horse.analysis?.verdict || !horse.analysis?.topSignal) {
        errors.push(`${horsePrefix}: verdict output is incomplete`);
      }
    }
  }

  const invalidNumbers = collectInvalidNumbers(weekData);
  if (invalidNumbers.length) errors.push(`invalid numeric values: ${invalidNumbers.join(", ")}`);

  return { valid: errors.length === 0, errors };
};

export { collectDuplicates, collectInvalidNumbers, validateIntelligenceOutput };
