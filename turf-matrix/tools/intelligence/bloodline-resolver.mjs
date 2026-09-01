import { BLOODLINE_RULES } from "./dictionaries/bloodline-dictionary.mjs";

const CANONICAL_RULE_IDS = {
  mr_prospector_bridge: "mr_prospector",
  ap_indy_bridge: "seattle_slew_ap_indy",
  northern_dancer_bridge: "northern_dancer",
};

const normalizeBloodlineName = (value) => String(value ?? "")
  .normalize("NFKC")
  .toLowerCase()
  .replace(/[＊*$]/g, "")
  .replace(/[.'’\-\s]+/g, "")
  .trim();

const normalizedRules = BLOODLINE_RULES.map((rule, index) => ({
  ...rule,
  index,
  canonicalId: CANONICAL_RULE_IDS[rule.id] ?? rule.id,
  normalizedTerms: (rule.terms ?? []).map((term) => ({
    term,
    normalized: normalizeBloodlineName(term),
  })).filter((term) => term.normalized),
}));

const resolveBloodlineId = (name) => {
  const normalizedName = normalizeBloodlineName(name);
  if (!normalizedName) return null;
  const candidates = normalizedRules.flatMap((rule) => rule.normalizedTerms
    .filter((term) => normalizedName === term.normalized || normalizedName.includes(term.normalized))
    .map((term) => ({
      rule,
      term,
      exact: normalizedName === term.normalized,
    }))
  ).sort((left, right) =>
    Number(right.exact) - Number(left.exact)
    || (Number(right.rule.depth) || 1) - (Number(left.rule.depth) || 1)
    || right.term.normalized.length - left.term.normalized.length
    || left.rule.index - right.rule.index
  );
  const selected = candidates[0];
  if (!selected) return null;
  const canonicalRule = normalizedRules.find((rule) => rule.id === selected.rule.canonicalId) ?? selected.rule;
  return {
    id: selected.rule.canonicalId,
    label: canonicalRule.label,
    matchedName: String(name).trim(),
    matchedTerm: selected.term.term,
    sourceRuleId: selected.rule.id,
    depth: Number(selected.rule.depth) || 1,
    parentGroup: canonicalRule.parentGroup ?? selected.rule.parentGroup ?? null,
    matchType: selected.exact ? "exact_term" : "contained_term",
  };
};

const ancestorAt = (pedigree, branch) =>
  pedigree?.ancestors?.find((ancestor) => ancestor.branch === branch)?.name ?? null;

const firstResolved = (candidates) => {
  for (const candidate of candidates) {
    if (!candidate?.name) continue;
    const resolved = resolveBloodlineId(candidate.name);
    if (resolved) return { ...resolved, branch: candidate.branch, generation: candidate.generation };
  }
  return null;
};

const resolvePedigreeLineIds = (pedigree = {}) => ({
  sireLine: firstResolved([
    { branch: "sire", generation: 1, name: pedigree.sire },
    { branch: "sire.sire", generation: 2, name: pedigree.sireSire ?? ancestorAt(pedigree, "sire.sire") },
    { branch: "sire.sire.sire", generation: 3, name: ancestorAt(pedigree, "sire.sire.sire") },
    { branch: "sire.sire.sire.sire", generation: 4, name: ancestorAt(pedigree, "sire.sire.sire.sire") },
    { branch: "sire.sire.sire.sire.sire", generation: 5, name: ancestorAt(pedigree, "sire.sire.sire.sire.sire") },
  ]),
  broodmareSireLine: firstResolved([
    { branch: "dam.sire", generation: 2, name: pedigree.broodmareSire ?? pedigree.damSire ?? ancestorAt(pedigree, "dam.sire") },
    { branch: "dam.sire.sire", generation: 3, name: ancestorAt(pedigree, "dam.sire.sire") },
    { branch: "dam.sire.sire.sire", generation: 4, name: ancestorAt(pedigree, "dam.sire.sire.sire") },
    { branch: "dam.sire.sire.sire.sire", generation: 5, name: ancestorAt(pedigree, "dam.sire.sire.sire.sire") },
  ]),
});

export { normalizeBloodlineName, resolveBloodlineId, resolvePedigreeLineIds };
