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
  const valueHorse = ranked
    .filter((horse) => rankById.get(horse.id) > 2)
    .filter((horse) => {
      const value = horse?.analysis?.factorsDetail?.value;
      return value?.eligible === true && isFiniteScore(value.marketGap) && value.marketGap >= 1;
    })
    .sort((a, b) => {
      const valueA = a.analysis.factorsDetail.value;
      const valueB = b.analysis.factorsDetail.value;
      return valueB.marketGap - valueA.marketGap || raceHorseScore(b) - raceHorseScore(a) || (a.number ?? 999) - (b.number ?? 999);
    })[0] ?? null;
  const dangerHorse = ranked
    .filter((horse) => isFiniteScore(horse.popularity) && horse.popularity <= 4)
    .filter((horse) => rankById.get(horse.id) - horse.popularity >= 2)
    .sort((a, b) =>
      (rankById.get(b.id) - b.popularity) - (rankById.get(a.id) - a.popularity) ||
      a.popularity - b.popularity ||
      (a.number ?? 999) - (b.number ?? 999)
    )[0] ?? null;
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
