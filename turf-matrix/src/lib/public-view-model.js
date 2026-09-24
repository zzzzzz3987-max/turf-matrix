import { findPedigreePublicProfile } from "../data/pedigree-public-profiles.js";
import { selectPublicRoleHorses } from "./public-role-selection.js";
import { COURSE_GROUPS, courseGroup } from "../../tools/intelligence/dictionaries/course-bias-dictionary.mjs";

export const PUBLIC_FACTOR_LABELS = {
  ability: "能力",
  blood: "血統",
  training: "調教",
  course: "コース",
  distance: "距離適性",
  load: "斤量",
  pace: "展開",
  trackBias: "馬場傾向",
  stable: "厩舎・陣営",
  form: "近走",
  value: "期待値",
};

export const QUICK_READ_FACTOR_KEYS = [
  "ability", "distance", "course", "training", "pace",
  "trackBias", "stable", "form", "load", "blood",
];

const isFiniteScore = (value) => typeof value === "number" && Number.isFinite(value);

const hasPublicFactorEvidence = (factor) =>
  Boolean(factor) && !["missing", "unavailable", "not_applicable", "pending", "monitor"].includes(factor.status);

export const isPublicFactorEvaluated = (factor) =>
  isFiniteScore(factor?.score) && hasPublicFactorEvidence(factor);

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

const publicCourseEvidence = (horse) => {
  const race = horse?.currentRace;
  if (!race?.course || !race?.surface) return null;
  const isDirt = (surface) => String(surface ?? "").startsWith("ダ");
  const surfaceName = isDirt(race.surface) ? "ダート" : "芝";
  const runs = horse.pastRuns ?? [];
  const sameSurface = runs.filter((run) => run.surface === race.surface);
  const courseRuns = runs.filter((run) => run.course === race.course);
  const type = courseGroup(race.course);
  const typeCourses = COURSE_GROUPS[type] ?? [];
  const typeRuns = runs.filter((run) => typeCourses.includes(run.course));
  const topThreeCount = (items) => items.filter((run) => {
    const place = Number(run.confirmedFinishPosition ?? run.finishPosition);
    return Number.isFinite(place) && place >= 1 && place <= 3;
  }).length;
  const recordText = (items, label) => items.length
    ? `${label}は${items.length}走、3着以内${topThreeCount(items)}回`
    : `${label}なし`;
  const labels = {
    small: "小回りコース",
    wide: "広いコース",
    steep: "坂コース",
    standard: "標準コース",
  };
  const typeName = labels[type] ?? "同じコース区分";
  const relatedCourses = [...new Set(typeRuns.map((run) => run.course).filter((course) => course && course !== race.course))].join("・");
  const shape = horse.analysis?.course?.geometryFit?.label;
  const quickRecord = (items, label) => items.length
    ? `${label}${items.length}走で3着以内${topThreeCount(items)}回`
    : `${label}の実績なし`;
  const scoreNote = `今回のコース形状（${shape || "右回り・コーナー・直線・坂"}）は説明用で、コース点には加えていません。`;
  return [
    `${quickRecord(sameSurface, `同じ${surfaceName}`)}・${quickRecord(typeRuns, `${typeName}${relatedCourses ? `（${race.course}・${relatedCourses}）` : `（${race.course}）`}`)}。`,
    `${recordText(courseRuns, `${race.course}での直接実績`)}。`,
    `このコース点には、同コース・同じ${surfaceName}・${typeName}での着順と着差を反映しています。`,
    scoreNote,
  ].join("");
};

