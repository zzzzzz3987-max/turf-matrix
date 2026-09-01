const normalizeBreedingId = (value) => {
  const normalized = String(value ?? "").trim();
  return /^\d{8,10}$/.test(normalized) && !/^0+$/.test(normalized) ? normalized : null;
};

const normalizeName = (value) => String(value ?? "").normalize("NFKC").trim();

const buildHnMap = (records = []) => new Map(records
  .map((record) => [normalizeBreedingId(record.breedingRegistrationNumber), record])
  .filter(([id]) => id));

const parentFromHn = (hnById, parentId, branch, generation) => {
  const registrationNumber = normalizeBreedingId(parentId);
  if (!registrationNumber) return null;
  const parent = hnById.get(registrationNumber);
  const name = normalizeName(parent?.name ?? parent?.nameLatin);
  if (!name) return null;
  return {
    generation,
    branch,
    name,
    registrationNumber,
    rawColor: null,
  };
};

const expandAncestorsWithHn = (ancestors = [], hnRecords = [], maxGeneration = 5) => {
  const hnById = hnRecords instanceof Map ? hnRecords : buildHnMap(hnRecords);
  const byBranch = new Map((ancestors ?? [])
    .filter((ancestor) => ancestor?.branch && ancestor?.name)
    .map((ancestor) => [ancestor.branch, { ...ancestor }]));

  for (let generation = 3; generation < maxGeneration; generation += 1) {
    const current = [...byBranch.values()].filter((ancestor) => ancestor.generation === generation);
    for (const ancestor of current) {
      const record = hnById.get(normalizeBreedingId(ancestor.registrationNumber));
      if (!record) continue;
      const sireBranch = `${ancestor.branch}.sire`;
      const damBranch = `${ancestor.branch}.dam`;
      if (!byBranch.has(sireBranch)) {
        const sire = parentFromHn(hnById, record.sireBreedingRegistrationNumber, sireBranch, generation + 1);
        if (sire) byBranch.set(sireBranch, sire);
      }
      if (!byBranch.has(damBranch)) {
        const dam = parentFromHn(hnById, record.damBreedingRegistrationNumber, damBranch, generation + 1);
        if (dam) byBranch.set(damBranch, dam);
      }
    }
  }

  return [...byBranch.values()].sort((left, right) =>
    left.generation - right.generation || left.branch.localeCompare(right.branch)
  );
};

export {
  buildHnMap,
  expandAncestorsWithHn,
  normalizeBreedingId,
};
