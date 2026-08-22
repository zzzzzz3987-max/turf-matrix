const UM_ANCESTOR_BRANCHES = Object.freeze([
  "sire",
  "dam",
  "sire.sire",
  "sire.dam",
  "dam.sire",
  "dam.dam",
  "sire.sire.sire",
  "sire.sire.dam",
  "sire.dam.sire",
  "sire.dam.dam",
  "dam.sire.sire",
  "dam.sire.dam",
  "dam.dam.sire",
  "dam.dam.dam",
]);

const normalizeAncestor = (ancestor, index) => {
  const branch = UM_ANCESTOR_BRANCHES[index];
  const name = String(ancestor?.name ?? "").trim();
  if (!branch || !name) return null;
  return {
    generation: branch.split(".").length,
    branch,
    name,
    registrationNumber: String(ancestor?.registrationNumber ?? "").trim() || null,
    rawColor: ancestor?.rawColor ?? null,
  };
};

const structureUmAncestors = (ancestors = []) => ancestors
  .slice(0, UM_ANCESTOR_BRANCHES.length)
  .map(normalizeAncestor)
  .filter(Boolean);

const pedigreeCompleteness = (ancestors = []) => {
  const count = ancestors.filter((ancestor) => ancestor?.name).length;
  return count === UM_ANCESTOR_BRANCHES.length
    ? "three-generation-14"
    : `partial-${count}-of-${UM_ANCESTOR_BRANCHES.length}`;
};

export { UM_ANCESTOR_BRANCHES, pedigreeCompleteness, structureUmAncestors };
