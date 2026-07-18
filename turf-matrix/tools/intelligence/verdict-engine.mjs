const confidenceFor = (horse, trainingAnalysis, dataQuality) => {
  if (dataQuality?.status === "high") return "high";
  if (!horse.pastRuns?.length) return "low";
  if (horse.pastRuns.length >= 8 && horse.pedigree && trainingAnalysis.count && horse.odds?.status === "active") return "high";
  return "mid";
};

const factorLabel = (score) => {
  if (!Number.isFinite(score)) return "未評価";
  if (score >= 82) return "強い";
  if (score >= 70) return "良好";
  if (score >= 58) return "標準";
  return "控えめ";
};

const unsafeRaceNamePattern = /不明|QE|ＱＥ|^[A-Z]{1,3}\d?G\d?$/i;
const cleanRaceLabelPart = (value) => {
  const text = String(value ?? "").trim();
  if (!text || unsafeRaceNamePattern.test(text)) return null;
  return text;
};

const finishText = (run) => {
  if (!run) return "近走データ未取得";
  const course = cleanRaceLabelPart(run.course);
  const raceName = cleanRaceLabelPart(run.raceName);
  const finish = run.finishPosition ? `${run.finishPosition}着` : "着順未取得";
  const label = `${course ?? ""}${raceName ?? ""}`;
  return label ? `直近は${label}で${finish}` : `直近は${finish}`;
};

const valueTextFor = (horse, value) => {
  if (value == null) return "オッズ未取得のためValueは未評価";
  return `単勝${horse.odds.winOdds}倍・${horse.odds.popularity}人気をValue評価へ反映`;
};

const valueReadable = (value) => {
  if (value == null) return "オッズ未取得";
  if (value >= 82) return "市場評価より妙味がある";
  if (value >= 70) return "一定の妙味あり";
  if (value >= 58) return "市場評価はおおむね妥当";
  return "過剰人気に注意";
};

const FACTOR_LABELS = {
  ability: "能力",
  form: "近走",
  distance: "距離",
  course: "コース",
  training: "調教",
  blood: "血統",
  value: "妙味",
  pace: "展開",
};

