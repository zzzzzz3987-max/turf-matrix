import { createRequire } from "node:module";
import { BLOODLINE_RULES, TRAIT_LABELS } from "./dictionaries/bloodline-dictionary.mjs";
import { FEMALE_LINE_RULES } from "./dictionaries/female-line-dictionary.mjs";

const require = createRequire(import.meta.url);
const BLOOD_STATISTICS = require("../../data/master/bloodlines.json");
const clamp = (value, min = 35, max = 96) => Math.max(min, Math.min(max, Math.round(value)));
const normalizeName = (value) => String(value ?? "").normalize("NFKC").toLowerCase().replace(/\s+/g, "");

const ROLE_WEIGHTS = {
  sire: 1,
  broodmareSire: 0.9,
  damDam: 0.78,
  sireSire: 0.68,
  sireDam: 0.58,
  dam: 0.55,
  ancestor: 0.42,
};

const ROLE_LABELS = {
  sire: "父",
  broodmareSire: "母父",
  damDam: "母の母",
  sireSire: "父父",
  sireDam: "父母",
  dam: "母",
  ancestor: "祖先",
};

const pedigreeEntries = (horse) => {
  const pedigree = horse.pedigree;
  const base = [
    { role: "sire", name: pedigree?.sire ?? horse.currentRace?.sire },
    { role: "dam", name: pedigree?.dam ?? horse.currentRace?.dam },
    { role: "broodmareSire", name: pedigree?.broodmareSire ?? horse.currentRace?.broodmareSire },
    { role: "sireSire", name: pedigree?.sireSire },
    { role: "sireDam", name: pedigree?.sireDam },
    { role: "damDam", name: pedigree?.damDam },
  ];
  const ancestors = (pedigree?.ancestors ?? []).map((ancestor) => ({
    role:
      ancestor.branch === "sire" ? "sire" :
      ancestor.branch === "dam" ? "dam" :
      ancestor.branch === "dam.sire" ? "broodmareSire" :
      ancestor.branch === "dam.dam" ? "damDam" :
      "ancestor",
    name: ancestor.name,
    generation: ancestor.generation,
    branch: ancestor.branch,
  }));
  const seen = new Set();
  return [...base, ...ancestors]
    .filter((entry) => entry.name)
    .filter((entry) => {
      const key = `${entry.role}:${normalizeName(entry.name)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((entry) => ({
      ...entry,
      roleLabel: ROLE_LABELS[entry.role] ?? ROLE_LABELS.ancestor,
      roleWeight: ROLE_WEIGHTS[entry.role] ?? ROLE_WEIGHTS.ancestor,
    }));
};

const matchRules = (entries, rules) =>
  rules
    .map((rule) => {
      const hits = entries.filter((entry) =>
        rule.terms.some((term) => normalizeName(entry.name).includes(normalizeName(term)))
      );
      if (!hits.length) return null;
      return {
        ...rule,
        hits: [...new Set(hits.map((hit) => hit.name))].slice(0, 4),
        hitEntries: hits,
        roleWeight: Math.max(...hits.map((hit) => hit.roleWeight)),
        roles: [...new Set(hits.map((hit) => hit.roleLabel))],
      };
    })
    .filter(Boolean);

const matchLines = (horse) => matchRules(pedigreeEntries(horse), BLOODLINE_RULES);
const matchFemaleLines = (horse) => matchRules(pedigreeEntries(horse).filter((entry) =>
  ["dam", "broodmareSire", "damDam", "ancestor"].includes(entry.role)
), FEMALE_LINE_RULES);

const weightedAffinity = (matches, trait, fallback = 0.5) => {
  const weighted = matches
    .map((match) => ({ value: match.traits?.[trait], weight: match.roleWeight ?? 0.4 }))
    .filter((item) => Number.isFinite(item.value));
  const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0);
  return totalWeight
    ? weighted.reduce((sum, item) => sum + item.value * item.weight, 0) / totalWeight
    : fallback;
};

const traitScore = (matches, context, trait) => {
  const affinity = weightedAffinity(matches, trait);
  const raceNeed = context?.traits?.[trait] ?? 0.5;
  const suitability = 1 - Math.abs(affinity - raceNeed);
  return clamp(46 + affinity * 24 + suitability * 18, 42, 90);
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

const componentScore = (matches, context, roleFilter) => {
  const selected = matches.filter((match) => match.hitEntries?.some((entry) => roleFilter.includes(entry.role)));
  if (!selected.length) return 50;
  const traits = ["speed", "power", "stamina", "sustain"].map((trait) => traitScore(selected, context, trait));
  const courseMatches = courseBloodMatches(selected, context);
  return clamp(
    traits.reduce((sum, score) => sum + score, 0) / traits.length +
      Math.min(8, courseMatches.reduce((sum, match) => sum + (match.roleWeight ?? 0.4) * 3, 0)),
    45,
    90
  );
};

const distanceBand = (distance) => {
  const value = Number(distance);
  if (!Number.isFinite(value)) return "unknown";
  if (value <= 1400) return "sprint";
  if (value <= 1800) return "mile";
  if (value <= 2200) return "middle";
  return "long";
};

const leaveOneHorseOut = (statistic, horseName) => {
  if (!statistic) return null;
  const contribution = statistic.horseContributions?.[normalizeName(horseName)];
  if (!contribution) return statistic;
  const sampleSize = statistic.sampleSize - contribution.sampleSize;
  const uniqueHorseCount = statistic.uniqueHorseCount - 1;
  const wins = statistic.wins - contribution.wins;
  const top3 = statistic.top3 - contribution.top3;
  const finishTotal = statistic.avgFinish * statistic.sampleSize - contribution.finishTotal;
  const minimum = BLOOD_STATISTICS.minimumSamples ?? {};
  const eligible = sampleSize >= (minimum.active ?? 12) && uniqueHorseCount >= (minimum.uniqueHorsesActive ?? 5);
  return {
    ...statistic,
    sampleSize,
    uniqueHorseCount,
    wins,
    top3,
    winRate: sampleSize ? Number((wins / sampleSize).toFixed(4)) : null,
    hitRate: sampleSize ? Number((top3 / sampleSize).toFixed(4)) : null,
    avgFinish: sampleSize ? Number((finishTotal / sampleSize).toFixed(2)) : null,
    eligible,
    confidence:
      sampleSize >= (minimum.high ?? 30) && uniqueHorseCount >= (minimum.uniqueHorsesHigh ?? 10)
        ? "high"
        : eligible
          ? "mid"
          : "low",
    excludedHorse: horseName,
  };
};

const statisticFor = (entityType, name, horse) => {
  const entity = BLOOD_STATISTICS.entities?.[entityType]?.[normalizeName(name)];
  if (!entity) return null;
  const race = horse.currentRace ?? {};
  const exactKey = `${race.course ?? "unknown"}|${race.surface ?? "unknown"}|${distanceBand(race.distance)}`;
  const broadKey = `${race.surface ?? "unknown"}|${distanceBand(race.distance)}`;
  const horseName = horse.name ?? horse.horseName ?? horse.currentRace?.horseName;
  const candidates = [
    { scope: "今回コース・距離帯", value: leaveOneHorseOut(entity.courseSurfaceDistance?.[exactKey], horseName), weight: 1 },
    { scope: "同馬場・距離帯", value: leaveOneHorseOut(entity.surfaceDistance?.[broadKey], horseName), weight: 0.75 },
    { scope: "保有データ全体", value: leaveOneHorseOut(entity.overall?.all, horseName), weight: 0.45 },
  ];
  const selected = candidates.find((candidate) => candidate.value?.eligible);
  if (!selected) return null;
  const baseline = BLOOD_STATISTICS.baseline?.hitRate;
  const lift = Number.isFinite(baseline) ? selected.value.hitRate - baseline : 0;
  return {
    entityType,
    name,
    scope: selected.scope,
    weight: selected.weight,
    ...selected.value,
    adjustment: Math.max(-4, Math.min(4, Math.round(lift * 18 * selected.weight))),
  };
};

const buildBloodStatistics = (horse) => {
  if (BLOOD_STATISTICS.status !== "approved") return [];
  const pedigree = horse.pedigree ?? {};
  return [
    statisticFor("sire", pedigree.sire ?? horse.currentRace?.sire, horse),
    statisticFor("broodmareSire", pedigree.broodmareSire ?? horse.currentRace?.broodmareSire, horse),
    statisticFor("femaleLine", pedigree.damDam, horse),
  ].filter(Boolean);
};

const buildBloodProfile = (horse, context) => {
  const entries = pedigreeEntries(horse);
  if (!entries.length) {
    return {
      score: 50,
      status: "missing",
      confidence: "low",
      coverage: 0,
      matches: [],
      femaleMatches: [],
      courseMatches: [],
      femaleCourseMatches: [],
      statistics: [],
      traits: leadingTraits([], context),
      components: { paternal: 50, maternal: 50, course: 50, distance: 50, blend: 50, statistics: 50 },
    };
  }

  const matches = matchLines(horse);
  const femaleMatches = matchFemaleLines(horse);
  const courseMatches = courseBloodMatches(matches, context);
  const femaleCourseMatches = courseFemaleMatches(femaleMatches, context);
  const allMatches = [...matches, ...femaleMatches];
  const traits = leadingTraits(allMatches, context);
  const paternal = componentScore(matches, context, ["sire", "sireSire", "sireDam"]);
  const maternalLines = [...matches, ...femaleMatches];
  const maternal = componentScore(maternalLines, context, ["dam", "broodmareSire", "damDam", "ancestor"]);
  const course = clamp(
    48 +
      Math.min(24, courseMatches.reduce((sum, match) => sum + (match.roleWeight ?? 0.4) * 7, 0)) +
      Math.min(10, femaleCourseMatches.reduce((sum, match) => sum + (match.roleWeight ?? 0.4) * 5, 0)),
    45,
    90
  );
  const distanceNeed =
    Number(horse.currentRace?.distance) >= 2200 ? ["stamina", "sustain"] :
    Number(horse.currentRace?.distance) <= 1400 ? ["speed", "power"] :
    ["speed", "sustain", "stamina"];
  const distance = clamp(
    distanceNeed.reduce((sum, trait) => sum + traitScore(allMatches, context, trait), 0) / distanceNeed.length,
    45,
    90
  );
  const traitValues = traits.map((item) => item.score);
  const blend = clamp(
    traitValues.reduce((sum, score) => sum + score, 0) / traitValues.length -
      (Math.max(...traitValues) - Math.min(...traitValues)) * 0.15,
    45,
    88
  );
  const sireMatched = matches.some((match) => match.hitEntries?.some((entry) => entry.role === "sire"));
  const bmsMatched = maternalLines.some((match) => match.hitEntries?.some((entry) => entry.role === "broodmareSire"));
  const coverageFields = ["sire", "dam", "broodmareSire", "damDam"]
    .filter((role) => entries.some((entry) => entry.role === role)).length;
  const coverage = coverageFields / 4;
  const statistics = buildBloodStatistics(horse);
  const statisticsAdjustment = Math.max(
    -5,
    Math.min(
      5,
      Math.round(statistics.reduce((sum, item) => {
        const roleWeight = item.entityType === "sire" ? 0.6 : item.entityType === "broodmareSire" ? 0.35 : 0.2;
        return sum + item.adjustment * roleWeight;
      }, 0))
    )
  );
  const statisticsScore = clamp(65 + statisticsAdjustment * 5, 45, 85);
  const confidence = sireMatched && bmsMatched ? "high" : sireMatched || bmsMatched || femaleMatches.length ? "mid" : "low";
  const status = matches.length || femaleMatches.length ? (confidence === "low" ? "partial" : "active") : "partial";
  const baseScore = clamp(
    paternal * 0.24 +
      maternal * 0.2 +
      course * 0.27 +
      distance * 0.19 +
      blend * 0.1,
    42,
    92
  );
  const score = clamp(baseScore + statisticsAdjustment, 42, 92);

  return {
    score,
    baseScore,
    status,
    confidence,
    coverage,
    entries,
    matches,
    femaleMatches,
    courseMatches,
    femaleCourseMatches,
    statistics,
    statisticsAdjustment,
    traits,
    components: { paternal, maternal, course, distance, blend, statistics: statisticsScore },
  };
};

const scoreBlood = (horse, context) => buildBloodProfile(horse, context).score;

const buildLine = (role, name, note) => ({
  role,
  name: name ?? "未取得",
  note: name ? note : "血統情報は一部未取得です。",
});

const traitText = (traits) => traits.slice(0, 2).map((item) => item.label).join("・") || "基礎適性";

const fitText = (matches, fallback = "今回条件への適性") => {
  const tags = [...new Set(matches.flatMap((match) => match.fit ?? []))]
    .filter((tag) => !/系$/.test(tag))
    .slice(0, 3);
  return tags.length ? tags.join("・") : fallback;
};

const evaluationSummary = ({ traits, courseMatches, femaleCourseMatches, context, matches }) => {
  const traitsLabel = traitText(traits);
  const condition = context?.profile ?? "今回条件";
  const courseFit = courseMatches.length
    ? `${condition}で求められる${fitText(courseMatches, "立ち回り")}に合います。`
    : `${condition}への基礎適性を評価します。`;
  const familyFit = femaleCourseMatches.length ? "牝系側にも条件を支える補強材料があります。" : "";
  const depth = matches.length >= 2 ? "父系と母系の両面から" : "取得済みの血統から";
  return `${depth}、${traitsLabel}を主な強みとして評価。${courseFit}${familyFit}`;
};

const buildPedigreeAnalysis = (horse, bloodScore, context) => {
  const pedigree = horse.pedigree;
  const profile = buildBloodProfile(horse, context);
  const { matches, traits, courseMatches, femaleMatches, femaleCourseMatches } = profile;
  const baseSummary = matches.length || femaleMatches.length
    ? evaluationSummary({ traits, courseMatches, femaleCourseMatches, context, matches: [...matches, ...femaleMatches] })
    : `取得済みの血統から、${context?.profile ?? "今回条件"}への基礎適性を評価します。辞書未照合の血統は中立評価です。`;
  const statisticStrengths = profile.statistics.map((statistic) => ({
    key: `statistics-${statistic.entityType}`,
    label:
      statistic.entityType === "sire" ? `${statistic.name}産駒実績` :
      statistic.entityType === "broodmareSire" ? `母父${statistic.name}実績` :
      `${statistic.name}牝系実績`,
    text: `${statistic.scope}で${statistic.sampleSize}走・${statistic.uniqueHorseCount}頭、勝率${(statistic.winRate * 100).toFixed(1)}%、複勝率${(statistic.hitRate * 100).toFixed(1)}%。`,
    score: bloodScore,
    sampleSize: statistic.sampleSize,
    uniqueHorseCount: statistic.uniqueHorseCount,
    winRate: statistic.winRate,
    hitRate: statistic.hitRate,
    confidence: statistic.confidence,
    adjustment: statistic.adjustment,
  }));

  const strengths = matches.slice(0, context?.depth === "full" ? 4 : 2).map((match) => ({
    key: match.id,
    label: match.label,
    text: `${match.roles.join("・")}の${match.hits.join("・")}から、${fitText([match])}を評価。${match.note}`,
    score: bloodScore,
    fit: match.fit ?? [],
    roles: match.roles,
    courseFit: courseMatches.some((item) => item.id === match.id),
  }));

  const femaleStrengths = femaleMatches.slice(0, context?.depth === "full" ? 3 : 1).map((match) => ({
    key: match.id,
    label: match.label,
    text: `${fitText([match])}を牝系側から補強。${match.note}`,
    score: bloodScore,
    fit: match.fit ?? [],
    roles: match.roles ?? [],
    courseFit: femaleCourseMatches.some((item) => item.id === match.id),
  }));

  const scores = {
    course: profile.components.course,
    distance: profile.components.distance,
    going: context?.going ? profile.components.course : 50,
    lap: traitScore([...matches, ...femaleMatches], context, "sustain"),
    family: profile.components.maternal,
    speed: traitScore([...matches, ...femaleMatches], context, "speed"),
    stamina: traitScore([...matches, ...femaleMatches], context, "stamina"),
    burst: traitScore([...matches, ...femaleMatches], context, "speed"),
    sustain: traitScore([...matches, ...femaleMatches], context, "sustain"),
  };

  return {
    headline: baseSummary,
    status: profile.status,
    confidence: profile.confidence,
    coverage: profile.coverage,
    components: profile.components,
    statistics: profile.statistics,
    statisticsAdjustment: profile.statisticsAdjustment,
    strengths: [...strengths, ...femaleStrengths, ...statisticStrengths],
    lines: [
      buildLine("父系", pedigree?.sire ?? horse.currentRace?.sire, `父系の主軸。今回条件への適性は${profile.components.paternal}。`),
      buildLine("母系", pedigree?.dam ?? horse.currentRace?.dam, `母系の補完力を評価。母系総合は${profile.components.maternal}。`),
      buildLine("母父", pedigree?.broodmareSire ?? horse.currentRace?.broodmareSire, "パワー、馬場適性、距離適性の補強要素として見ます。"),
      buildLine("牝系", pedigree?.damDam, femaleStrengths.length ? `${femaleStrengths[0].label}の特徴を確認。` : "牝系側のスタミナと底力を確認します。"),
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

export { scoreBlood, buildBloodProfile, buildPedigreeAnalysis };
