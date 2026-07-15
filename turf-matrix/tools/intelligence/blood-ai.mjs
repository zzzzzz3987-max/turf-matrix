import { BLOODLINE_RULES, TRAIT_LABELS } from "./dictionaries/bloodline-dictionary.mjs";
import { FEMALE_LINE_RULES } from "./dictionaries/female-line-dictionary.mjs";

const clamp = (value, min = 35, max = 96) => Math.max(min, Math.min(max, Math.round(value)));

const normalizeName = (value) => String(value ?? "").normalize("NFKC").toLowerCase().replace(/\s+/g, "");

const pedigreeNames = (horse) => {
  const pedigree = horse.pedigree;
  return [
    pedigree?.sire,
    pedigree?.dam,
    pedigree?.broodmareSire,
    pedigree?.sireSire,
    pedigree?.sireDam,
    pedigree?.damSire,
    pedigree?.damDam,
    ...(pedigree?.ancestors ?? []).map((ancestor) => ancestor.name),
    horse.currentRace?.sire,
    horse.currentRace?.dam,
    horse.currentRace?.broodmareSire,
  ].filter(Boolean);
};

const pedigreeEntries = (horse) => {
  const pedigree = horse.pedigree;
  return [
    { role: "父", name: pedigree?.sire ?? horse.currentRace?.sire },
    { role: "母", name: pedigree?.dam ?? horse.currentRace?.dam },
    { role: "母父", name: pedigree?.broodmareSire ?? horse.currentRace?.broodmareSire },
    { role: "父父", name: pedigree?.sireSire },
    { role: "父母", name: pedigree?.sireDam },
    { role: "母父", name: pedigree?.damSire },
    { role: "母母", name: pedigree?.damDam },
    ...(pedigree?.ancestors ?? []).map((ancestor) => ({
      role: ancestor.branch ?? `第${ancestor.generation ?? "-"}世代`,
      name: ancestor.name,
    })),
  ].filter((entry) => entry.name);
};

const matchLines = (horse) => {
  const names = pedigreeNames(horse);
  const normalized = names.map(normalizeName);
  return BLOODLINE_RULES.map((rule) => {
    const hits = names.filter((_, index) => rule.terms.some((term) => normalized[index].includes(normalizeName(term))));
    return hits.length ? { ...rule, hits: [...new Set(hits)].slice(0, 4) } : null;
  }).filter(Boolean);
};

const matchFemaleLines = (horse) => {
  const entries = pedigreeEntries(horse);
  const normalized = entries.map((entry) => normalizeName(entry.name));
  return FEMALE_LINE_RULES.map((rule) => {
    const hits = entries.filter((_, index) => rule.terms.some((term) => normalized[index].includes(normalizeName(term))));
    return hits.length
      ? {
          ...rule,
          hits: hits.map((hit) => hit.name).filter(Boolean).slice(0, 4),
          roles: [...new Set(hits.map((hit) => hit.role).filter(Boolean))].slice(0, 4),
        }
      : null;
  }).filter(Boolean);
};

const traitScore = (matches, context, trait) => {
  const affinity = matches.reduce((best, match) => Math.max(best, match.traits[trait] ?? 0), 0);
  const raceNeed = context?.traits?.[trait] ?? 0.5;
  return clamp(52 + affinity * 28 * raceNeed);
};

const courseBloodMatches = (matches, context) => {
  const desired = context?.bloodBias ?? [];
  const desiredIds = context?.bloodBiasIds ?? [];
  const desiredTags = context?.bloodFitTags ?? [];
  if (!desired.length && !desiredIds.length && !desiredTags.length) return [];
  return matches.filter((match) => {
    const labelMatched = desired.some((label) => label === match.label || label.includes(match.label) || match.label.includes(label));
    const idMatched = desiredIds.includes(match.id);
    const tagMatched = (match.fit ?? []).some((tag) => desiredTags.includes(tag));
    return labelMatched || idMatched || tagMatched;
  });
};

const courseFemaleMatches = (matches, context) => {
  const desiredTags = context?.bloodFitTags ?? [];
  if (!desiredTags.length) return [];
  return matches.filter((match) => (match.fit ?? []).some((tag) => desiredTags.includes(tag)));
};

const leadingTraits = (matches, context) =>
  ["speed", "power", "stamina", "sustain"]
    .map((trait) => ({ trait, label: TRAIT_LABELS[trait], score: traitScore(matches, context, trait) }))
    .sort((a, b) => b.score - a.score);