const buildVerdictPayload = ({
  horse,
  context,
  displayName,
  displayNumber,
  tmIndex,
  rawTmIndex,
  sampleAdjustment,
  value,
  factors,
  scores,
  trainingAnalysis,
  trainingReadable,
  pedigreeAnalysis,
  bloodSummary,
  abilityAnalysis,
  formAnalysis,
  courseAnalysis,
  paceAnalysis,
  valueAnalysis,
  indexContributions,
  dataQuality,
}) => {
  const { ability, form, course, pace, training, blood, stable, frame } = scores;
  const confidence = confidenceFor(horse, trainingAnalysis, dataQuality);
  const recentText = finishText(horse.pastRuns?.[0]);
  const valueText = valueTextFor(horse, value);
  const zi = horse.odds?.zi ?? horse.availableIndex ?? horse.currentRace?.zi;
  const abilityText = zi ? `能力指標ZI ${zi}を能力評価に反映` : `近走${horse.pastRuns?.length ?? 0}走から能力を評価`;
  const contextSummary = context?.summary ?? "レース条件を取得済みデータから評価";
  const trainingStatus = trainingAnalysis.count ? trainingAnalysis.summary : "調教時計は未取得";
  const isGrade = context?.category === "grade";
  const indexLabel = tmIndex >= 82 ? "最上位評価" : tmIndex >= 74 ? "高評価" : tmIndex >= 64 ? "注視" : "押さえ";
  const valueLabel = valueAnalysis?.label ?? valueReadable(value);
  const topContributors = (indexContributions ?? [])
    .slice(0, 3)
    .map((item) => FACTOR_LABELS[item.key] ?? item.key)
    .join(" / ");

  const insight = isGrade
    ? [
        `${displayName}はTM INDEX ${tmIndex ?? "未評価"}。${recentText}です。`,
        `血統面は${bloodSummary}`,
        `調教面は${trainingReadable}`,
        `${contextSummary} ${valueText}。`,
        topContributors ? `指数の主な押し上げ要因は${topContributors}です。` : "指数の主要因を取得中です。",
      ]
    : [
        `${displayName}はTM INDEX ${tmIndex ?? "未評価"}。${recentText}です。`,
        `${bloodSummary}`,
        `${trainingAnalysis.count ? trainingAnalysis.summary : "調教時計は未取得のため控えめに評価します。"} ${valueText}。`,
      ];

  const formEvidence = formAnalysis?.strengths ?? [`近走評価は${factorLabel(form)}`, abilityText];

  return {
    comment: `${recentText}。${bloodSummary}`,
    analysis: {
      status: value == null ? "preodds" : "tm-index-v1.5",
      confidence,
      confidenceReasons: [
        `過去走${horse.pastRuns?.length ?? 0}件を参照`,
        trainingStatus,
        horse.pedigree ? "4代血統をBlood評価に使用" : "血統情報は一部未取得",
        contextSummary,
        valueText,
        dataQuality?.summary ?? "データ充足度を評価中",
      ],
      tags: [abilityText, valueText, context?.profile ?? "条件評価", trainingAnalysis.count ? "調教取得済み" : "調教未取得"],
      factors,
      rawTmIndex,
      sampleAdjustment,
      factorsDetail: {
        ability: abilityAnalysis ?? {
          key: "ability",
          label: "能力",
          score: ability,
          maxScore: 100,
          status: horse.pastRuns?.length ? "active" : "missing",
          summary: abilityText,
          evidence: [abilityText],
          components: [],
        },
        blood: {
          key: "blood",
          label: "血統",
          score: blood,
          maxScore: 100,
          status: pedigreeAnalysis ? "active" : "partial",
          summary: bloodSummary,
          evidence: pedigreeAnalysis?.strengths ?? [],
        },
        training: {
          key: "training",
          label: "調教",
          score: training,
          maxScore: 100,
          status: trainingAnalysis.count ? "active" : "missing",
          summary: trainingReadable,
          evidence: trainingAnalysis.strengths ?? [],
        },
        course: {
          key: "course",
          label: "コース",
          score: course,
          maxScore: 100,
          status: "active",
          summary: courseAnalysis?.summary ?? contextSummary,
          evidence: courseAnalysis?.strengths ?? [`コース適性は${factorLabel(course)}`, `距離適性は${factorLabel(factors.distance)}`],
        },
        pace: {
          key: "pace",
          label: "展開",
          score: pace,
          maxScore: 100,
          status: horse.pastRuns?.length ? "active" : "missing",
          summary: paceAnalysis?.summary ?? "近走の通過順と位置取り傾向から、今回の流れへの合いやすさを評価",
          evidence: paceAnalysis?.strengths ?? [`展開適性は${factorLabel(pace)}`, `上がり評価は${factorLabel(factors.lap)}`],
        },
        stable: {
          key: "stable",
          label: "厩舎",
          score: stable,
          maxScore: 100,
          status: "active",
          summary: "所属と調教取得状況を補助評価",
          evidence: [`厩舎補助評価は${factorLabel(stable)}`],
        },
        form: {
          key: "form",
          label: "近走",
          score: form,
          maxScore: 100,
          status: horse.pastRuns?.length ? "active" : "missing",
          summary: formAnalysis?.summary ?? "着順、着差、相手関係、近走推移を評価",
          evidence: formEvidence,
        },
        value: {
          key: "value",
          label: "妙味",
          score: value,
          maxScore: 100,
          status: value == null ? "missing" : "active",
          summary: valueAnalysis?.summary ?? valueText,
          evidence: valueAnalysis?.strengths ?? (value == null ? ["オッズ未取得"] : [`Value評価は${factorLabel(value)}。${valueLabel}`]),
        },
      },
      insight,
      pros: [
        `${abilityText}。能力評価は${factorLabel(ability)}。`,
        `${bloodSummary}`,
        courseAnalysis?.summary ?? contextSummary,
        trainingAnalysis.count ? `${trainingAnalysis.summary}` : "調教時計は未取得のため、調教面は控えめに評価。",
      ],
      cons: [
        value == null ? "オッズ未取得のため妙味は未評価。" : `人気とオッズのバランスは${valueLabel}。`,
        trainingAnalysis.count ? "調教評価は取得できた時計範囲での判定。" : "調教時計が不足。",
      ],
      commentary: `${displayName}は近走、コース・距離、血統、調教、${value == null ? "オッズを除く要素" : "オッズ妙味"}を統合してTM INDEX ${tmIndex ?? "未評価"}と評価しました。TARGET実データに基づく初期分析です。`,
      frameEval: {
        score: frame,
        text: `馬番${displayNumber ?? "未取得"}を補助情報として評価。枠順の高度な有利不利判定は今後拡張します。`,
      },
      trainingEval: {
        grade: trainingAnalysis.grade,
        oneWeek: { score: training, text: trainingReadable },
        final: { status: trainingAnalysis.count ? "取得済み" : "未取得", text: trainingAnalysis.finalText },
        stablePattern: { match: trainingAnalysis.score >= 74, text: trainingAnalysis.patternText },
        details: {
          count: trainingAnalysis.count,
          best: trainingAnalysis.best ?? null,
          final: trainingAnalysis.final ?? null,
          lightAfterFinal: trainingAnalysis.lightAfterFinal ?? null,
          fastFinish: trainingAnalysis.fastFinish ?? 0,
          accelCount: trainingAnalysis.accelCount ?? 0,
          strengths: trainingAnalysis.strengths ?? [],
        },
      },
      pedigree: pedigreeAnalysis,
      form: formAnalysis,
      course: courseAnalysis,
      pace: paceAnalysis,
      value: valueAnalysis,
      indexContributions,
      dataQuality,
      verdict: {
        status: "active",
        label: indexLabel,
        summary: `${recentText}。${bloodSummary} ${valueText}。`,
        evidence: [`TM INDEX ${tmIndex}`, `近走 ${form} / 調教 ${training} / 血統 ${blood} / Value ${value ?? "未評価"}`, contextSummary, trainingReadable],
      },
      topSignal: { status: "active", label: indexLabel, summary: `${displayName} / TM INDEX ${tmIndex}` },
      depth: isGrade ? "重賞詳細" : "特別レース簡易",
    },
  };
};

export { buildVerdictPayload };