const publicBloodEvidence = (horse) => {
  const pedigree = horse?.analysis?.pedigree;
  if (!pedigree) return null;
  const sireProfile = pedigree.sireProfile;
  const maternalProfile = pedigree.broodmareSireProfile;
  const sireName = pedigree.identity?.sire;
  const maternalName = pedigree.identity?.broodmareSire;
  const sireTraits = [...new Set(sireProfile?.traits ?? [])].slice(0, 3);
  const maternalTraits = [...new Set(maternalProfile?.traits ?? [])].slice(0, 3);
  const stats = pedigree.statistics ?? [];
  const sireStats = stats.find((item) => item.entityType === "sire" && item.name === sireName);
  const maternalStats = stats.find((item) => item.entityType === "broodmareSire" && item.name === maternalName);
  const condition = horse.currentRace
    ? `${horse.currentRace.surface === "ダ" ? "ダート" : "芝"}${horse.currentRace.distance}m前後`
    : "今回条件";
  const describeStats = (role, name, item) => {
    if (!name || !Number.isFinite(item?.sampleSize) || item.sampleSize <= 0) return null;
    const hitCount = Number.isFinite(item.top3) ? item.top3 : null;
    const hitRate = Number.isFinite(item.hitRate) ? `（複勝率${Math.round(item.hitRate * 100)}%）` : "";
    const entries = Object.values(item.horseContributions ?? {});
    const concentrated = entries.some((entry) => entry.sampleSize / item.sampleSize > 0.5);
    const population = role === "父" ? `父${name}産駒` : `母父に${name}を持つ馬`;
    return `${population}の${condition}成績は${item.sampleSize}走・${item.uniqueHorseCount ?? "-"}頭${hitCount == null ? "" : `、3着以内${hitCount}回`}${hitRate}${concentrated ? "。一頭の成績に偏るため参考扱い" : ""}。`;
  };
  const goingFit = pedigree.componentDetails?.goingFit;
  const goingLabel = String(goingFit?.label ?? horse.currentRace?.going ?? "今回の馬場")
    .replace(/への血統適合|への血統相性|の血統適合/u, "");
  const goingCondition = goingLabel === "重" || goingLabel === "不良"
    ? `${goingLabel}馬場`
    : goingLabel.includes("馬場") ? goingLabel : `${goingLabel}馬場`;
  const goingText = goingFit?.status === "reference_only"
    ? `${goingCondition}への血統適性は裏づけデータがなく、中立扱いです。`
    : Number.isFinite(goingFit?.score)
      ? `${goingCondition}との相性は${publicConditionFit(goingFit.score)}評価です。`
      : null;
  return [
    sireName && sireTraits.length ? `父${sireName}は${sireTraits.join("・")}が持ち味。` : null,
    maternalName && maternalTraits.length ? `母父${maternalName}は${maternalTraits.join("・")}で補います。` : null,
    describeStats("父", sireName, sireStats),
    describeStats("母父", maternalName, maternalStats),
    goingText,
    "血統点は父・母父の特徴と今回条件への適合を合わせた評価です。",
  ].filter(Boolean).join("");
};