const scoreBlood = (horse, context) => {
  const names = pedigreeNames(horse);
  if (!names.length) return 50;
  const matches = matchLines(horse);
  const femaleMatches = matchFemaleLines(horse);
  const profile = leadingTraits(matches, context).map((item) => item.score);
  const completeness = Math.min(10, names.length / 3);
  const lineBonus = Math.min(8, matches.length * 2);
  const courseBonus = Math.min(8, courseBloodMatches(matches, context).length * 3);
  const femaleBonus = Math.min(6, femaleMatches.length * 2 + courseFemaleMatches(femaleMatches, context).length * 2);
  return clamp(profile.reduce((sum, value) => sum + value, 0) / profile.length + completeness + lineBonus + courseBonus + femaleBonus);
};

const buildLine = (role, name, note) => ({
  role,
  name: name ?? "未取得",
  note: name ? note : "血統情報は一部未取得です。",
});

const buildPedigreeAnalysis = (horse, bloodScore, context) => {
  const pedigree = horse.pedigree;
  const matches = matchLines(horse);
  const traits = leadingTraits(matches, context);
  const topTraits = traits.slice(0, 2).map((item) => item.label).join("・");
  const matchedLabels = matches.map((match) => match.label);
  const courseMatches = courseBloodMatches(matches, context);
  const femaleMatches = matchFemaleLines(horse);
  const femaleCourseMatches = courseFemaleMatches(femaleMatches, context);
  const baseSummary = matches.length
    ? `${matchedLabels.slice(0, 2).join("・")}を確認。${topTraits}を今回条件の強みとして評価します。${courseMatches.length ? ` ${context?.profile ?? "今回条件"}で評価したい血統傾向とも合致。` : ""}${femaleCourseMatches.length ? " 牝系側も今回条件の補強材料になります。" : ""}`
    : `取得済みの4代血統から、${context?.profile ?? "今回条件"}への基礎適性を評価します。`;

  const strengths = matches.slice(0, context?.depth === "full" ? 4 : 2).map((match) => ({
    key: match.id,
    label: match.label,
    text: `${match.hits.join("・")}を確認。${match.note}`,
    score: bloodScore,
    fit: match.fit ?? [],
    courseFit: courseMatches.some((item) => item.id === match.id),
  }));

  const femaleStrengths = femaleMatches.slice(0, context?.depth === "full" ? 3 : 1).map((match) => ({
    key: match.id,
    label: match.label,
    text: `${match.hits.join("・")}を確認。${match.note}`,
    score: bloodScore,
    fit: match.fit ?? [],
    roles: match.roles ?? [],
    courseFit: femaleCourseMatches.some((item) => item.id === match.id),
  }));

  const scores = {
    course: bloodScore,
    distance: bloodScore,
    going: context?.going ? bloodScore : 50,
    lap: traitScore(matches, context, "sustain"),
    family: bloodScore,
    speed: traitScore(matches, context, "speed"),
    stamina: traitScore(matches, context, "stamina"),
    burst: traitScore(matches, context, "speed"),
    sustain: traitScore(matches, context, "sustain"),
  };

  return {
    headline: baseSummary,
    strengths,
    lines: [
      buildLine("父系", pedigree?.sire ?? horse.currentRace?.sire, "主にスピード、持続力、機動力の土台として評価します。"),
      buildLine("母系", pedigree?.dam ?? horse.currentRace?.dam, femaleStrengths.length ? `${femaleStrengths[0].label}の補強を確認。${femaleStrengths[0].fit.slice(0, 3).join("・")}を評価します。` : "スタミナ、底力、牝系の持続力を補助評価します。"),
      buildLine("母父", pedigree?.broodmareSire ?? horse.currentRace?.broodmareSire, "パワー、馬場適性、距離適性の補強要素として見ます。"),
      buildLine("牝系", pedigree?.damDam, "牝系側のスタミナと底力を確認します。"),
    ],
    structure: {
      ancestorCount: pedigree?.ancestors?.length ?? 0,
      completeness: pedigree?.ancestors?.length >= 28 ? "4代取得済み" : pedigree ? "一部取得" : "未取得",
    },
    raceBias: {
      score: bloodScore,
      grade: bloodScore >= 82 ? "高" : bloodScore >= 68 ? "中" : "低",
      matched: matches,
      courseMatched: courseMatches,
      femaleMatched: femaleMatches,
      femaleCourseMatched: femaleCourseMatches,
      summary: `${context?.summary ?? "レース条件未取得"} ${baseSummary}`,
    },
    traits,
    scores,
  };
};

export { scoreBlood, buildPedigreeAnalysis };
