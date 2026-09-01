import { findSireProfile } from "./dictionaries/sire-profile-dictionary.mjs";

const EXPECTED_FOUR_GENERATION_ENTRIES = 30;
const EXPECTED_FIVE_GENERATION_ENTRIES = 62;

const normalizeAncestorName = (value) =>
  String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[＊*$]/g, "")
    .replace(/[.'’\-\s]+/g, "")
    .trim();

const asSentence = (value) => `${String(value ?? "").replace(/[。.]+$/u, "")}。`;

const lineageSide = (branch) => {
  const value = String(branch ?? "");
  if (value === "sire" || value.startsWith("sire.")) return "sire";
  if (value === "dam" || value.startsWith("dam.")) return "dam";
  return "unknown";
};

const pedigreeFeatureEntries = (horse) => {
  const pedigree = horse?.pedigree ?? {};
  const direct = [
    { generation: 1, branch: "sire", name: pedigree.sire ?? horse?.currentRace?.sire },
    { generation: 1, branch: "dam", name: pedigree.dam ?? horse?.currentRace?.dam },
    { generation: 2, branch: "sire.sire", name: pedigree.sireSire },
    { generation: 2, branch: "sire.dam", name: pedigree.sireDam },
    { generation: 2, branch: "dam.sire", name: pedigree.broodmareSire ?? horse?.currentRace?.broodmareSire },
    { generation: 2, branch: "dam.dam", name: pedigree.damDam },
  ];
  const seen = new Set();
  return [...direct, ...(pedigree.ancestors ?? [])]
    .filter((entry) => entry?.name)
    .map((entry) => ({
      generation: Number(entry.generation) || null,
      branch: entry.branch ?? "unknown",
      side: lineageSide(entry.branch),
      name: String(entry.name).trim(),
      normalizedName: normalizeAncestorName(entry.name),
    }))
    .filter((entry) => {
      const key = `${entry.branch}:${entry.normalizedName}`;
      if (!entry.normalizedName || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

const detectPedigreeCrosses = (entries) => {
  const byAncestor = new Map();
  for (const entry of entries ?? []) {
    if (!entry.normalizedName || !Number.isFinite(entry.generation)) continue;
    const current = byAncestor.get(entry.normalizedName) ?? [];
    current.push(entry);
    byAncestor.set(entry.normalizedName, current);
  }

  return [...byAncestor.values()]
    .filter((hits) => new Set(hits.map((hit) => hit.branch)).size >= 2)
    .filter((hits) => {
      const sides = new Set(hits.map((hit) => hit.side));
      return sides.has("sire") && sides.has("dam");
    })
    .map((hits) => {
      const ordered = [...hits].sort((left, right) =>
        left.generation - right.generation || left.branch.localeCompare(right.branch, "ja")
      );
      const positions = ordered.map((hit) => hit.generation);
      return {
        ancestor: ordered[0].name,
        positions,
        pattern: positions.join("x"),
        branches: ordered.map((hit) => hit.branch),
        sides: ordered.map((hit) => hit.side),
        status: "detected",
      };
    })
    .sort((left, right) =>
      Math.min(...left.positions) - Math.min(...right.positions) || left.ancestor.localeCompare(right.ancestor, "ja")
    );
};

const confidenceFromSample = (sampleSize) => {
  if (sampleSize >= 100) return "A";
  if (sampleSize >= 50) return "B";
  if (sampleSize >= 20) return "C";
  if (sampleSize >= 10) return "D";
  return "Low";
};

const confidenceRank = { A: 0, B: 1, C: 2, D: 3, Low: 4 };
const lowerConfidence = (...grades) =>
  grades.filter(Boolean).sort((left, right) => confidenceRank[right] - confidenceRank[left])[0] ?? "Low";

const pedigreeCompleteness = (entries, pedigree) => {
  const count = entries.length;
  const deepestGeneration = entries.reduce((max, entry) => Math.max(max, entry.generation ?? 0), 0);
  const sourceCompleteness = pedigree?.source?.completeness ?? null;
  const fiveGenerationComplete = count >= EXPECTED_FIVE_GENERATION_ENTRIES && deepestGeneration >= 5;
  const fourGenerationComplete = count >= EXPECTED_FOUR_GENERATION_ENTRIES && deepestGeneration >= 4;
  const complete = fiveGenerationComplete || fourGenerationComplete;
  const threeGenerationComplete = sourceCompleteness === "three-generation-14"
    || (count >= 14 && deepestGeneration >= 3);
  const basicPedigreeComplete = sourceCompleteness === "basic-4-line";
  return {
    status: complete ? "complete" : count ? "partial" : "missing",
    label: fiveGenerationComplete
      ? "5代相当取得済み"
      : fourGenerationComplete
        ? "4代取得済み"
      : threeGenerationComplete
        ? "3代相当取得済み"
        : basicPedigreeComplete
          ? "基本血統取得済み"
        : count
          ? "血統一部取得"
          : "血統未取得",
    entryCount: count,
    expectedEntries: fiveGenerationComplete
      ? EXPECTED_FIVE_GENERATION_ENTRIES
      : EXPECTED_FOUR_GENERATION_ENTRIES,
    deepestGeneration,
    sourceCompleteness,
  };
};

const assessPedigreeCompleteness = (horse) =>
  pedigreeCompleteness(pedigreeFeatureEntries(horse), horse?.pedigree ?? {});

const component = (score, status, label, evidence = []) => ({
  score: Number.isFinite(score) ? score : null,
  status,
  label,
  evidence,
});

const buildComponentDetails = ({ profile, context, crosses, pairingReference }) => {
  const hasSire = profile.matches.some((match) => match.hitEntries?.some((entry) => entry.role === "sire"));
  const hasBms = [...profile.matches, ...profile.femaleMatches]
    .some((match) => match.hitEntries?.some((entry) => entry.role === "broodmareSire"));
  const hasCourse = profile.courseMatches.length + profile.femaleCourseMatches.length > 0;
  const statisticSample = profile.statistics.reduce((max, statistic) => Math.max(max, statistic.sampleSize ?? 0), 0);

  return {
    sireTrait: component(profile.components.paternal, hasSire ? "active" : "unavailable", "父の血統特性"),
    broodmareSire: component(profile.components.maternal, hasBms ? "active" : "unavailable", "母父・母系の補完"),
    pairing: component(
      null,
      pairingReference?.pairing ? "reference_only" : "insufficient_sample",
      pairingReference?.pairing
        ? `${pairingReference.pairing.fallbackLevel} ${pairingReference.pairing.sampleSize}走（参考）`
        : "父×母父の配合統計",
      pairingReference?.pairing ? [pairingReference.pairing.label] : [],
    ),
    sireLineBroodmareSireLine: component(
      null,
      pairingReference?.pairing?.fallbackLevel === "父系×母父系" ? "reference_only" : "insufficient_sample",
      "父系統×母父系統",
    ),
    distanceFit: component(profile.components.distance, profile.matches.length ? "active" : "unavailable", `${context?.distance ?? "-"}mへの血統適合`),
    surfaceFit: component(null, "insufficient_sample", `${context?.surface ?? "芝・ダート未取得"}の集団実績`),
    courseFit: component(hasCourse ? profile.components.course : null, hasCourse ? "active" : "unavailable", `${context?.course ?? "開催場未取得"}への明示適合`),
    trackGeometryFit: component(hasCourse ? profile.components.course : null, hasCourse ? "active" : "unavailable", "コース形態への血統適合"),
    goingFit: component(context?.going ? profile.components.course : null, context?.going ? "reference_only" : "unavailable", `${context?.going ?? "馬場未取得"}への血統適合`),
    crossFit: component(
      null,
      crosses.length ? "reference_only" : "unavailable",
      pairingReference?.crosses?.length
        ? `クロス統計 ${pairingReference.crosses[0].sampleSize}走（参考）`
        : "クロス適合",
      crosses.map((cross) => `${cross.ancestor} ${cross.pattern}`),
    ),
    familyFit: component(profile.components.maternal, profile.femaleMatches.length ? "active" : "unavailable", "牝系の補完"),
    historicalEvidence: component(
      profile.statisticsApplied ? profile.components.statistics : null,
      statisticSample ? "reference_only" : "insufficient_sample",
      "時点付き血統集団実績",
      profile.statistics.map((statistic) => `${statistic.name} ${statistic.sampleSize}走`),
    ),
    individualProfileFit: component(
      profile.individualProfileEvidence.length ? profile.components.individualProfile : null,
      profile.individualProfileEvidence.length ? "active" : "unavailable",
      "個別血統プロフィール適合",
      profile.individualProfileEvidence.map((item) =>
        `${item.roleLabel}${item.name} ${item.impact >= 0 ? "+" : ""}${item.impact.toFixed(2)}`
      ),
    ),
  };
};

const matchForRole = (profile, role) =>
  [...profile.matches, ...profile.femaleMatches].find((match) =>
    match.hitEntries?.some((entry) => entry.role === role)
  );

const uniqueMatches = (matches) => [...new Map(
  (matches ?? []).filter(Boolean).map((match) => [match.id, match])
).values()];

const matchFitLabels = (matches, limit = 3) => [...new Set(
  uniqueMatches(matches).flatMap((match) => match.fit ?? [])
)].filter((label) => !/系$/.test(label)).slice(0, limit);

const ancestorAt = (pedigree, branch) =>
  pedigree?.ancestors?.find((ancestor) => ancestor.branch === branch)?.name ?? null;

const buildSireFeature = ({ sire, pedigree, sireMatch, paternalMatches, profileEvidence }) => {
  if (!sire) return null;
  const curated = findSireProfile(sire);
  const recordedAncestry = [pedigree.sireSire, pedigree.sireDam].filter(Boolean);
  const ancestry = curated?.ancestry?.length ? curated.ancestry : recordedAncestry;
  const ancestryText = ancestry.length ? `${ancestry.join(" × ")}。` : "父方祖先は一部未取得。";
  const adoptedMatches = uniqueMatches([sireMatch, ...(paternalMatches ?? [])]);
  const lineLabels = adoptedMatches.slice(0, 2).map((match) => match.label);
  const fitLabels = matchFitLabels(adoptedMatches);
  const evidenceText = lineLabels.length
    ? `取得済み祖先から${lineLabels.join("と")}を確認。${fitLabels.length ? `${fitLabels.join("・")}を父方の評価材料にします。` : "父方の系統Evidenceとして保持します。"}`
    : "取得済みの祖先構成をEvidenceとして保持し、条件適合は中立評価とします。";
  const summary = curated?.summary
    ? `父${sire}は${ancestryText}${curated.summary}`
    : `父${sire}は${ancestryText}${evidenceText}`;

  return {
    id: curated?.id ?? null,
    sire,
    ancestry,
    traits: curated?.traits ?? fitLabels,
    evidenceLines: lineLabels,
    summary,
    status: curated ? "curated" : recordedAncestry.length ? "ancestry_fallback" : "unavailable",
    sourceType: curated?.sourceType ?? "pedigree_structure",
    scoreApplied: Boolean(curated && profileEvidence?.scoreApplied),
    impact: profileEvidence?.impact ?? 0,
    compatibility: profileEvidence?.compatibility ?? null,
    center: profileEvidence?.center ?? null,
  };
};

const buildBroodmareSireFeature = ({ broodmareSire, pedigree, bmsMatch, maternalMatches, profileEvidence }) => {
  if (!broodmareSire) return null;
  const curated = findSireProfile(broodmareSire);
  const recordedAncestry = [
    ancestorAt(pedigree, "dam.sire.sire"),
    ancestorAt(pedigree, "dam.sire.dam"),
  ].filter(Boolean);
  const ancestry = curated?.ancestry?.length ? curated.ancestry : recordedAncestry;
  const ancestryText = ancestry.length ? `${ancestry.join(" × ")}。` : "母父側祖先は一部未取得。";
  const adoptedMatches = uniqueMatches([bmsMatch, ...(maternalMatches ?? [])]);
  const lineLabels = adoptedMatches.slice(0, 2).map((match) => match.label);
  const fitLabels = matchFitLabels(adoptedMatches);
  const evidenceText = lineLabels.length
    ? `取得済み祖先から${lineLabels.join("と")}を確認。${fitLabels.length ? `${fitLabels.join("・")}を母父側の評価材料にします。` : "母父側の系統Evidenceとして保持します。"}`
    : "取得済みの祖先構成をEvidenceとして保持し、条件適合は中立評価とします。";
  return {
    id: curated?.id ?? null,
    broodmareSire,
    ancestry,
    traits: curated?.traits ?? fitLabels,
    evidenceLines: lineLabels,
    summary: curated?.summary
      ? `母父${broodmareSire}は${ancestryText}${curated.summary}`
      : `母父${broodmareSire}は${ancestryText}${evidenceText}`,
    status: curated ? "curated" : recordedAncestry.length ? "ancestry_fallback" : "unavailable",
    sourceType: curated?.sourceType ?? "pedigree_structure",
    scoreApplied: Boolean(curated && profileEvidence?.scoreApplied),
    impact: profileEvidence?.impact ?? 0,
    compatibility: profileEvidence?.compatibility ?? null,
    center: profileEvidence?.center ?? null,
  };
};

const buildBloodEvidenceV2 = ({ horse, context, profile, bloodScore, pairingReference = null }) => {
  const pedigree = horse?.pedigree ?? {};
  const entries = pedigreeFeatureEntries(horse);
  const completeness = pedigreeCompleteness(entries, pedigree);
  const crosses = detectPedigreeCrosses(entries);
  const sire = pedigree.sire ?? horse?.currentRace?.sire ?? null;
  const broodmareSire = pedigree.broodmareSire ?? horse?.currentRace?.broodmareSire ?? null;
  const sireMatch = matchForRole(profile, "sire");
  const bmsMatch = matchForRole(profile, "broodmareSire");
  const paternalMatches = [...profile.matches, ...profile.femaleMatches].filter((match) =>
    match.hitEntries?.some((entry) => entry.branch?.startsWith("sire"))
  );
  const maternalMatches = [...profile.matches, ...profile.femaleMatches].filter((match) =>
    match.hitEntries?.some((entry) => entry.branch?.startsWith("dam.sire"))
  );
  const sireProfileEvidence = profile.individualProfileEvidence.find((item) => item.role === "sire") ?? null;
  const bmsProfileEvidence = profile.individualProfileEvidence.find((item) => item.role === "broodmareSire") ?? null;
  const ancestorProfileEvidence = profile.individualProfileEvidence.filter(
    (item) => item.sourceType === "ancestor_profile_fallback"
  );
  const sireProfile = buildSireFeature({
    sire,
    pedigree,
    sireMatch,
    paternalMatches,
    profileEvidence: sireProfileEvidence,
  });
  const broodmareSireProfile = buildBroodmareSireFeature({
    broodmareSire,
    pedigree,
    bmsMatch,
    maternalMatches,
    profileEvidence: bmsProfileEvidence,
  });
  const bestStatistic = [...profile.statistics].sort((left, right) =>
    (right.sampleSize ?? 0) - (left.sampleSize ?? 0)
  )[0] ?? null;
  const sampleGrade = bestStatistic ? confidenceFromSample(bestStatistic.sampleSize) : "D";
  const completenessGrade = completeness.status === "complete" ? "A" : completeness.status === "partial" ? "D" : "Low";
  const coverageGrade = profile.coverage >= 0.65 ? "B" : profile.coverage >= 0.35 ? "C" : profile.coverage > 0 ? "D" : "Low";
  const confidenceGrade = lowerConfidence(sampleGrade, completenessGrade, coverageGrade);
  const pairLabel = sire && broodmareSire ? `${sire} × ${broodmareSire}` : [sire, broodmareSire].filter(Boolean).join(" × ") || "配合未取得";
  const bmsFit = matchFitLabels([bmsMatch]);
  const lineText = broodmareSireProfile
    ? broodmareSireProfile.summary
    : bmsMatch
    ? `母父${broodmareSire}は${bmsMatch.label}として、${bmsFit.length ? bmsFit.join("・") : "母系の補完力"}を評価`
    : "母父情報は未取得のため中立評価";
  const condition = [context?.course, context?.surface, Number(context?.distance) ? `${context.distance}m` : null]
    .filter(Boolean).join("");
  const matchText = profile.courseMatches.length || profile.femaleCourseMatches.length
    ? `${condition || "今回条件"}への明示的な血統適合を確認。`
    : `${condition || "今回条件"}は距離・系統特性から評価。`;
  const crossText = crosses.length
    ? `${crosses.slice(0, 2).map((cross) => `${cross.ancestor} ${cross.pattern}`).join("、")}を検出。`
    : "";
  const statisticText = bestStatistic
    ? `${bestStatistic.name}の${bestStatistic.scope}は${bestStatistic.sampleSize}走・${bestStatistic.uniqueHorseCount}頭を参照。`
    : "";
  const pairingMetric = pairingReference?.pairing ?? null;
  const pairingReferenceText = pairingMetric
    ? `${pairingMetric.fallbackLevel}の${pairingMetric.scope}は${pairingMetric.sampleSize}走・${pairingMetric.uniqueHorseCount}頭を参考表示（点数未接続）。`
    : "";
  const profileAdjustmentText = profile.individualProfileEvidence.length
    ? `個別プロフィール適合 ${profile.individualProfileAdjustment >= 0 ? "+" : ""}${profile.individualProfileAdjustment.toFixed(1)}点。`
    : "";
  const summary = `${pairLabel}。${asSentence(sireProfile?.summary ?? "父の固有情報は未取得")}${asSentence(lineText)}${matchText}${crossText}${statisticText}${pairingReferenceText}${profileAdjustmentText} Confidence ${confidenceGrade}。`;

  const crossReferenceByLabel = new Map(
    (pairingReference?.crosses ?? []).map((reference) => [reference.label, reference])
  );

  const evidence = [
    {
      type: "pairing",
      label: pairingMetric?.label ?? pairLabel,
      status: pairingMetric?.status ?? (sire && broodmareSire ? "observed" : "unavailable"),
      sample: pairingMetric?.sampleSize ?? null,
      uniqueHorses: pairingMetric?.uniqueHorseCount ?? null,
      hitRate: pairingMetric?.hitRate ?? null,
      shrunkHitRate: pairingMetric?.shrunkHitRate ?? null,
      baselineHitRate: pairingMetric?.baselineHitRate ?? null,
      scope: pairingMetric?.scope ?? null,
      fallbackLevel: pairingMetric?.fallbackLevel ?? null,
      impact: 0,
      scoreApplied: false,
      sourceType: pairingMetric?.sourceType ?? "pedigree_identity",
      evaluationCutoff: pairingMetric?.evaluationCutoff ?? null,
    },
    ...(sireProfile ? [{
      type: "sireProfile",
      label: sireProfile.summary,
      status: sireProfile.status,
      sample: null,
      impact: sireProfile.impact,
      scoreApplied: sireProfile.scoreApplied,
      compatibility: sireProfile.compatibility,
      center: sireProfile.center,
      sourceType: sireProfile.sourceType,
    }] : []),
    ...(broodmareSireProfile ? [{
      type: "broodmareSireProfile",
      label: broodmareSireProfile.summary,
      status: broodmareSireProfile.status,
      sample: null,
      impact: broodmareSireProfile.impact,
      scoreApplied: broodmareSireProfile.scoreApplied,
      compatibility: broodmareSireProfile.compatibility,
      center: broodmareSireProfile.center,
      sourceType: broodmareSireProfile.sourceType,
    }] : []),
    ...ancestorProfileEvidence.map((item) => ({
      type: "ancestorProfile",
      label: `${item.roleLabel}${item.name} (${item.branch})`,
      status: "inherited",
      sample: null,
      impact: item.impact,
      scoreApplied: true,
      compatibility: item.compatibility,
      center: item.center,
      sourceType: item.sourceType,
      generation: item.generation,
      weight: item.weight,
    })),
    ...[sireMatch, bmsMatch].filter(Boolean).map((match) => ({
      type: match === sireMatch ? "sire" : "broodmareSire",
      label: `${match.roles.join("・")} ${match.hits.join("・")} / ${match.label}`,
      status: "knowledge",
      sample: null,
      impact: null,
      scoreApplied: true,
      ruleId: match.id,
    })),
    ...crosses.map((cross) => {
      const label = `${cross.ancestor} ${cross.pattern}`;
      const reference = crossReferenceByLabel.get(label);
      return {
        type: "cross",
        label,
        status: reference?.status ?? "detected",
        sample: reference?.sampleSize ?? null,
        uniqueHorses: reference?.uniqueHorseCount ?? null,
        hitRate: reference?.hitRate ?? null,
        shrunkHitRate: reference?.shrunkHitRate ?? null,
        baselineHitRate: reference?.baselineHitRate ?? null,
        scope: reference?.scope ?? null,
        impact: 0,
        scoreApplied: false,
        sourceType: reference?.sourceType ?? "pedigree_structure",
        evaluationCutoff: reference?.evaluationCutoff ?? null,
        branches: cross.branches,
      };
    }),
    ...profile.statistics.map((statistic) => ({
      type: statistic.entityType,
      label: `${statistic.name} ${statistic.scope}`,
      status: statistic.confidence,
      sample: statistic.sampleSize,
      uniqueHorses: statistic.uniqueHorseCount,
      winRate: statistic.winRate,
      hitRate: statistic.hitRate,
      impact: profile.statisticsApplied ? statistic.adjustment : 0,
      scoreApplied: profile.statisticsApplied,
      asOf: null,
      timeScope: "unavailable",
    })),
  ];

  return {
    version: "blood-evidence-v2",
    score: bloodScore,
    scoreChanged: Math.abs(profile.individualProfileAdjustment) > 0,
    identity: {
      sire,
      dam: pedigree.dam ?? horse?.currentRace?.dam ?? null,
      broodmareSire,
      sireSire: pedigree.sireSire ?? null,
      sireDam: pedigree.sireDam ?? null,
      damDam: pedigree.damDam ?? null,
      pairLabel,
    },
    sireProfile,
    broodmareSireProfile,
    entries,
    crosses,
    crossStatus: crosses.length ? "detected" : completeness.status === "complete" ? "none_detected" : "unavailable",
    completeness,
    confidenceGrade,
    confidenceBasis: {
      sampleGrade,
      completenessGrade,
      coverageGrade,
      sampleSize: bestStatistic?.sampleSize ?? 0,
      uniqueHorseCount: bestStatistic?.uniqueHorseCount ?? 0,
      coverage: profile.coverage,
    },
    summary,
    components: buildComponentDetails({ profile, context, crosses, pairingReference }),
    evidence,
    pairingReference,
    unavailable: [
      !profile.statistics.length ? "condition_statistics" : null,
      completeness.status !== "complete" ? "full_four_generation_pedigree" : null,
      !crosses.length && completeness.status !== "complete" ? "cross_evaluation" : null,
      !pairingMetric ? "pairing_statistics" : null,
    ].filter(Boolean),
  };
};

export {
  EXPECTED_FIVE_GENERATION_ENTRIES,
  EXPECTED_FOUR_GENERATION_ENTRIES,
  assessPedigreeCompleteness,
  buildBloodEvidenceV2,
  confidenceFromSample,
  detectPedigreeCrosses,
  normalizeAncestorName,
  pedigreeFeatureEntries,
};