export const publicFactorExplanation = (factor, { horse = null } = {}) => {
  if (!factor) return null;

  if (factor.key === "ability" && (factor.components?.length || factor.calculation?.components?.length)) {
    const components = factor.calculation?.components ?? factor.components;
    const publicLabels = {
      baseAbility: "近走の基礎能力",
      class: "対戦相手の水準",
      peer: "直接対戦の内容",
      opponentCareer: "相手のその後の活躍",
      margin: "着差",
      distance: "今回に近い距離の実績",
      lap: "レース終盤の脚",
      recent: "近走の上向き具合",
    };
    const scored = components.filter((component) => Number.isFinite(component.score));
    const strongest = [...scored].sort((a, b) => b.score - a.score)[0];
    const concerns = [...new Set(scored
      .filter((component) => component.score < 60)
      .map((component) => publicLabels[component.key])
      .filter(Boolean))].slice(0, 2);
    if (!strongest) return "近走の着順・着差や対戦相手のその後の成績を合わせて評価しています。";
    const strength = publicLabels[strongest.key] ?? "能力材料";
    return strongest.score >= 75
      ? `${strength}が強み。${concerns.length ? `${concerns.join("・")}は控えめ。` : ""}近走の内容と相手関係も合わせて評価しています。`
      : `近走の基礎能力・着差・相手関係を総合評価。${concerns.length ? `${concerns.join("・")}は慎重に見ています。` : "目立つ強みは限定的です。"}`;
  }

  if (factor.key === "pace" && factor.calculation) {
    const calc = factor.calculation;
    if (calc.method === "想定ペースとの脚質相性") {
      const adjustment = (calc.paceAdjustment ?? 0) + (calc.courseAdjustment ?? 0);
      const verdict = adjustment > 0 ? "展開面でプラス" : adjustment < 0 ? "展開面で割引" : "展開面は中立";
      return `${calc.expectedPace}ペース想定。${calc.style}の脚質と位置取りが今回の流れに合うかを評価し、${verdict}と判断。`;
    }
    const position = Number.isFinite(calc.meanPosition) ? `近走の平均位置は${calc.meanPosition.toFixed(1)}番手。` : "";
    return `${position}脚質と今回の流れの相性を評価しています。`;
  }

  if (factor.key === "pace" && factor.evidence?.length) {
    const style = factor.evidence.find((item) => /^想定ペース /.test(item));
    const position = factor.evidence.find((item) => item.startsWith("平均位置取り "));
    const [, pace, runningStyle] = style?.match(/^想定ペース ([^/]+)(?:\/ 脚質 (.+))?$/) ?? [];
    const positionText = position?.replace("平均位置取り ", "平均");
    return [
      pace && `${pace.trim()}ペース想定`,
      runningStyle && `脚質は${runningStyle}`,
      positionText,
      "脚質と位置取りが今回の流れに合うかを評価",
    ].filter(Boolean).join("。") + "。";
  }

  if (factor.key === "form" && factor.calculation) {
    const calc = factor.calculation;
    const run = [...(calc.runs ?? [])].sort((a, b) => b.weightedScore - a.weightedScore)[0];
    return run?.text
      ? `近走の着順・着差・相手関係を総合評価。評価材料は「${run.text}」です。`
      : "近走の着順や着差、相手関係を合わせて評価しています。";
  }

  if (factor.key === "form" && factor.evidence?.length) {
    const highlight = factor.evidence.find((item) => item.startsWith("評価材料: "));
    if (highlight) return `近走の着順・着差・相手関係を総合評価。特に「${highlight.slice("評価材料: ".length).replace(/\((芝|ダ)(\d{3,4}m)\)/u, "（$1$2）")}」が材料です。`;
  }

  if (factor.key === "form" && factor.runEvidence?.length) {
    const strongest = [...factor.runEvidence].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
    if (strongest?.text) return `近走の着順・着差・相手関係を総合評価。評価材料は「${strongest.text}」です。`;
  }

  if (factor.key === "course" && horse) {
    const explanation = publicCourseEvidence(horse);
    if (explanation) return explanation;
  }

  if (factor.key === "course" && factor.evidence?.length) {
    const course = factor.evidence.find((item) => /実績 \d+走/.test(item))?.match(/^(.+)実績 (\d+)走$/);
    const surface = factor.evidence.find((item) => /同じ(芝|ダート)条件 \d+走/.test(item))?.match(/^同じ(芝|ダート)条件 (\d+)走$/);
    const distance = factor.evidence.find((item) => /前後の経験 \d+走/.test(item))?.match(/^(\d{3,4}m)前後の経験 (\d+)走$/);
    const findings = [
      course && `${course[1]}で${course[2]}走`,
      surface && `同じ${surface[1]}で${surface[2]}走`,
      distance && `${distance[1]}前後を${distance[2]}走経験`,
    ].filter(Boolean);
    if (findings.length) return `${findings.join("。")}。コース形態との相性も合わせて評価しています。`;
  }

  if (factor.key === "course" && factor.components) {
    const sameCourse = factor.components.sameCourse;
    const sameSurface = factor.components.sameSurface;
    const parts = [];
    if (sameCourse?.count) parts.push(`今回と同じコースを${sameCourse.count}走`);
    if (sameSurface?.count) parts.push(`同じ芝・ダートを${sameSurface.count}走`);
    if (parts.length) return `${parts.join("、")}。コース形態も含めて相性を評価しています。`;
  }

  if (factor.key === "blood") {
    const explanation = publicBloodEvidence(horse);
    if (explanation) return explanation;
    return "父・母父の特徴と、今回の距離・コース・馬場との相性を合わせて評価しています。";
  }

  if (factor.key === "training") {
    return "最終追い切りと一週前の内容を含め、時計・ラップ・本数から仕上がりを評価しています。";
  }

  if (factor.key === "trackBias") {
    return factor.status === "active"
      ? "当日のレース結果から、前に行く馬と後ろから伸びる馬のどちらが有利かを評価しています。"
      : "当日のレース傾向がまだ分からないため、この項目は指数に反映していません。";
  }

  if (factor.key === "load" && factor.status === "active") {
    const relative = Number.isFinite(factor.relativeKg)
      ? factor.relativeKg === 0 ? "斤量は出走馬の中で標準的" : `斤量は出走馬の基準より${Math.abs(factor.relativeKg).toFixed(1)}kg${factor.relativeKg > 0 ? "重く" : "軽く"}`
      : null;
    const adjustment = Number.isFinite(factor.adjustment) ? factor.adjustment : 0;
    const impact = adjustment > 0 ? "過去の負担実績も踏まえてプラス評価" : adjustment < 0 ? "過去の負担実績も踏まえて慎重評価" : "斤量面は標準評価";
    return `${relative ?? "出走馬同士の斤量を比較"}。${impact}です。`;
  }

  if (factor.key === "distance" || factor.label === "距離適性") {
    const raw = sanitizePublicText(factor.summary) ?? "";
    const targetDistance = raw.match(/(?:^|。)(\d{3,4})mは/)?.[1];
    const nearRuns = (factor.evidence ?? []).join(" ").match(/(\d{3,4})m前後の経験\s*(\d+)走/);
    const tripChange = raw.match(/前走(\d{3,4})mから(\d+)m(延長|短縮)/);
    const components = factor.components ?? {};
    const parts = [];
    if (targetDistance && nearRuns) parts.push(`${targetDistance}m前後を${nearRuns[2]}走経験`);
    if (Number.isFinite(components.proximity?.score)) parts.push("近い距離での走りを重視");
    const adjustments = [];
    if (components.direction?.adjustment) {
      const change = tripChange?.[3] ?? "距離変更";
      adjustments.push(`距離変更（${change}）への対応も${components.direction.adjustment > 0 ? "プラス" : "慎重"}材料`);
    }
    if (components.cadence?.adjustment) {
      const sampleCount = components.cadence.sampleCount;
      const category = targetDistance ? "同じ距離帯での過去成績" : "同じ距離帯での過去成績";
      adjustments.push(`${category}${components.cadence.adjustment > 0 ? "がプラス" : "がマイナス"}${sampleCount ? `（${sampleCount}走）` : ""}`);
    }
    if (adjustments.length) parts.push(adjustments.join("、"));
    if (tripChange) parts.push(`前走から${tripChange[2]}m${tripChange[3]}への対応力も評価`);
    if (parts.length) return parts.join("。") + "。";
    const usefulSentences = raw.split(/(?<=[。．])/u)
      .filter((sentence) => !/根幹距離|非根幹距離/.test(sentence));
    return summarizePublicText(usefulSentences.join(""), { maxLength: 120, sentences: 2 });
  }

  if (factor.key === "stable" || factor.label === "厩舎" || factor.label === "厩舎・陣営") {
    const components = factor.components ?? {};
    const evidence = [];
    if (factor.stablePattern?.status === "照合済" || components.stablePattern) evidence.push("厩舎の好走パターン");
    if (components.rotation) evidence.push("ローテーション");
    if (components.jockey) evidence.push("騎手との組み合わせ");
    if (components.travel) evidence.push("輸送条件");
    if (evidence.length) return `${evidence.join("・")}を見て、陣営面の後押しを評価しています。`;
    return "厩舎独自の好走パターンは確認できず、基準点で評価しています。";
  }

  return publicFactorSummary(factor.summary, 120);
};

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
  return `調教全体は${gradeLabel}。最終追い切りを含む調整過程と、時計・ラップ・本数を合わせて評価しています。`;
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
    ? `父${name}は${labels.join("・")}が持ち味。今回の条件に生きるかを見ます。`
    : `母父${name}の${labels.join("・")}も、配合を補う材料として見ています。`;
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
  const description = [
    identity.sire && sireTraits.length
      ? `父${identity.sire}は${sireTraits.join("・")}が持ち味。今回の条件に合うかを見ます。`
      : null,
    identity.broodmareSire && maternalTraits.length
      ? `母父${identity.broodmareSire}の${maternalTraits.join("・")}も補完材料です。`
      : identity.broodmareSire
        ? `母父${identity.broodmareSire}は今回条件に結びつく材料が少なく、強い加点はしていません。`
      : null,
    isFiniteScore(score) ? `血統全体では${publicConditionFit(score)}評価。` : null,
  ].filter(Boolean).join("");
  if (description) return description;
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

