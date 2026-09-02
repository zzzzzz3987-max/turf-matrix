import { findPedigreePublicProfile } from "../data/pedigree-public-profiles.js";
import { selectPublicRoleHorses } from "./public-role-selection.js";

export const PUBLIC_FACTOR_LABELS = {
  ability: "能力",
  blood: "血統",
  training: "調教",
  course: "コース",
  distance: "距離適性",
  load: "斤量",
  pace: "展開",
  trackBias: "馬場傾向",
  stable: "厩舎",
  form: "近走",
  value: "期待値",
};

export const QUICK_READ_FACTOR_KEYS = [
  "ability", "distance", "course", "training", "pace",
  "trackBias", "stable", "form", "load", "blood",
];

const isFiniteScore = (value) => typeof value === "number" && Number.isFinite(value);

const INTERNAL_COPY_MARKERS = [
  /Confidence/i,
  /Evidence/i,
  /TARGET/i,
  /参照/,
  /取得済み/,
  /未取得/,
  /取得待ち/,
  /一部取得/,
  /未照合/,
  /未確認/,
  /未確定/,
  /サンプル/,
  /データ充足度/,
  /今後拡張/,
];

const splitSentences = (value) =>
  String(value ?? "").match(/[^。！？]+[。！？]?/g) ?? [];

