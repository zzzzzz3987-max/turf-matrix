import { createRequire } from "node:module";
import { BLOODLINE_RULES, TRAIT_LABELS } from "./dictionaries/bloodline-dictionary.mjs";
import { FEMALE_LINE_RULES } from "./dictionaries/female-line-dictionary.mjs";
import { buildBloodEvidenceV2 } from "./blood-features.mjs";

const require = createRequire(import.meta.url);
const BLOOD_STATISTICS = require("../../data/master/bloodlines.json");
const clamp = (value, min = 35, max = 96) => Math.max(min, Math.min(max, value));
const displayScore = (value) => Math.round(value);
const normalizeName = (value) => String(value ?? "").normalize("NFKC").toLowerCase().replace(/\s+/g, "");
const BLOOD_NEUTRAL_SCORE = 65;
const BLOOD_TANH_AMPLITUDE = 7.5;
const BLOOD_TANH_SCALE = 7.5;

const BRANCH_WEIGHTS = {
  sire: 0.4,
  broodmareSire: 0.25,
  sireSire: 0.12,
  damDam: 0.1,
  generation3: 0.08,
  distant: 0.05,
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

const entryMeta = ({ branch, generation }) => {
  if (branch === "sire") return { role: "sire", scoreWeight: BRANCH_WEIGHTS.sire, coverageWeight: BRANCH_WEIGHTS.sire };
  if (branch === "dam.sire") return { role: "broodmareSire", scoreWeight: BRANCH_WEIGHTS.broodmareSire, coverageWeight: BRANCH_WEIGHTS.broodmareSire };
  if (branch === "sire.sire") return { role: "sireSire", scoreWeight: BRANCH_WEIGHTS.sireSire, coverageWeight: BRANCH_WEIGHTS.sireSire };
  if (branch === "dam.dam") return { role: "damDam", scoreWeight: BRANCH_WEIGHTS.damDam, coverageWeight: BRANCH_WEIGHTS.damDam };
  if (generation === 3) {
    return { role: "ancestor", scoreWeight: BRANCH_WEIGHTS.generation3 / 8, coverageWeight: BRANCH_WEIGHTS.generation3 / 8 };
  }
  if (generation === 4 || generation === 5) {
    return { role: "ancestor", scoreWeight: 0, coverageWeight: BRANCH_WEIGHTS.distant / 48 };
  }
  return {
    role: branch === "dam" ? "dam" : branch === "sire.dam" ? "sireDam" : "ancestor",
    scoreWeight: 0,
    coverageWeight: 0,
  };
};

const pedigreeEntries = (horse) => {
  const pedigree = horse.pedigree;
  const base = [
    { branch: "sire", generation: 1, name: pedigree?.sire ?? horse.currentRace?.sire },
    { branch: "dam", generation: 1, name: pedigree?.dam ?? horse.currentRace?.dam },
    { branch: "dam.sire", generation: 2, name: pedigree?.broodmareSire ?? horse.currentRace?.broodmareSire },
    { branch: "sire.sire", generation: 2, name: pedigree?.sireSire },
    { branch: "sire.dam", generation: 2, name: pedigree?.sireDam },
    { branch: "dam.dam", generation: 2, name: pedigree?.damDam },
  ];
  const ancestors = (pedigree?.ancestors ?? []).map((ancestor) => ({ ...ancestor }));
  const seen = new Set();
  return [...base, ...ancestors]
    .filter((entry) => entry.name)
    .filter((entry) => {
      const key = `${entry.branch}:${normalizeName(entry.name)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((entry) => {
      const meta = entryMeta(entry);
      return {
        ...entry,
        ...meta,
        roleLabel: ROLE_LABELS[meta.role] ?? ROLE_LABELS.ancestor,
        roleWeight: meta.scoreWeight,
      };
    });
};

const matchRules = (entries, rules, source) =>
  rules
    .map((rule) => {
      const hits = entries.filter((entry) =>
        rule.terms.some((term) => normalizeName(entry.name).includes(normalizeName(term)))
      );
      if (!hits.length) return null;
      const scoredHits = rule.scoreEligible === false
        ? hits.map((hit) => ({ ...hit, scoreWeight: 0 }))
        : hits;
      return {
        ...rule,
        source,
        depth: Number(rule.depth) || 1,
        hits: [...new Set(hits.map((hit) => hit.name))].slice(0, 4),
        hitEntries: scoredHits,
        roleWeight: Math.max(...scoredHits.map((hit) => hit.scoreWeight)),
        coverageWeight: Math.max(...hits.map((hit) => hit.coverageWeight)),
        roles: [...new Set(hits.map((hit) => hit.roleLabel))],
      };
    })
    .filter(Boolean);

const matchLines = (horse) => matchRules(pedigreeEntries(horse), BLOODLINE_RULES, "bloodline");
const matchFemaleLines = (horse) => matchRules(pedigreeEntries(horse).filter((entry) =>
  ["dam", "broodmareSire", "damDam", "ancestor"].includes(entry.role)
), FEMALE_LINE_RULES, "femaleLine");

const weightedAffinity = (matches, trait) => {
  const weighted = matches
    .map((match) => ({ value: match.traits?.[trait], weight: match.roleWeight ?? 0 }))
    .filter((item) => Number.isFinite(item.value) && item.weight > 0);
  const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0);
  return totalWeight
    ? weighted.reduce((sum, item) => sum + item.value * item.weight, 0) / totalWeight
    : null;
};

const traitScore = (matches, context, trait) => {
  const affinity = weightedAffinity(matches, trait);
  if (!Number.isFinite(affinity)) return BLOOD_NEUTRAL_SCORE;
  const raceNeed = context?.traits?.[trait] ?? 0.5;
  const suitability = 1 - Math.abs(affinity - raceNeed);
  return clamp(46 + affinity * 24 + suitability * 18, 42, 90);
};

const courseMatchStrength = (match, context) => {
  const desiredIds = context?.bloodBiasIds ?? [];
  if (desiredIds.includes(match.id)) return 1;
  const majorTags = context?.bloodMajorTags ?? [];
  const overlap = [...new Set((match.fit ?? []).filter((tag) => majorTags.includes(tag)))];
  return overlap.length >= 2 ? 0.5 : 0;
};

const withCourseMatch = (matches, context) => matches.map((match) => ({
  ...match,
  courseMatchStrength: courseMatchStrength(match, context),
}));

const courseBloodMatches = (matches) => matches.filter((match) => match.courseMatchStrength > 0);
const courseFemaleMatches = (matches) => matches.filter((match) => match.courseMatchStrength > 0);

const leadingTraits = (matches, context) =>
  ["speed", "power", "stamina", "sustain"]
    .map((trait) => ({ trait, label: TRAIT_LABELS[trait], score: traitScore(matches, context, trait) }))
    .sort((a, b) => b.score - a.score);

const matchedCoverage = (matches) => {
  const entries = new Map();
  for (const match of matches) {
    for (const entry of match.hitEntries ?? []) {
      if (!(entry.coverageWeight > 0)) continue;
      const key = `${entry.branch}:${normalizeName(entry.name)}`;
      entries.set(key, Math.max(entries.get(key) ?? 0, entry.coverageWeight));
    }
  }
  return Number(Math.min(1, [...entries.values()].reduce((sum, value) => sum + value, 0)).toFixed(4));
};

const compatibilityFor = (rule, context, traits = ["speed", "power", "stamina", "sustain"]) => {
  const values = traits
    .map((trait) => {
      const affinity = rule.traits?.[trait];
      if (!Number.isFinite(affinity)) return null;
      const raceNeed = context?.traits?.[trait] ?? 0.5;
      return 1 - Math.abs(affinity - raceNeed);
    })
    .filter(Number.isFinite);
  const traitCompatibility = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0.5;
  const explicitCourseFit = 0.08 * (rule.courseMatchStrength ?? courseMatchStrength(rule, context));
  return Math.min(1, traitCompatibility + explicitCourseFit);
};

const median = (values) => {
  const sorted = [...values].sort((left, right) => left - right);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

const dictionaryRuleCompatibilities = (
  context,
  rules = [...BLOODLINE_RULES, ...FEMALE_LINE_RULES],
) => rules.map((rule) => ({
  id: rule.id,
  compatibility: compatibilityFor(rule, context) * 100,
}));

const dictionaryCompatibilityCenter = (
  context,
  rules = [...BLOODLINE_RULES, ...FEMALE_LINE_RULES],
) => {
  const compatibilities = dictionaryRuleCompatibilities(context, rules);
  return {
    center: median(compatibilities.map((item) => item.compatibility)),
    ruleCount: compatibilities.length,
    compatibilities,
  };
};

const lineageSide = (entry) => entry.branch?.startsWith("dam") ? "dam" : "sire";
const rawRuleAdjustment = (match, context, traits = ["speed", "power", "stamina", "sustain"]) => {
  const compatibility = compatibilityFor(match, context, traits);
  return (compatibility * 100 - 82) * 1.5;
};
const ruleAdjustment = (match, context, traits = ["speed", "power", "stamina", "sustain"]) => {
  const raw = rawRuleAdjustment(match, context, traits);
  return BLOOD_TANH_AMPLITUDE * Math.tanh(raw / BLOOD_TANH_SCALE);
};
const candidateAdjustment = (match, entry, context) => {
  return ruleAdjustment(match, context) * entry.scoreWeight;
};

const resolveRuleMatches = (rawMatches, context) => {
  const candidates = rawMatches.flatMap((match) => (match.hitEntries ?? []).map((entry) => ({ match, entry })));
  const byAncestor = new Map();
  const backgrounds = [];

  for (const candidate of candidates) {
    const key = `${candidate.entry.branch}:${normalizeName(candidate.entry.name)}`;
    const current = byAncestor.get(key);
    const candidateIsScored = candidate.entry.scoreWeight > 0;
    const currentIsScored = current?.entry.scoreWeight > 0;
    const shouldReplace = !current
      || (candidateIsScored !== currentIsScored
        ? candidateIsScored
        : candidate.match.depth > current.match.depth);
    if (shouldReplace) {
      if (current) backgrounds.push({ ...current, reason: "less-specific" });
      byAncestor.set(key, candidate);
    } else {
      backgrounds.push({
        ...candidate,
        reason: candidateIsScored ? "less-specific" : "reference-only",
      });
    }
  }

  const bySide = new Map();
  for (const candidate of byAncestor.values()) {
    if (!(candidate.entry.scoreWeight > 0)) {
      backgrounds.push({ ...candidate, reason: "distant-signal-only" });
      continue;
    }
    const side = lineageSide(candidate.entry);
    const current = bySide.get(side);
    if (!current || candidateAdjustment(candidate.match, candidate.entry, context) > candidateAdjustment(current.match, current.entry, context)) {
      if (current) backgrounds.push({ ...current, reason: "branch-lower-value" });
      bySide.set(side, candidate);
    } else {
      backgrounds.push({ ...candidate, reason: "branch-lower-value" });
    }
  }

  const adopted = withCourseMatch([...bySide.values()].map(({ match, entry }) => ({
    ...match,
    hits: [entry.name],
    hitEntries: [entry],
    roleWeight: entry.scoreWeight,
    coverageWeight: entry.coverageWeight,
    roles: [entry.roleLabel],
  })), context);
  const backgroundMatches = backgrounds.map(({ match, entry, reason }) => ({
    ...match,
    hits: [entry.name],
    hitEntries: [entry],
    roleWeight: entry.scoreWeight,
    coverageWeight: entry.coverageWeight,
    roles: [entry.roleLabel],
    reason,
    signal: `背景: ${match.label}`,
  }));
  return { adopted, backgroundMatches };
};

const branchAdjustmentDetails = (
  matches,
  context,
  predicate = () => true,
  traits = ["speed", "power", "stamina", "sustain"]
) => {
  const evidence = [];
  for (const match of matches) {
    for (const entry of match.hitEntries ?? []) {
      if (!(entry.scoreWeight > 0) || !predicate(entry)) continue;
      evidence.push({
        ruleId: match.id,
        branch: entry.branch,
        raw: rawRuleAdjustment(match, context, traits),
        adjusted: ruleAdjustment(match, context, traits),
        weight: entry.scoreWeight,
      });
    }
  }
  const totalWeight = evidence.reduce((sum, item) => sum + item.weight, 0);
  if (!totalWeight) return { raw: 0, adjusted: 0, totalWeight: 0, scale: BLOOD_TANH_SCALE, evidence };
  const raw = evidence.reduce((sum, item) => sum + item.raw * item.weight, 0) / totalWeight * BRANCH_WEIGHTS.sire;
  const adjusted = evidence.reduce((sum, item) => sum + item.adjusted * item.weight, 0) / totalWeight * BRANCH_WEIGHTS.sire;
  return { raw, adjusted, totalWeight, scale: BLOOD_TANH_SCALE, evidence };
};

const branchAdjustment = (matches, context, predicate, traits) =>
  branchAdjustmentDetails(matches, context, predicate, traits).adjusted;

const evidenceScore = (matches, context, predicate, traits) =>
  clamp(BLOOD_NEUTRAL_SCORE + branchAdjustment(matches, context, predicate, traits), 45, 90);

const distanceBand = (distance) => {
  const value = Number(distance);
  if (!Number.isFinite(value)) return "unknown";
  if (value <= 1400) return "sprint";
  if (value <= 1800) return "mile";
  if (value <= 2200) return "middle";
  return "long";
};

const ancestorName = (pedigree, branch) =>
  pedigree?.ancestors?.find((ancestor) => ancestor.branch === branch)?.name ?? null;

const shrinkHitRate = (statistic, baseline, priorSampleSize = 24) => {
  if (!Number.isFinite(baseline) || !Number.isFinite(statistic?.top3) || !Number.isFinite(statistic?.sampleSize)) {
    return statistic?.hitRate ?? null;
  }
  return (statistic.top3 + baseline * priorSampleSize) / (statistic.sampleSize + priorSampleSize);
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
  const goingKey = `${race.course ?? "unknown"}|${race.surface ?? "unknown"}|${race.trackCondition ?? race.going ?? "unknown"}`;
  const horseName = horse.name ?? horse.horseName ?? horse.currentRace?.horseName;
  const candidates = [
    { scope: "今回コース・距離帯", value: leaveOneHorseOut(entity.courseSurfaceDistance?.[exactKey], horseName), weight: 1 },
    { scope: "今回コース・馬場", value: leaveOneHorseOut(entity.courseSurfaceGoing?.[goingKey], horseName), weight: 0.85 },
    { scope: "同馬場・距離帯", value: leaveOneHorseOut(entity.surfaceDistance?.[broadKey], horseName), weight: 0.75 },
    { scope: "保有データ全体", value: leaveOneHorseOut(entity.overall?.all, horseName), weight: 0.45 },
  ];
  const selected = candidates.find((candidate) => candidate.value?.eligible);
  if (!selected) return null;
  const baseline = BLOOD_STATISTICS.baseline?.hitRate;
  const posteriorHitRate = shrinkHitRate(selected.value, baseline);
  const lift = Number.isFinite(baseline) && Number.isFinite(posteriorHitRate) ? posteriorHitRate - baseline : 0;
  return {
    entityType,
    name,
    scope: selected.scope,
    weight: selected.weight,
    ...selected.value,
    rawHitRate: selected.value.hitRate,
    shrunkHitRate: Number.isFinite(posteriorHitRate) ? Number(posteriorHitRate.toFixed(4)) : null,
    priorSampleSize: 24,
    adjustment: Math.max(-4, Math.min(4, Math.round(lift * 18 * selected.weight))),
  };
};

const buildBloodStatistics = (horse) => {
  if (BLOOD_STATISTICS.status !== "approved") return [];
  const pedigree = horse.pedigree ?? {};
  const sire = statisticFor("sire", pedigree.sire ?? horse.currentRace?.sire, horse)
    ?? statisticFor("sireLine", pedigree.sireSire ?? ancestorName(pedigree, "sire.sire"), horse);
  const broodmareSire = statisticFor("broodmareSire", pedigree.broodmareSire ?? horse.currentRace?.broodmareSire, horse)
    ?? statisticFor("broodmareSireLine", ancestorName(pedigree, "dam.sire.sire"), horse);
  return [sire, broodmareSire, statisticFor("femaleLine", pedigree.damDam, horse)].filter(Boolean);
};

const buildBloodProfile = (horse, context) => {
  const entries = pedigreeEntries(horse);
  if (!entries.length) {
    return {
      score: BLOOD_NEUTRAL_SCORE,
      displayScore: BLOOD_NEUTRAL_SCORE,
      status: "missing",
      confidence: "low",
      coverage: 0,
      matches: [],
      femaleMatches: [],
      courseMatches: [],
      femaleCourseMatches: [],
      backgroundMatches: [],
      statistics: [],
      contributionDiagnostics: { raw: 0, adjusted: 0, totalWeight: 0, scale: BLOOD_TANH_SCALE, evidence: [] },
      traits: leadingTraits([], context),
      components: {
        paternal: BLOOD_NEUTRAL_SCORE,
        maternal: BLOOD_NEUTRAL_SCORE,
        course: BLOOD_NEUTRAL_SCORE,
        distance: BLOOD_NEUTRAL_SCORE,
        blend: BLOOD_NEUTRAL_SCORE,
        statistics: BLOOD_NEUTRAL_SCORE,
      },
    };
  }

  const rawMatches = matchLines(horse);
  const rawFemaleMatches = matchFemaleLines(horse);
  const { adopted, backgroundMatches } = resolveRuleMatches([...rawMatches, ...rawFemaleMatches], context);
  const matches = adopted.filter((match) => match.source === "bloodline");
  const femaleMatches = adopted.filter((match) => match.source === "femaleLine");
  const courseMatches = courseBloodMatches(matches);
  const femaleCourseMatches = courseFemaleMatches(femaleMatches);
  const allMatches = adopted;
  const traits = leadingTraits(allMatches, context);
  const paternal = evidenceScore(matches, context, (entry) => entry.branch?.startsWith("sire"));
  const maternalLines = [...matches, ...femaleMatches];
  const maternal = evidenceScore(maternalLines, context, (entry) => entry.branch?.startsWith("dam"));
  const course = evidenceScore([...courseMatches, ...femaleCourseMatches], context);
  const distanceNeed =
    Number(horse.currentRace?.distance) >= 2200 ? ["stamina", "sustain"] :
    Number(horse.currentRace?.distance) <= 1400 ? ["speed", "power"] :
    ["speed", "sustain", "stamina"];
  const distance = evidenceScore(allMatches, context, undefined, distanceNeed);
  const hasScoredEvidence = allMatches.some((match) => (match.roleWeight ?? 0) > 0);
  const blend = hasScoredEvidence ? evidenceScore(allMatches, context) : BLOOD_NEUTRAL_SCORE;
  const coverage = matchedCoverage([...rawMatches, ...rawFemaleMatches]);
  const statistics = buildBloodStatistics(horse);
  const statisticsAdjustment = Math.max(
    -5,
    Math.min(
      5,
      Math.round(statistics.reduce((sum, item) => {
        const roleWeight =
          item.entityType === "sire" ? 0.6 :
          item.entityType === "broodmareSire" ? 0.35 :
          item.entityType === "sireLine" ? 0.25 :
          item.entityType === "broodmareSireLine" ? 0.15 :
          0.1;
        return sum + item.adjustment * roleWeight;
      }, 0))
    )
  );
  const boundedStatisticsAdjustment = clamp(statisticsAdjustment, -3, 3);
  const statisticsScore = clamp(BLOOD_NEUTRAL_SCORE + boundedStatisticsAdjustment, 45, 85);
  const confidence = coverage >= 0.65 ? "high" : coverage >= 0.35 ? "mid" : "low";
  const status = hasScoredEvidence ? (confidence === "low" ? "partial" : "active") : "partial";
  const baseScore = evidenceScore(allMatches, context);
  const contributionDiagnostics = branchAdjustmentDetails(allMatches, context);
  const score = clamp(baseScore + boundedStatisticsAdjustment, 42, 92);

  return {
    score,
    displayScore: displayScore(score),
    baseScore,
    status,
    confidence,
    coverage,
    entries,
    matches,
    femaleMatches,
    courseMatches,
    femaleCourseMatches,
    backgroundMatches,
    rawMatches,
    rawFemaleMatches,
    statistics,
    statisticsAdjustment: boundedStatisticsAdjustment,
    statisticsApplied: statistics.length > 0,
    contributionDiagnostics,
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
      statistic.entityType === "sireLine" ? `父系${statistic.name}実績` :
      statistic.entityType === "broodmareSireLine" ? `母父系${statistic.name}実績` :
      `${statistic.name}牝系実績`,
    text: `${statistic.scope}で${statistic.sampleSize}走・${statistic.uniqueHorseCount}頭、勝率${(statistic.winRate * 100).toFixed(1)}%、複勝率${(statistic.hitRate * 100).toFixed(1)}%（平均回帰後${(statistic.shrunkHitRate * 100).toFixed(1)}%）。`,
    score: bloodScore,
    sampleSize: statistic.sampleSize,
    uniqueHorseCount: statistic.uniqueHorseCount,
    winRate: statistic.winRate,
    hitRate: statistic.hitRate,
    shrunkHitRate: statistic.shrunkHitRate,
    priorSampleSize: statistic.priorSampleSize,
    confidence: statistic.confidence,
    adjustment: statistic.adjustment,
  }));
  const structuralStrengths = profile.backgroundMatches
    .filter((match) => match.evidenceStatus === "structure-only")
    .slice(0, 2)
    .map((match) => ({
      key: `structure-${match.id}`,
      label: match.label,
      text: `${match.hits.join("・")}から${match.label}の系統構造を確認。系統名だけでは加点せず、実績統計を優先します。`,
      score: bloodScore,
      confidence: "low",
      adjustment: 0,
      scoreApplied: false,
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
  const bloodV2 = buildBloodEvidenceV2({ horse, context, profile, bloodScore });

  return {
    headline: bloodV2.summary,
    version: bloodV2.version,
    status: profile.status,
    confidence: profile.confidence,
    confidenceGrade: bloodV2.confidenceGrade,
    confidenceBasis: bloodV2.confidenceBasis,
    coverage: profile.coverage,
    identity: bloodV2.identity,
    sireProfile: bloodV2.sireProfile,
    broodmareSireProfile: bloodV2.broodmareSireProfile,
    crosses: bloodV2.crosses,
    crossStatus: bloodV2.crossStatus,
    dataCompleteness: bloodV2.completeness,
    componentDetails: bloodV2.components,
    evidenceV2: bloodV2.evidence,
    unavailable: bloodV2.unavailable,
    components: profile.components,
    statistics: profile.statistics,
    statisticsAdjustment: profile.statisticsAdjustment,
    strengths: [...strengths, ...femaleStrengths, ...structuralStrengths, ...statisticStrengths],
    lines: [
      buildLine("父系", pedigree?.sire ?? horse.currentRace?.sire, `父系の主軸。今回条件への適性は${Math.round(profile.components.paternal)}。`),
      buildLine("母系", pedigree?.dam ?? horse.currentRace?.dam, `母系の補完力を評価。母系総合は${Math.round(profile.components.maternal)}。`),
      buildLine("母父", pedigree?.broodmareSire ?? horse.currentRace?.broodmareSire, "パワー、馬場適性、距離適性の補強要素として見ます。"),
      buildLine("牝系", pedigree?.damDam, femaleStrengths.length ? `${femaleStrengths[0].label}の特徴を確認。` : "牝系側のスタミナと底力を確認します。"),
    ],
    structure: {
      ancestorCount: pedigree?.ancestors?.length ?? 0,
      completeness: bloodV2.completeness.label,
    },
    raceBias: {
      score: bloodScore,
      grade: bloodScore >= 82 ? "高" : bloodScore >= 68 ? "中" : "低",
      matched: matches,
      courseMatched: courseMatches,
      femaleMatched: femaleMatches,
      femaleCourseMatched: femaleCourseMatches,
      summary: `${context?.summary ?? "レース条件未取得"} ${bloodV2.summary}`,
    },
    traits,
    scores,
  };
};

export {
  scoreBlood,
  buildBloodProfile,
  buildPedigreeAnalysis,
  resolveRuleMatches,
  dictionaryRuleCompatibilities,
  dictionaryCompatibilityCenter,
  compatibilityFor,
};