const profileTypeText = (profile, role, name) => {
  if (!profile) return null;
  if (!profile.traits?.length) return `${role}${name ?? ""}は今回条件への得意傾向を判断できる材料が少なく、名前だけで加点せず配合全体で見ます。`;
  return `${role}${name ?? ""}の得意条件の目安は${profile.traits.slice(0, 3).join("・")}。今回の距離やコースとの相性を確認します。`;
};

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
  const traitsText = selected.map((item) => item.trait).join("と");
  const scoreText = isFiniteScore(score) ? `血統面の距離適性は${publicConditionFit(score)}。` : "";
  return `${distanceText}では${traitsText}のバランスが鍵。${scoreText}`;
};

export const buildPedigreePublicConditionSummary = (pedigree) => {
  if (!pedigree) return null;
  const components = pedigree.componentDetails ?? {};
  const distanceText = distanceBalanceText(pedigree, components.distanceFit?.label, components.distanceFit?.score);
  const goingFit = components.goingFit;
  const goingCondition = String(goingFit?.label ?? "今回の馬場")
    .replace(/への血統適合|への血統相性|の血統適合/u, "");
  const goingLabel = goingCondition === "重" ? "重馬場" : goingCondition;
  const goingText = isFiniteScore(goingFit?.score)
    ? `${goingLabel}への血統相性は${publicConditionFit(goingFit.score)}。`
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
        detailSection("父のタイプ", profileTypeText(sireProfile, "父", identity.sire)),
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
        identity.broodmareSire && pedigree.broodmareSireProfile?.traits?.length
          ? `母父${identity.broodmareSire}の${pedigree.broodmareSireProfile.traits.slice(0, 3).join("・")}も配合を補う材料です。`
          : identity.broodmareSire
            ? `母父${identity.broodmareSire}は今回条件への材料が少なく、名前だけでは加点していません。`
            : null,
      ),
      points: (pedigree.broodmareSireProfile?.traits ?? []).slice(0, 3),
      metrics: publicStatisticsMetrics(maternalStatistics),
      sections: uniqueSections([
        detailSection("母父のタイプ", profileTypeText(pedigree.broodmareSireProfile, "母父", identity.broodmareSire)),
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
  if (hasPublicFactorEvidence(load) && isFiniteScore(load?.adjustment) && load.adjustment < 0) {
    const relativeHeavy = isFiniteScore(load.relativeKg) && load.relativeKg > 0;
    const provenCount = Number(load.comparableSuccessCount) || 0;
    const fillyAtRelativeDisadvantage = relativeHeavy && Number(load.sexAllowance) > 0;
    const unprovenHigh = load.tolerance?.unprovenHigh === true;
    const poorTolerance = Number(load.tolerance?.adjustment) < 0;
    const label = unprovenHigh
      ? "斤量未経験"
      : fillyAtRelativeDisadvantage
        ? "牝馬の相対負担"
        : relativeHeavy
          ? "相対斤量重め"
          : poorTolerance
            ? "同斤量成績注意"
            : "斤量条件注意";
    const detail = unprovenHigh && isFiniteScore(load.tolerance?.maxPastWeight)
      ? `今回は${compactNumber(load.carriedWeight)}kg。過去最高${compactNumber(load.tolerance.maxPastWeight)}kgを上回ります。`
      : relativeHeavy && provenCount >= 3
        ? `今回も${compactNumber(load.carriedWeight)}kg。年齢・性別換算では中央値より${compactNumber(load.relativeKg)}kg重めですが、同等斤量・近似距離で3着内${provenCount}走があり、実績を加味しています。`
        : relativeHeavy
          ? `年齢・性別換算ではレース中央値より${compactNumber(load.relativeKg)}kg重く、相対的な負担に注意。`
          : poorTolerance
            ? `同等斤量での過去${Number(load.tolerance?.sampleCount) || 0}走の内容を慎重に評価しています。`
            : "今回の斤量条件を慎重に評価しています。";
    addFlag({ key: "load", label, tone: "warning", detail });
  }

  const pace = details.pace;
  if (isPublicFactorEvaluated(pace) && pace.score < 65) {
    addFlag({
      key: "pace",
      label: "展開不利",
      tone: "warning",
      detail: publicFactorSummary(pace.summary, 64) ?? "想定展開との相性に注意。",
    });
  }

  const trackBias = details.trackBias;
  if (hasPublicFactorEvidence(trackBias) && isFiniteScore(trackBias?.adjustment) && trackBias.adjustment < 0) {
    addFlag({
      key: "trackBias",
      label: "馬場不向き",
      tone: "warning",
      detail: "現在の馬場傾向と脚質の相性に注意。",
    });
  }

  const distance = details.distance;
  if (isPublicFactorEvaluated(distance) && distance.score < 60) {
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
    const scoreText = isFiniteScore(training?.score) ? `${Math.round(training.score)}点` : null;
    const gradeText = trainingGrade ? `${trainingGrade}評価` : null;
    const evaluationText = [scoreText, gradeText].filter(Boolean).join("・");
    addFlag({
      key: "training",
      label: "調教評価やや低め",
      tone: "watch",
      detail: `時計・終い・加速・本数を合わせた調教総合は${evaluationText || "やや低め"}。今回は強い上積み材料として扱いにくい。`,
    });
  } else if (hasTrainingEvidence && isFiniteScore(finalTrainingScore) && finalTrainingScore < 65) {
    const totalText = isFiniteScore(training?.score) ? `調教総合${Math.round(training.score)}点に対し、` : "";
    addFlag({
      key: "finalTraining",
      label: "最終追い評価やや低め",
      tone: "watch",
      detail: `${totalText}最終追い切りは${Math.round(finalTrainingScore)}点。時計・終いの評価はやや低めですが、軽めの調整という可能性もあり、時計だけで状態不良とは判断しません。`,
    });
  }

  const blood = details.blood;
  if (isPublicFactorEvaluated(blood) && blood.score < 60) {
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
    .filter((key) => isPublicFactorEvaluated(details[key]))
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
  const factor = horse?.analysis?.factorsDetail?.[key];
  return isPublicFactorEvaluated(factor) ? factor.score : null;
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

const PUBLIC_ROLE_FACTOR_PHRASES = {
  ability: "地力の高さ",
  blood: "今回条件への血統適性",
  training: "調教内容",
  course: "今回コースへの適性",
  distance: "今回距離への適性",
  load: "斤量条件",
  pace: "想定展開との相性",
  trackBias: "当日の馬場傾向との相性",
  stable: "厩舎の仕上げ",
  form: "近走内容",
};

const publicRoleFactorPhrase = (factor) => PUBLIC_ROLE_FACTOR_PHRASES[factor?.key] ?? factor?.label ?? "総合力";

const PUBLIC_HOOKS = {
  ability: "相手関係まで見た地力",
  blood: "条件に合う血統背景",
  training: "追い切りから見える仕上がり",
  course: "今回の舞台で生きる経験",
  distance: "今回距離への対応力",
  load: "斤量条件の追い風",
  pace: "想定展開との噛み合い",
  trackBias: "当日の馬場傾向との相性",
  stable: "ローテーションと騎手起用",
  form: "近走で見せた勝ち切る力",
};

const publicHook = (factor) => PUBLIC_HOOKS[factor?.key] ?? publicRoleFactorPhrase(factor);

const distancePerformanceEvidence = (horse) => {
  const target = Number(horse?.currentRace?.distance);
  const surface = horse?.currentRace?.surface;
  const runs = (horse?.pastRuns ?? [])
    .map((run) => ({
      distance: Number(run.distance),
      position: Number(run.confirmedFinishPosition ?? run.finishPosition),
      surface: run.surface,
    }))
    .filter((run) => Number.isFinite(run.distance) && Number.isFinite(run.position) && run.position > 0
      && (!surface || run.surface === surface));
  if (!Number.isFinite(target) || !runs.length) return null;

  const exact = runs.filter((run) => run.distance === target && run.position <= 3);
  const nearestDistance = [...new Set(runs
    .filter((run) => run.distance !== target && Math.abs(run.distance - target) <= 100)
    .map((run) => run.distance))]
    .sort((a, b) => Math.abs(a - target) - Math.abs(b - target)
      || runs.filter((run) => run.distance === b && run.position <= 3).length
        - runs.filter((run) => run.distance === a && run.position <= 3).length)[0];
  const adjacent = nearestDistance == null
    ? []
    : runs.filter((run) => run.distance === nearestDistance && run.position <= 3);
  const claims = [];
  if (exact.length) {
    const places = [...new Set(exact.map((run) => run.position))].sort((a, b) => a - b).slice(0, 2);
    claims.push(`${target}mで${places.map((place) => `${place}着`).join("・")}`);
  }
  const adjacentTopTwo = adjacent.filter((run) => run.position <= 2).length;
  if (adjacentTopTwo >= 2) claims.push(`${nearestDistance}mで連対${adjacentTopTwo}回`);
  else if (adjacent.length >= 2) claims.push(`${nearestDistance}mで3着以内${adjacent.length}回`);
  else if (adjacent.length === 1) claims.push(`${nearestDistance}mで${adjacent[0].position}着`);
  return claims.length ? claims.join("、") : null;
};

const coursePerformanceEvidence = (horse) => {
  const race = horse?.currentRace;
  if (!race?.course || !race?.surface) return null;
  const surface = String(race.surface).startsWith("ダ") ? "ダート" : "芝";
  const runs = (horse?.pastRuns ?? []).filter((run) =>
    run.course === race.course && run.surface === race.surface
  );
  const finishes = runs
    .map((run) => Number(run.confirmedFinishPosition ?? run.finishPosition))
    .filter((position) => Number.isFinite(position) && position > 0);
  const topThree = finishes.filter((position) => position <= 3).length;
  if (finishes.length && topThree) {
    return {
      headline: `${race.course}${surface}${finishes.length}走で3着以内${topThree}回`,
      duplicate: `${race.course}での直接実績は`,
    };
  }

  const sameSurface = (horse?.pastRuns ?? [])
    .filter((run) => run.surface === race.surface)
    .map((run) => Number(run.confirmedFinishPosition ?? run.finishPosition))
    .filter((position) => Number.isFinite(position) && position > 0);
  const sameSurfaceTopThree = sameSurface.filter((position) => position <= 3).length;
  if (!sameSurface.length || !sameSurfaceTopThree) return null;
  return {
    headline: `同じ${surface}${sameSurface.length}走で3着以内${sameSurfaceTopThree}回`,
    duplicate: `同じ${surface}${sameSurface.length}走で3着以内${sameSurfaceTopThree}回`,
  };
};

const omitCourseHeadlineEvidence = (text, horse, evidence) => {
  const course = horse?.currentRace?.course;
  if (!text) return text;
  if (course && evidence?.duplicate?.endsWith("での直接実績は")) {
    return splitSentences(text).filter((sentence) => !sentence.includes(evidence.duplicate)).join("");
  }
  return evidence?.duplicate
    ? text.replace(evidence.duplicate, "").replace(/^[・、]\s*/, "")
    : text;
};

const publicRoleStrengthText = (factor) => {
  if (!factor) return "総合評価で最上位。";
  const phrase = publicRoleFactorPhrase(factor);
  return factor.score >= 75 ? `${phrase}を高く評価。` : `${phrase}が総合評価を支える。`;
};

export const buildHorseBrief = (horse) => {
  const view = buildHorsePublicView(horse);
  const strength = view.strengths.find((factor) => factor.score >= 70);
  const caution = view.riskFlags[0]?.detail ?? view.watchText;
  const rawFactor = horse?.analysis?.factorsDetail?.[strength?.key];
  const reason = rawFactor
    ? publicFactorExplanation({ ...rawFactor, key: strength.key, label: strength.label }, { horse })
      ?? rawFactor.summary
    : null;
  const distanceEvidence = strength?.key === "distance" ? distancePerformanceEvidence(horse) : null;
  const courseEvidence = strength?.key === "course" ? coursePerformanceEvidence(horse) : null;
  const lead = distanceEvidence ?? courseEvidence?.headline;
  const supportingReason = courseEvidence ? omitCourseHeadlineEvidence(reason, horse, courseEvidence) : reason;
  return {
    headline: strength ? `推し材料は「${lead ?? publicHook(strength)}」`
      : view.factors.length ? "強調材料は少なく、慎重に評価。" : "評価に必要な情報が不足しています。",
    reason: strength ? summarizePublicText(
      distanceEvidence ? reason ?? "近い距離での実績を今回条件に照らして評価。" : supportingReason,
      { maxLength: 120, sentences: 2 }
    ) : null,
    // Keep qualifications such as light workouts intact, rather than clipping the warning.
    caution: caution ?? null,
  };
};

const INDEX_REASON_LABELS = {
  ability: "地力",
  form: "近走内容",
  distance: "距離適性",
  course: "コース適性",
  training: "調教評価",
  blood: "血統適性",
  pace: "展開適性",
};

const contributionMap = (horse) => {
  const rows = horse?.analysis?.indexContributions ?? [];
  const totalWeight = rows.reduce((sum, row) => sum + (Number(row.weight) || 0), 0);
  if (!totalWeight) return new Map();
  return new Map(rows.map((row) => [
    row.key,
    (Number.isFinite(row.contribution) ? row.contribution : (row.effectiveScore ?? row.score) * row.weight) / totalWeight,
  ]).filter(([, value]) => Number.isFinite(value)));
};

const leaderDifferenceFactor = (leader, runnerUp) => {
  const lead = contributionMap(leader);
  const next = contributionMap(runnerUp);
  return [...lead.entries()]
    .filter(([key]) => next.has(key))
    .map(([key, value]) => ({ key, difference: value - next.get(key) }))
    .filter((item) => item.difference > 0)
    .sort((a, b) => b.difference - a.difference)[0] ?? null;
};

export const buildIndexLeaderBrief = (horse, fieldHorses = []) => {
  const ranked = [...fieldHorses]
    .filter((runner) => isFiniteScore(raceHorseScore(runner)))
    .sort((a, b) => raceHorseScore(b) - raceHorseScore(a) || (a.number ?? 999) - (b.number ?? 999));
  if (ranked[0]?.id !== horse?.id) return null;

  const runnerUp = ranked[1] ?? null;
  const gap = runnerUp ? raceHorseScore(horse) - raceHorseScore(runnerUp) : null;
  const edge = runnerUp ? leaderDifferenceFactor(horse, runnerUp) : null;
  const key = edge?.key ?? horse?.analysis?.indexContributions?.[0]?.key;
  const phrase = INDEX_REASON_LABELS[key] ?? null;
  const factor = key ? horse?.analysis?.factorsDetail?.[key] : null;
  const rawEvidence = factor
    ? publicFactorExplanation({ ...factor, key }, { horse })
      ?? publicFactorSummary(factor.summary, 120)
    : null;
  const specificEvidence = key === "distance"
    ? distancePerformanceEvidence(horse)
    : key === "course" ? coursePerformanceEvidence(horse) : null;
  const evidence = key === "course" && specificEvidence
    ? omitCourseHeadlineEvidence(rawEvidence, horse, specificEvidence)
    : rawEvidence;
  const hook = factor
    ? key === "course" ? specificEvidence?.headline ?? publicHook({ key, label: phrase })
      : specificEvidence ?? publicHook({ key, label: phrase })
    : null;
  const headline = edge && hook && gap > 0
    ? `指数1位の決め手は「${hook}」`
    : hook ? `指数1位の推し材料は「${hook}」` : "総合評価で指数1位";
  const margin = gap === 0 ? "指数2位と同点。" : Number.isFinite(gap) ? `指数2位に${gap}点差。` : "";

  return {
    headline,
    reason: [margin, evidence].filter(Boolean).join(" ") || "複数項目を総合して最上位。",
  };
};

const strongestRaceFactor = (horse) => QUICK_READ_FACTOR_KEYS
  .map((key) => ({ key, label: PUBLIC_FACTOR_LABELS[key], score: raceHorseFactor(horse, key) }))
  .filter((factor) => isFiniteScore(factor.score))
  .sort((a, b) => b.score - a.score || QUICK_READ_FACTOR_KEYS.indexOf(a.key) - QUICK_READ_FACTOR_KEYS.indexOf(b.key))[0] ?? null;

const weakestDecisionFactor = (horse) => ["ability", "form", "distance", "course", "pace", "trackBias", "load", "training"]
  .map((key) => ({ key, label: PUBLIC_FACTOR_LABELS[key], score: raceHorseFactor(horse, key) }))
  .filter((factor) => isFiniteScore(factor.score))
  .sort((a, b) => a.score - b.score)[0] ?? null;

const favoriteReason = (horse, challenger) => {
  const strength = strongestRaceFactor(horse);
  const gap = challenger ? raceHorseScore(horse) - raceHorseScore(challenger) : null;
  const strengthText = publicRoleStrengthText(strength);
  if (!isFiniteScore(gap)) return strengthText;
  if (gap === 0) return `${strengthText}ただし指数首位は同点。`;
  return `${strengthText}指数2位に${gap}ポイント差。`;
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
    return `${publicRoleFactorPhrase(advantage)}は本命より高評価。指数首位とは${gap}ポイント差。`;
  }
  const strength = strongestRaceFactor(horse);
  return `${strength ? `${publicRoleFactorPhrase(strength)}が逆転材料。` : "総合力で続く。"}指数首位とは${gap}ポイント差。`;
};

const valueReason = (horse, rank) => {
  if (!horse) return "指数と人気の間に大きな妙味はありません。";
  const strength = strongestRaceFactor(horse);
  const popularity = isFiniteScore(horse.popularity) ? `${horse.popularity}人気` : "人気未発表";
  const support = strength?.score >= 75
    ? `${publicRoleFactorPhrase(strength)}が人気以上の評価を支える。`
    : "人気との評価差が中心で、強い好走材料は限定的。";
  const weakness = weakestDecisionFactor(horse);
  const caution = weakness?.score < 65 ? `${publicRoleFactorPhrase(weakness)}には注意。` : "";
  return `指数${rank}位ながら${popularity}。${support}${caution}`;
};

const dangerReason = (horse, rank) => {
  if (!horse) return "現在の人気・指数の条件に該当する馬はいません。";
  const weakness = weakestDecisionFactor(horse);
  const strength = strongestRaceFactor(horse);
  const marketText = isFiniteScore(horse.popularity) ? `${horse.popularity}人気に対して` : "市場評価に対して";
  const risk = weakness?.score < 65 ? `${publicRoleFactorPhrase(weakness)}は慎重評価。` : "注意の中心は人気との評価差。";
  const support = strength?.score >= 75 ? `一方で${publicRoleFactorPhrase(strength)}は強み。` : "";
  return `${marketText}指数${rank}位。${risk}${support}消しの断定ではありません。`;
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
  const dangerRank = dangerHorse
    ? 1 + ranked.filter((horse) => raceHorseScore(horse) > raceHorseScore(dangerHorse)).length
    : null;
  const favoriteGap = challenger ? raceHorseScore(favorite) - raceHorseScore(challenger) : null;
  const raceKey = raceKeyFor(race);

  return {
    summary: favoriteGap === 0
      ? `首位は同点。${favorite.name}と${challenger.name}を並列評価。`
      : isFiniteScore(favoriteGap) && favoriteGap <= 2
        ? `上位は接戦。${challenger.name}まで逆転圏です。`
        : challenger
          ? `${favorite.name}がTM INDEXで${favoriteGap}ポイントリード。`
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
      horse: raceHorseIdentity(dangerHorse, dangerRank),
      value: dangerHorse?.name ?? "該当馬なし",
      note: dangerReason(dangerHorse, dangerRank),
    },
    key: {
      horse: null,
      value: raceKey.value,
      note: raceKey.note,
    },
  };
};