export const sanitizePublicText = (value) => {
  const normalized = String(value ?? "")
    .replace(/&#x20;|&nbsp;/gi, " ")
    .replace(/馬番(\d+)を補助情報として評価。枠順の高度な有利不利判定は今後拡張します。?/g, "$1番枠は今回条件で標準評価。")
    .replace(/\d{4}-\d{2}-\d{2}の同会場・同馬場\d+Rを監視。?/g, "前日の同会場・同馬場の傾向を評価。")
    .replace(/人気補正後の根拠が弱いため指数補正は行いません。?/g, "馬場傾向による加点はありません。")
    .replace(/個別プロフィール適合\s*[+-]?\d+(?:\.\d+)?点。?/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) return null;
  const publicSentences = splitSentences(normalized)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .filter((sentence) => !INTERNAL_COPY_MARKERS.some((pattern) => pattern.test(sentence)))
    .filter((sentence) => !/保有データ全体は\d+走・\d+頭/.test(sentence));

  return publicSentences.join("").replace(/\s+/g, " ").trim() || null;
};

export const summarizePublicText = (value, { maxLength = 118, sentences = 2 } = {}) => {
  const publicText = sanitizePublicText(value);
  if (!publicText) return null;
  const concise = splitSentences(publicText).slice(0, sentences).join("").trim();
  if (!concise) return null;
  return concise.length <= maxLength
    ? concise
    : `${concise.slice(0, Math.max(1, maxLength - 1)).trim()}…`;
};

export const publicFactorSummary = (value, maxLength = 86) =>
  summarizePublicText(value, { maxLength, sentences: 1 });

export const publicHorseComment = (horse, maxLength = 72) =>
  summarizePublicText(horse?.comment, { maxLength, sentences: 1 }) ?? "評価の詳細を確認";

export const publicScoreBand = (score) => {
  if (!isFiniteScore(score)) return { label: "情報なし", level: "unknown" };
  if (score >= 80) return { label: "強み", level: "strong" };
  if (score >= 70) return { label: "プラス", level: "positive" };
  if (score >= 60) return { label: "標準", level: "neutral" };
  if (score >= 50) return { label: "慎重", level: "cautious" };
  return { label: "注意", level: "warning" };
};

export const publicConditionFit = (score) => {
  if (!isFiniteScore(score)) return "情報なし";
  if (score >= 80) return "非常に合う";
  if (score >= 75) return "合う";
  if (score >= 70) return "やや合う";
  if (score >= 60) return "標準";
  if (score >= 50) return "やや不安";
  return "不安";
};

export const publicTrainingGrade = (grade) => ({
  A: "高評価",
  B: "良好",
  C: "標準",
  D: "慎重",
}[String(grade ?? "").toUpperCase()] ?? "情報なし");

export const publicTrainingHeadline = (evalData) => {
  if (!evalData) return null;
  const gradeLabel = publicTrainingGrade(evalData.grade);
  const finalScore = evalData.details?.final?.score;
  const finalLabel = isFiniteScore(finalScore)
    ? finalScore >= 75 ? "良好"
      : finalScore >= 70 ? "水準以上"
        : finalScore >= 60 ? "標準"
          : "慎重"
    : null;

  if (finalLabel) return `最終追い切りは${finalLabel}。調教全体は${gradeLabel}評価です。`;
  return `調教全体は${gradeLabel}評価です。`;
};

const publicPatternLabel = (value) => {
  const label = String(value ?? "")
    .split("への合致度")[0]
    .replace(/はサンプル不足.*$/u, "")
    .trim();
  return label || "今回の追い切り構成";
};

export const buildStablePatternPublicView = (stablePattern) => {
  const rawText = String(stablePattern?.text ?? stablePattern?.label ?? "");
  const degree = isFiniteScore(stablePattern?.degree) ? stablePattern.degree : stablePattern?.match ? 1 : null;
  const isMatched = stablePattern?.match === true || (
    stablePattern?.status === "照合済" && isFiniteScore(degree) && degree >= 0.6
  );
  if (!isMatched) return null;
  const parsedSample = rawText.match(/n=(\d+)/i)?.[1];
  const parsedHitRate = rawText.match(/複勝率(\d+(?:\.\d+)?)%/)?.[1];
  const parsedBaseline = rawText.match(/厩舎基準(\d+(?:\.\d+)?)%/)?.[1];
  const sampleSize = isFiniteScore(stablePattern.sampleSize)
    ? Math.round(stablePattern.sampleSize)
    : parsedSample ? Number(parsedSample) : null;
  const hitRate = isFiniteScore(stablePattern.hitRate)
    ? stablePattern.hitRate
    : parsedHitRate ? Number(parsedHitRate) / 100 : null;
  const baselineHitRate = isFiniteScore(stablePattern.baselineHitRate)
    ? stablePattern.baselineHitRate
    : parsedBaseline ? Number(parsedBaseline) / 100 : null;
  const liftPoints = hitRate != null && baselineHitRate != null
    ? Number(((hitRate - baselineHitRate) * 100).toFixed(1))
    : null;
  const metrics = [
    sampleSize != null ? { label: "過去例", value: `${sampleSize}件` } : null,
    hitRate != null ? { label: "3着内率", value: `${(hitRate * 100).toFixed(1)}%` } : null,
    liftPoints != null ? { label: "通常時との差", value: `${liftPoints >= 0 ? "+" : ""}${liftPoints.toFixed(1)}pt` } : null,
  ].filter(Boolean);

  const comparison = liftPoints == null
    ? "この厩舎で結果につながった追い切り構成と一致しています。"
    : liftPoints >= 8
      ? "厩舎の通常時より、3着内につながりやすい形です。"
      : liftPoints > 0
        ? "厩舎の通常時を上回る好走パターンです。"
        : "形は一致していますが、通常時との差は小さめです。";

  return {
    label: publicPatternLabel(rawText),
    headline: `${publicPatternLabel(rawText)}に${degree != null ? `${Math.round(degree * 100)}%` : ""}合致`,
    summary: comparison,
    metrics,
  };
};

const pedigreeTraitRows = (pedigree) => {
  const traits = Array.isArray(pedigree?.traits) ? pedigree.traits : [];
  return traits
    .filter((trait) => isFiniteScore(trait?.score) && trait?.label)
    .sort((left, right) => right.score - left.score)
    .slice(0, 3)
    .map((trait) => ({ label: trait.label, score: Math.round(trait.score) }));
};

const publicPedigreeSummary = (...candidates) => candidates
  .map((candidate) => summarizePublicText(candidate, { maxLength: 156, sentences: 2 }))
  .find(Boolean) ?? null;

const publicPedigreeDetail = (...candidates) => candidates
  .map((candidate) => summarizePublicText(candidate, { maxLength: 320, sentences: 4 }))
  .find(Boolean) ?? null;

const percentText = (value) => isFiniteScore(value) ? `${(value * 100).toFixed(1)}%` : null;

const profileStructureText = (role, name, ancestry) => {
  const ancestors = (ancestry ?? []).filter(Boolean).slice(0, 2);
  if (!name || !ancestors.length) return null;
  return `${role}${name}は${ancestors.join(" × ")}の血統構成。`;
};

const ancestorName = (sourcePedigree, branch) => (sourcePedigree?.ancestors ?? [])
  .find((ancestor) => ancestor?.branch === branch)?.name ?? null;

const pairText = (...names) => {
  const pair = names.filter(Boolean);
  return pair.length >= 2 ? pair.slice(0, 2).join(" × ") : null;
};

const sireStructureText = (pedigree, sourcePedigree) => {
  const identity = pedigree?.identity ?? {};
  const sireParents = pairText(
    ancestorName(sourcePedigree, "sire.sire") ?? identity.sireSire,
    ancestorName(sourcePedigree, "sire.dam") ?? identity.sireDam,
  );
  const sireSireParents = pairText(
    ancestorName(sourcePedigree, "sire.sire.sire"),
    ancestorName(sourcePedigree, "sire.sire.dam"),
  );
  const sireDamParents = pairText(
    ancestorName(sourcePedigree, "sire.dam.sire"),
    ancestorName(sourcePedigree, "sire.dam.dam"),
  );
  return [
    identity.sire && sireParents ? `父${identity.sire}は${sireParents}。` : null,
    identity.sireSire && sireSireParents ? `${identity.sireSire}側は${sireSireParents}。` : null,
    identity.sireDam && sireDamParents ? `${identity.sireDam}側は${sireDamParents}へつながります。` : null,
  ].filter(Boolean).join("");
};

const broodmareSireStructureText = (pedigree, sourcePedigree) => {
  const identity = pedigree?.identity ?? {};
  const parents = pairText(
    ancestorName(sourcePedigree, "dam.sire.sire"),
    ancestorName(sourcePedigree, "dam.sire.dam"),
  ) ?? pairText(...(pedigree?.broodmareSireProfile?.ancestry ?? []));
  if (!identity.broodmareSire || !parents) return null;
  return `母父${identity.broodmareSire}は${parents}。`;
};

const maternalGranddamStructureText = (pedigree, sourcePedigree) => {
  const identity = pedigree?.identity ?? {};
  const parents = pairText(
    ancestorName(sourcePedigree, "dam.dam.sire"),
    ancestorName(sourcePedigree, "dam.dam.dam"),
  );
  if (!identity.damDam || !parents) return null;
  return `母母${identity.damDam}は${parents}。`;
};

const inheritedTraitText = (role, name, traits) => {
  const labels = [...new Set((traits ?? []).filter(Boolean))].slice(0, 4);
  if (!name || !labels.length) return null;
  return role === "父"
    ? `父${name}からは${labels.join("・")}を主な能力特性として評価します。`
    : `母父${name}からは${labels.join("・")}を補完要素として評価します。`;
};

const publicSireProfileFor = (pedigree) => {
  const profile = pedigree?.sireProfile ?? null;
  if (profile?.traits?.length) return profile;
  const supplement = findPedigreePublicProfile(pedigree?.identity?.sire);
  return supplement ? { ...profile, ...supplement, scoreApplied: false } : profile;
};

export const buildPedigreePublicOverview = (pedigree, score = null) => {
  if (!pedigree) return null;
  const identity = pedigree.identity ?? {};
  const sireProfile = publicSireProfileFor(pedigree);
  const sireTraits = [...new Set((sireProfile?.traits ?? []).filter(Boolean))].slice(0, 3);
  const maternalTraits = [...new Set((pedigree.broodmareSireProfile?.traits ?? []).filter(Boolean))].slice(0, 3);
  const totalTraits = pedigreeTraitRows(pedigree).slice(0, 2);
  const sireStatistics = (pedigree.statistics ?? []).find((stat) =>
    stat?.entityType === "sire" && (!identity.sire || stat?.name === identity.sire)
  );
  const roleClauses = [
    identity.sire && sireTraits.length
      ? `父${identity.sire}の${sireTraits.join("・")}が父側の軸`
      : null,
    identity.broodmareSire && maternalTraits.length
      ? `母父${identity.broodmareSire}が${maternalTraits.join("・")}を補う`
      : null,
  ].filter(Boolean);
  const evidenceClauses = [
    totalTraits.length
      ? `配合全体は${totalTraits.map((trait) => `${trait.label}${trait.score}`).join("・")}`
      : null,
    sireStatistics && isFiniteScore(sireStatistics.sampleSize) && isFiniteScore(sireStatistics.hitRate)
      ? `父産駒は${sireStatistics.sampleSize}走で複勝率${percentText(sireStatistics.hitRate)}`
      : null,
  ].filter(Boolean);
  if (roleClauses.length || evidenceClauses.length) {
    const roleSentence = roleClauses.length ? `${roleClauses.join("、")}配合。` : "";
    const verdict = isFiniteScore(score) ? `今回は${Math.round(score)}点の${publicConditionFit(score)}評価` : null;
    const evidenceSentence = [...evidenceClauses, verdict].filter(Boolean).join("、");
    return `${roleSentence}${evidenceSentence ? `${evidenceSentence}。` : ""}`;
  }
  return publicPedigreeSummary(pedigree.headline, pedigree.summary);
};

const statisticsFor = (pedigree, entityType, name) => (pedigree.statistics ?? []).find((stat) =>
  stat?.entityType === entityType && (!name || stat?.name === name)
) ?? null;

const publicStatisticsMetrics = (statistics) => {
  if (!statistics || !isFiniteScore(statistics.sampleSize) || statistics.sampleSize <= 0) return [];
  return [
    { label: "対象", value: `${statistics.sampleSize}走${isFiniteScore(statistics.uniqueHorseCount) ? `・${statistics.uniqueHorseCount}頭` : ""}` },
    { label: "勝率", value: percentText(statistics.winRate) },
    { label: "複勝率", value: percentText(statistics.hitRate) },
  ].filter((metric) => metric.value);
};

const publicStatisticsText = (role, statistics) => {
  const metrics = publicStatisticsMetrics(statistics);
  if (!metrics.length) return null;
  const scope = /同馬場.*距離|同距離.*馬場/.test(String(statistics.scope ?? ""))
    ? "同じ馬場・距離帯"
    : /同距離/.test(String(statistics.scope ?? ""))
      ? "同距離"
      : "集計対象";
  const averageFinish = isFiniteScore(statistics.avgFinish) ? `、平均着順${Number(statistics.avgFinish).toFixed(1)}` : "";
  return `${role}の${scope}の成績は${metrics.map((metric) => `${metric.label}${metric.value}`).join("、")}${averageFinish}。`;
};

const componentEvaluationText = (role, name, score, statistics) => {
  if (!name || !isFiniteScore(score)) return null;
  const limited = isFiniteScore(statistics?.sampleSize) && statistics.sampleSize < 20
    ? `${statistics.sampleSize}走と対象が限られるため、配合全体と距離適性も合わせて判断します。`
    : null;
  return `${role}${name}は今回条件との相性を${publicConditionFit(score)}と評価。${limited ?? "父・母父・距離・コースの噛み合いを合わせて判断します。"}`;
};

const profileTypeText = (profile) => publicPedigreeDetail(profile?.summary);

const statisticsCautionText = (role, statistics) => {
  if (!statistics || !isFiniteScore(statistics.sampleSize)) return null;
  const cautions = [];
  if (statistics.sampleSize < 20) cautions.push(`${role}の成績は${statistics.sampleSize}走で、まだ対象が少ない`);
  if (isFiniteScore(statistics.adjustment) && statistics.adjustment < 0 && isFiniteScore(statistics.hitRate)) {
    cautions.push(`${role}の集計成績は複勝率${percentText(statistics.hitRate)}で、強い加点材料にはしていない`);
  }
  return cautions.length ? `${cautions.join("。") }。` : null;
};

const pairingCautionText = (pedigree) => {
  const pairing = pedigree?.componentDetails?.pairing;
  if (pairing?.status !== "insufficient_sample") return null;
  const pairLabel = pedigree?.identity?.pairLabel;
  return pairLabel
    ? `${pairLabel}の組み合わせ単独では、評価を強く押し上げるだけの実績がまだありません。`
    : null;
};

const sideLineageText = (pedigree, side) => {
  const prefix = side === "sire" ? "sire" : "dam.sire";
  const matches = [...(pedigree?.raceBias?.matched ?? []), ...(pedigree?.raceBias?.femaleMatched ?? [])]
    .filter((match) => (match.hitEntries ?? []).some((entry) => String(entry?.branch ?? "").startsWith(prefix)))
    .slice(0, 2);
  if (!matches.length) return null;
  return matches.map((match) => {
    const ancestor = (match.hitEntries ?? [])
      .find((entry) => String(entry?.branch ?? "").startsWith(prefix))?.name;
    const fits = [...new Set((match.fit ?? []).filter(Boolean))].slice(0, 3);
    const note = summarizePublicText(match.note, { maxLength: 96, sentences: 1 });
    return `${ancestor ?? match.label}から${fits.length ? fits.join("・") : match.label}を評価。${note ?? ""}`;
  }).join("");
};

export const buildPedigreeFamilyPublicLines = (pedigree, sourcePedigree) => {
  if (!pedigree) return [];
  sourcePedigree ??= pedigree.sourcePedigree ?? null;
  const identity = pedigree.identity ?? {};
  const maternalPair = pairText(identity.broodmareSire, identity.damDam);
  const motherText = identity.dam && maternalPair ? `母${identity.dam}は${maternalPair}。` : null;
  const broodmareSireText = [
    broodmareSireStructureText(pedigree, sourcePedigree),
    inheritedTraitText("母父", identity.broodmareSire, pedigree.broodmareSireProfile?.traits),
  ].filter(Boolean).join("");
  const granddamText = maternalGranddamStructureText(pedigree, sourcePedigree);
  const exactRows = [
    identity.dam && motherText ? { role: "母", name: identity.dam, note: motherText } : null,
    identity.broodmareSire && broodmareSireText ? { role: "母父", name: identity.broodmareSire, note: broodmareSireText } : null,
    identity.damDam && granddamText ? { role: "母母", name: identity.damDam, note: granddamText } : null,
  ].filter(Boolean);
  if (exactRows.length) return exactRows;
  return (pedigree.lines ?? [])
    .filter((line) => line?.name && line?.role !== "父系")
    .map((line) => ({ ...line, note: publicPedigreeDetail(line.note) }));
};

const roleStrengths = (pedigree, roles) => (pedigree.strengths ?? [])
  .filter((strength) => (strength.roles ?? []).some((role) => roles.includes(role)));

const detailSection = (label, text, tone = "neutral") => {
  const summary = publicPedigreeDetail(text);
  return summary ? { label, text: summary, tone } : null;
};

const uniqueSections = (sections) => {
  const seen = new Set();
  return sections.filter(Boolean).filter((section) => {
    if (seen.has(section.text)) return false;
    seen.add(section.text);
    return true;
  });
};

const distanceTerms = (label) => {
  const distance = Number(String(label ?? "").match(/(\d{3,4})m/)?.[1]);
  if (!Number.isFinite(distance)) return ["短距離", "マイル", "中距離", "長距離", "スピード", "スタミナ", "持続力"];
  if (distance <= 1400) return ["短距離", "スピード", "先行"];
  if (distance <= 1600) return ["マイル", "スピード", "瞬発力"];
  if (distance <= 2000) return ["中距離", "持続力", "瞬発力"];
  if (distance <= 2400) return ["中距離", "スタミナ", "持続力"];
  return ["長距離", "スタミナ", "持続力"];
};

const distanceStrengthFor = (pedigree, label) => {
  const terms = distanceTerms(label);
  return (pedigree.strengths ?? [])
    .map((strength, index) => ({
      strength,
      index,
      matches: (strength.fit ?? []).filter((fit) => terms.some((term) => String(fit).includes(term))).length,
    }))
    .filter((entry) => entry.matches > 0)
    .sort((left, right) => right.matches - left.matches || left.index - right.index)[0]?.strength ?? null;
};

const distanceBalanceText = (pedigree, label, score) => {
  const distance = Number(String(label ?? "").match(/(\d{3,4})m/)?.[1]);
  const traitMap = new Map(pedigreeTraitRows(pedigree).map((trait) => [trait.label, trait.score]));
  const wanted = !Number.isFinite(distance)
    ? ["スピード", "持続力"]
    : distance <= 1400
      ? ["スピード", "パワー"]
      : distance <= 1600
        ? ["スピード", "瞬発力"]
        : distance <= 2000
          ? ["スピード", "持続力"]
          : distance <= 2400
            ? ["持続力", "スタミナ"]
            : ["スタミナ", "持続力"];
  const selected = wanted
    .map((trait) => ({ trait, value: traitMap.get(trait) }))
    .filter((item) => isFiniteScore(item.value));
  if (!selected.length) return null;
  const distanceText = Number.isFinite(distance) ? `${distance}m` : "今回距離";
  const scoreText = isFiniteScore(score) ? `距離適合は${Math.round(score)}で${publicConditionFit(score)}。` : "";
  return `${distanceText}では${selected.map((item) => `${item.trait}${item.value}`).join("と")}のバランスを評価。${scoreText}`;
};

export const buildPedigreePublicConditionSummary = (pedigree) => {
  if (!pedigree) return null;
  const components = pedigree.componentDetails ?? {};
  const distanceText = distanceBalanceText(pedigree, components.distanceFit?.label, components.distanceFit?.score);
  const goingFit = components.goingFit;
  const goingText = isFiniteScore(goingFit?.score)
    ? `${goingFit.label ?? "今回馬場への血統適合"}は${Math.round(goingFit.score)}で${publicConditionFit(goingFit.score)}。`
    : null;
  return publicPedigreeDetail([distanceText, goingText].filter(Boolean).join(""));
};

export const buildPedigreePublicBreakdown = (pedigree, sourcePedigree = null) => {
  if (!pedigree) return [];
  sourcePedigree ??= pedigree.sourcePedigree ?? null;
  const identity = pedigree.identity ?? {};
  const sireProfile = publicSireProfileFor(pedigree);
  const components = pedigree.componentDetails ?? {};
  const traits = pedigreeTraitRows(pedigree);
  const traitText = traits.length
    ? `血統特性は${traits.map((trait) => `${trait.label}${trait.score}`).join("・")}を上位評価。`
    : null;
  const courseMatches = (pedigree.raceBias?.courseMatched ?? []).slice(0, 3);
  const courseLabels = courseMatches.map((match) => match.label).filter(Boolean);
  const distanceStrength = distanceStrengthFor(pedigree, components.distanceFit?.label);
  const sireStrengths = roleStrengths(pedigree, ["父", "父系"]);
  const maternalStrengths = roleStrengths(pedigree, ["母父", "母系", "牝系"]);
  const sireStatistics = statisticsFor(pedigree, "sire", identity.sire);
  const maternalStatistics = statisticsFor(pedigree, "broodmareSire", identity.broodmareSire);
  const sireCautions = [...new Set(sireStrengths.flatMap((strength) => strength.caution ?? []).filter(Boolean))];
  const maternalCautions = [...new Set(maternalStrengths.flatMap((strength) => strength.caution ?? []).filter(Boolean))];
  const distanceCautions = [...new Set((distanceStrength?.caution ?? []).filter(Boolean))];
  const courseCautions = [...new Set(courseMatches.flatMap((match) => match.caution ?? []).filter(Boolean))];
  const goingFit = components.goingFit;
  const pairingCaution = pairingCautionText(pedigree);
  const sireLineage = sideLineageText(pedigree, "sire");
  const maternalLineage = sideLineageText(pedigree, "maternal");
  const distanceBalance = distanceBalanceText(pedigree, components.distanceFit?.label, components.distanceFit?.score);

  const rows = [
    {
      key: "sireTrait",
      label: "父",
      name: identity.sire ?? "父系",
      score: components.sireTrait?.score,
      summary: publicPedigreeSummary(
        inheritedTraitText("父", identity.sire, sireProfile?.traits),
        sireStructureText(pedigree, sourcePedigree),
        identity.sire ? `父${identity.sire}の血統特性を今回条件に照らして評価。` : null,
      ),
      points: (sireProfile?.traits ?? []).slice(0, 3),
      metrics: publicStatisticsMetrics(sireStatistics),
      sections: uniqueSections([
        detailSection("父のタイプ", profileTypeText(sireProfile)),
        detailSection("父側の3代構成", sireStructureText(pedigree, sourcePedigree) || profileStructureText("父", identity.sire, sireProfile?.ancestry)),
        detailSection("父方祖先の役割", sireLineage),
        detailSection("今回条件で見る点", sireStrengths.map((strength) => strength.text).join("。")),
        detailSection("産駒成績", publicStatisticsText(`父${identity.sire ?? ""}`, sireStatistics)),
        detailSection("点数の見方", componentEvaluationText("父", identity.sire, components.sireTrait?.score, sireStatistics)),
        detailSection("慎重に見る点", [statisticsCautionText(`父${identity.sire ?? ""}`, sireStatistics), pairingCaution, ...sireCautions].filter(Boolean).join("。"), "caution"),
      ]),
    },
    {
      key: "broodmareSire",
      label: "母父",
      name: identity.broodmareSire ?? "母系",
      score: components.broodmareSire?.score,
      summary: publicPedigreeSummary(
        inheritedTraitText("母父", identity.broodmareSire, pedigree.broodmareSireProfile?.traits),
        broodmareSireStructureText(pedigree, sourcePedigree),
        identity.broodmareSire ? `母父${identity.broodmareSire}が補うスピード・パワー・持続力を評価。` : null,
      ),
      points: (pedigree.broodmareSireProfile?.traits?.length
        ? pedigree.broodmareSireProfile.traits
        : pedigree.broodmareSireProfile?.ancestry ?? []).slice(0, 3),
      metrics: publicStatisticsMetrics(maternalStatistics),
      sections: uniqueSections([
        detailSection("母父のタイプ", profileTypeText(pedigree.broodmareSireProfile)),
        detailSection("母父側の構成", broodmareSireStructureText(pedigree, sourcePedigree) || profileStructureText("母父", identity.broodmareSire, pedigree.broodmareSireProfile?.ancestry)),
        detailSection("母父方祖先の役割", maternalLineage),
        detailSection("今回条件で見る点", maternalStrengths.map((strength) => strength.text).join("。")),
        detailSection("母父成績", publicStatisticsText(`母父${identity.broodmareSire ?? ""}`, maternalStatistics)),
        detailSection("点数の見方", componentEvaluationText("母父", identity.broodmareSire, components.broodmareSire?.score, maternalStatistics)),
        detailSection("慎重に見る点", [statisticsCautionText(`母父${identity.broodmareSire ?? ""}`, maternalStatistics), ...maternalCautions].filter(Boolean).join("。"), "caution"),
      ]),
    },
    {
      key: "distanceFit",
      label: "距離",
      name: components.distanceFit?.label ?? "今回距離への適性",
      score: components.distanceFit?.score,
      summary: publicPedigreeSummary(
        distanceBalance,
        [components.distanceFit?.label, distanceStrength?.text, traitText].filter(Boolean).join("。"),
        traitText,
      ),
      points: [],
      metrics: traits.map((trait) => ({ label: trait.label, value: String(trait.score) })),
      sections: uniqueSections([
        detailSection("祖先から見る根拠", summarizePublicText(distanceStrength?.text, { maxLength: 180, sentences: 2 })),
        detailSection("配合全体の能力構成", traitText),
        detailSection("注意点", distanceCautions.join("。"), "caution"),
      ]),
    },
    {
      key: "courseFit",
      label: "コース",
      name: components.courseFit?.label ?? "今回コースへの適性",
      score: components.courseFit?.score,
      summary: publicPedigreeSummary(
        [
          components.courseFit?.label,
          courseLabels.length ? `${courseLabels.join("・")}を今回コースとの相性材料として評価。` : null,
          courseMatches[0]?.note,
        ].filter(Boolean).join("。"),
      ),
      points: courseLabels,
      metrics: [],
      sections: uniqueSections([
        detailSection("コース特性", pedigree.raceBias?.summary),
        ...courseMatches.slice(0, 2).map((match) => detailSection(match.label, match.note)),
        detailSection(
          "今回の馬場",
          isFiniteScore(goingFit?.score)
            ? `${goingFit.label ?? "今回馬場への血統適合"}は${Math.round(goingFit.score)}。${publicConditionFit(goingFit.score)}と評価。`
            : null,
        ),
        detailSection("注意点", courseCautions.join("。"), "caution"),
      ]),
    },
  ];

  return rows
    .filter((row) => isFiniteScore(row.score))
    .map((row) => ({
      ...row,
      summary: row.summary ?? `${row.name}を今回条件に照らして評価。`,
      points: [...new Set(row.points.filter(Boolean))].slice(0, 3),
      metrics: row.metrics ?? [],
      sections: row.sections ?? [],
    }));
};

const compactNumber = (value) => Number.isInteger(value) ? String(value) : Number(value).toFixed(1);

export const buildHorseRiskFlags = (horse, { limit = 3 } = {}) => {
  const details = horse?.analysis?.factorsDetail ?? {};
  const flags = [];
  const addFlag = (flag) => {
    if (!flags.some((item) => item.key === flag.key)) flags.push(flag);
  };
  const value = details.value;
  if (
    isFiniteScore(horse?.popularity) && horse.popularity <= 4 &&
    isFiniteScore(value?.indexRank) && value.indexRank - horse.popularity >= 2
  ) {
    addFlag({
      key: "market",
      label: "人気先行",
      tone: "warning",
      detail: `${horse.popularity}人気に対してTM INDEX ${value.indexRank}位。`,
    });
  }

  const load = details.load;
  if (isFiniteScore(load?.adjustment) && load.adjustment < 0) {
    const relativeText = isFiniteScore(load.relativeKg) && load.relativeKg > 0
      ? `実質負担はレース中央値より${compactNumber(load.relativeKg)}kg重い。`
      : "今回の斤量条件を慎重に評価。";
    addFlag({ key: "load", label: "斤量注意", tone: "warning", detail: relativeText });
  }

  const pace = details.pace;
  if (isFiniteScore(pace?.score) && pace.score < 65) {
    addFlag({
      key: "pace",
      label: "展開不利",
      tone: "warning",
      detail: publicFactorSummary(pace.summary, 64) ?? "想定展開との相性に注意。",
    });
  }

  const trackBias = details.trackBias;
  if (isFiniteScore(trackBias?.adjustment) && trackBias.adjustment < 0) {
    addFlag({
      key: "trackBias",
      label: "馬場不向き",
      tone: "warning",
      detail: "現在の馬場傾向と脚質の相性に注意。",
    });
  }

  const distance = details.distance;
  if (isFiniteScore(distance?.score) && distance.score < 60) {
    addFlag({
      key: "distance",
      label: "距離不安",
      tone: "warning",
      detail: publicFactorSummary(distance.summary, 64) ?? "今回距離への適性を慎重に評価。",
    });
  } else {
    const currentDistance = horse?.currentRace?.distance;
    const latestDistance = horse?.pastRuns?.find((run) => isFiniteScore(run?.distance))?.distance;
    const distanceChange = isFiniteScore(currentDistance) && isFiniteScore(latestDistance)
      ? currentDistance - latestDistance
      : null;
    if (isFiniteScore(distanceChange) && Math.abs(distanceChange) >= 300) {
      addFlag({
        key: "distanceChange",
        label: distanceChange > 0 ? "距離延長" : "距離短縮",
        tone: "watch",
        detail: `前走${latestDistance}mから${Math.abs(distanceChange)}m${distanceChange > 0 ? "延長" : "短縮"}。`,
      });
    }
  }

  const training = details.training;
  const trainingGrade = String(horse?.analysis?.trainingEval?.grade ?? "").toUpperCase();
  const finalTrainingScore = horse?.analysis?.trainingEval?.details?.final?.score;
  const trainingCount = horse?.analysis?.trainingEval?.details?.count;
  const hasTrainingEvidence = ["active", "partial"].includes(training?.status) && isFiniteScore(trainingCount) && trainingCount > 0;
  if (hasTrainingEvidence && ((isFiniteScore(training?.score) && training.score < 65) || trainingGrade === "D")) {
    addFlag({
      key: "training",
      label: "調教慎重",
      tone: "watch",
      detail: "調教全体は慎重評価。",
    });
  } else if (hasTrainingEvidence && isFiniteScore(finalTrainingScore) && finalTrainingScore < 65) {
    addFlag({
      key: "finalTraining",
      label: "最終追い注意",
      tone: "watch",
      detail: `最終追い切りは${Math.round(finalTrainingScore)}評価。`,
    });
  }

  const blood = details.blood;
  if (isFiniteScore(blood?.score) && blood.score < 60) {
    addFlag({
      key: "blood",
      label: "血統不安",
      tone: "watch",
      detail: "今回条件への血統適性を慎重に評価。",
    });
  }

  return flags.slice(0, Math.max(0, limit));
};

export const buildHorsePublicView = (horse) => {
  const details = horse?.analysis?.factorsDetail ?? {};
  const riskFlags = buildHorseRiskFlags(horse);
  const factors = QUICK_READ_FACTOR_KEYS
    .map((key) => ({
      key,
      label: PUBLIC_FACTOR_LABELS[key],
      score: details[key]?.score,
      rating: publicScoreBand(details[key]?.score),
      summary: publicFactorSummary(details[key]?.summary, 70),
    }))
    .filter((factor) => isFiniteScore(factor.score));
  const strengths = [...factors]
    .sort((a, b) => b.score - a.score || QUICK_READ_FACTOR_KEYS.indexOf(a.key) - QUICK_READ_FACTOR_KEYS.indexOf(b.key))
    .slice(0, 3);
  const lowestFactor = [...factors]
    .sort((a, b) => a.score - b.score || QUICK_READ_FACTOR_KEYS.indexOf(a.key) - QUICK_READ_FACTOR_KEYS.indexOf(b.key))[0] ?? null;
  const fallbackCaution = summarizePublicText(horse?.analysis?.cons?.[0], { maxLength: 62, sentences: 1 });
  const watchFactor = lowestFactor?.score < 70 ? lowestFactor : null;
  const watchLabel = watchFactor?.score < 60 ? "注意点" : "確認ポイント";
  const watchText = riskFlags.length
    ? null
    : watchFactor
      ? watchFactor.summary ?? `${watchFactor.label}は慎重に評価。`
      : fallbackCaution;
  const headline = summarizePublicText(
    horse?.analysis?.verdict?.summary ?? horse?.analysis?.insight?.[0] ?? horse?.comment,
    { maxLength: 120, sentences: 2 }
  );

  return {
    headline,
    factors,
    strengths,
    riskFlags,
    watchFactor,
    watchLabel: watchText ? watchLabel : null,
    watchText,
    comment: publicHorseComment(horse),
  };
};

const raceHorseScore = (horse) => {
  const score = horse?.aiScore ?? horse?.tmIndex;
  return isFiniteScore(score) ? score : null;
};

const raceHorseFactor = (horse, key) => {
  const score = horse?.analysis?.factorsDetail?.[key]?.score;
  return isFiniteScore(score) ? score : null;
};

const raceHorseIdentity = (horse, rank) => horse ? ({
  id: horse.id,
  number: horse.number,
  name: horse.name,
  score: raceHorseScore(horse),
  rank,
  popularity: horse.popularity,
  odds: horse.odds,
  riskFlags: buildHorseRiskFlags(horse),
}) : null;

const strongestRaceFactor = (horse) => QUICK_READ_FACTOR_KEYS
  .map((key) => ({ key, label: PUBLIC_FACTOR_LABELS[key], score: raceHorseFactor(horse, key) }))
  .filter((factor) => isFiniteScore(factor.score))
  .sort((a, b) => b.score - a.score || QUICK_READ_FACTOR_KEYS.indexOf(a.key) - QUICK_READ_FACTOR_KEYS.indexOf(b.key))[0] ?? null;

const weakestDecisionFactor = (horse) => ["ability", "distance", "course", "pace", "trackBias", "load", "training"]
  .map((key) => ({ key, label: PUBLIC_FACTOR_LABELS[key], score: raceHorseFactor(horse, key) }))
  .filter((factor) => isFiniteScore(factor.score))
  .sort((a, b) => a.score - b.score)[0] ?? null;

const favoriteReason = (horse, challenger) => {
  const strength = strongestRaceFactor(horse);
  const gap = challenger ? raceHorseScore(horse) - raceHorseScore(challenger) : null;
  const strengthText = strength ? `${strength.label}${Math.round(strength.score)}が強み。` : "総合評価で最上位。";
  if (!isFiniteScore(gap)) return strengthText;
  if (gap === 0) return `${strengthText}首位は同点。`;
  return `${strengthText}2位に${gap}pt差。`;
};

const challengerReason = (horse, favorite) => {
  if (!horse) return "明確な逆転候補は見当たりません。";
  const gap = raceHorseScore(favorite) - raceHorseScore(horse);
  const advantage = QUICK_READ_FACTOR_KEYS
    .map((key) => {
      const score = raceHorseFactor(horse, key);
      const favoriteScore = raceHorseFactor(favorite, key);
      return {
        key,
        label: PUBLIC_FACTOR_LABELS[key],
        score,
        difference: isFiniteScore(score) && isFiniteScore(favoriteScore) ? score - favoriteScore : null,
      };
    })
    .filter((factor) => isFiniteScore(factor.score) && isFiniteScore(factor.difference))
    .sort((a, b) => b.difference - a.difference)[0];

  if (advantage?.difference > 0) {
    return `${advantage.label}${Math.round(advantage.score)}で本命を上回る。首位と${gap}pt差。`;
  }
  const strength = strongestRaceFactor(horse);
  return `${strength ? `${strength.label}${Math.round(strength.score)}が逆転材料。` : "総合力で続く。"}首位と${gap}pt差。`;
};

const valueReason = (horse, rank) => {
  if (!horse) return "指数と人気の間に大きな妙味はありません。";
  const strength = strongestRaceFactor(horse);
  const popularity = isFiniteScore(horse.popularity) ? `${horse.popularity}人気` : "人気未発表";
  return `TM INDEX ${rank}位・${popularity}。${strength ? `${strength.label}${Math.round(strength.score)}が強み。` : "人気以上の指数評価。"}`;
};

const dangerReason = (horse, rank) => {
  if (!horse) return "上位人気と指数評価に大きなズレはありません。";
  const weakness = weakestDecisionFactor(horse);
  const marketText = isFiniteScore(horse.popularity) ? `${horse.popularity}人気に対して` : "市場評価に対して";
  return `${marketText}TM INDEX ${rank}位。${weakness && weakness.score < 65 ? `${weakness.label}${Math.round(weakness.score)}は注意。` : "上位評価との差に注意。"}`;
};

const raceKeyFor = (race) => {
  const pace = race?.raceContext?.paceScenario?.expectedPace;
  const bias = race?.trackBias ?? race?.raceContext?.trackBias;
  const paceLabel = pace ? `${pace}ペース` : "展開";
  const biasStyle = String(bias?.style ?? "").toLowerCase();
  const biasStrength = String(bias?.strength ?? "").toLowerCase();
  const strongBias = biasStrength === "strong" || biasStrength === "high";

  if (strongBias && ["front", "forward", "inside"].includes(biasStyle)) {
    return { value: `${paceLabel} × 前有利`, note: `${paceLabel}想定。前有利の馬場傾向が強く、先行力が鍵です。` };
  }
  if (strongBias && ["rear", "closer", "outside"].includes(biasStyle)) {
    return { value: `${paceLabel} × 差し有利`, note: `${paceLabel}想定。差しが届く馬場傾向で、末脚の持続力が鍵です。` };
  }
  if (/ハイ|high/i.test(String(pace ?? ""))) {
    return { value: "ハイペース想定", note: "前の消耗が見込まれ、差し脚と持続力が鍵です。" };
  }
  if (/スロー|low/i.test(String(pace ?? ""))) {
    return { value: "スローペース想定", note: "位置取りと直線での瞬発力が鍵です。" };
  }
  return { value: pace ? `${paceLabel}想定` : "総合力勝負", note: "コース・距離適性と位置取りの噛み合いが鍵です。" };
};

export const buildRacePublicConclusion = (race) => {
  const ranked = [...(race?.horses ?? [])]
    .filter((horse) => isFiniteScore(raceHorseScore(horse)))
    .sort((a, b) => raceHorseScore(b) - raceHorseScore(a) || (a.number ?? 999) - (b.number ?? 999));
  if (!ranked.length) return null;

  const rankById = new Map(ranked.map((horse, index) => [horse.id, index + 1]));
  const favorite = ranked[0];
  const challenger = ranked[1] ?? null;
  const { value: valueHorse, danger: dangerHorse } = selectPublicRoleHorses(race);
  const favoriteGap = challenger ? raceHorseScore(favorite) - raceHorseScore(challenger) : null;
  const raceKey = raceKeyFor(race);

  return {
    summary: favoriteGap === 0
      ? `首位は同点。${favorite.name}と${challenger.name}を並列評価。`
      : isFiniteScore(favoriteGap) && favoriteGap <= 2
        ? `上位は接戦。${challenger.name}まで逆転圏です。`
        : challenger
          ? `${favorite.name}がTM INDEXで${favoriteGap}ptリード。`
          : `${favorite.name}を最上位に評価。`,
    favorite: {
      horse: raceHorseIdentity(favorite, 1),
      value: favorite.name,
      note: favoriteReason(favorite, challenger),
    },
    challenger: {
      horse: raceHorseIdentity(challenger, challenger ? rankById.get(challenger.id) : null),
      value: challenger?.name ?? "該当なし",
      note: challengerReason(challenger, favorite),
    },
    value: {
      horse: raceHorseIdentity(valueHorse, valueHorse ? rankById.get(valueHorse.id) : null),
      value: valueHorse?.name ?? "見当たらず",
      note: valueReason(valueHorse, valueHorse ? rankById.get(valueHorse.id) : null),
    },
    danger: {
      horse: raceHorseIdentity(dangerHorse, dangerHorse ? rankById.get(dangerHorse.id) : null),
      value: dangerHorse?.name ?? "大きな不安なし",
      note: dangerReason(dangerHorse, dangerHorse ? rankById.get(dangerHorse.id) : null),
    },
    key: {
      horse: null,
      value: raceKey.value,
      note: raceKey.note,
    },
  };
};
