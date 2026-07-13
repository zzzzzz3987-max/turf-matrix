const confidenceFor = (horse, trainingAnalysis) => {
  if (!horse.pastRuns?.length) return "low";
  if (horse.pastRuns.length >= 8 && horse.pedigree && trainingAnalysis.count && horse.odds?.status === "active") return "high";
  return "mid";
};

const buildVerdictPayload = ({
  horse,
  context,
  displayName,
  displayNumber,
  tmIndex,
  value,
  factors,
  scores,
  trainingAnalysis,
  trainingReadable,
  pedigreeAnalysis,
  bloodSummary,
}) => {
  const { ability, form, course, pace, training, blood, stable, frame } = scores;
  const confidence = confidenceFor(horse, trainingAnalysis);
  const recent = horse.pastRuns?.[0];
  const recentText = recent
    ? `直近は${recent.course ?? ""}${recent.raceName ?? "前走"}で${recent.finishPosition ?? "—"}着`
    : "近走データ未取得";
  const valueText = value == null
    ? "オッズ未取得のためValueは未評価"
    : `単勝${horse.odds.winOdds}倍・${horse.odds.popularity}人気をValue評価へ反映`;
  const abilityText = horse.odds?.zi ? `ZI ${horse.odds.zi}を能力評価へ反映` : "近走実績から能力を評価";
  const contextSummary = context?.summary ?? "レース条件を取得データから評価";
  const trainingStatus = trainingAnalysis.count ? trainingAnalysis.summary : "調教データは一部未取得";

  return {
    comment: `${recentText}。${bloodSummary}。`,
    analysis: {
      status: value == null ? "preodds" : "tm-index-v1",
      confidence,
      confidenceReasons: [
        `過去走${horse.pastRuns?.length ?? 0}件を参照`,
        trainingStatus,
        horse.pedigree ? "4代血統を接続済み" : "血統は基本情報のみ参照",
        contextSummary,
        valueText,
      ],
      tags: [abilityText, valueText, context?.profile ?? "条件評価", trainingAnalysis.count ? "調教取得済み" : "調教一部未取得"],
      factors,
      factorsDetail: {
        blood: { key: "blood", label: "血統", score: blood, maxScore: 100, status: pedigreeAnalysis ? "active" : "partial", summary: bloodSummary, evidence: pedigreeAnalysis?.strengths ?? [] },
        training: { key: "training", label: "調教", score: training, maxScore: 100, status: trainingAnalysis.count ? "active" : "partial", summary: trainingReadable, evidence: trainingAnalysis.strengths ?? [] },
        course: { key: "course", label: "コース", score: course, maxScore: 100, status: "active", summary: contextSummary, evidence: [] },
        pace: { key: "pace", label: "展開", score: pace, maxScore: 100, status: horse.pastRuns?.length ? "active" : "missing", summary: "近走の通過順から位置取り傾向を評価", evidence: [] },
        stable: { key: "stable", label: "厩舎", score: stable, maxScore: 100, status: "active", summary: "所属と調教取得状態を補助評価", evidence: [] },
        form: { key: "form", label: "近走", score: form, maxScore: 100, status: horse.pastRuns?.length ? "active" : "missing", summary: "着順・着差・近走推移を評価", evidence: [] },
        value: { key: "value", label: "妙味", score: value, maxScore: 100, status: value == null ? "missing" : "active", summary: valueText, evidence: [] },
      },
      insight: [
        `${displayName}はTM INDEX ${tmIndex ?? "未評価"}。${recentText}。`,
        `血統面は${bloodSummary}。`,
        `${contextSummary} ${valueText}。`,
        trainingAnalysis.count ? trainingAnalysis.summary : "調教データ不足のため調教評価は控えめ。",
      ],
      pros: [abilityText, `過去走${horse.pastRuns?.length ?? 0}件から近走傾向を確認`, bloodSummary],
      cons: [trainingAnalysis.count ? "調教評価は取得範囲内の判定" : "調教データが一部不足", valueText],
      commentary: `${displayName}は近走、コース・距離、血統、調教、${value == null ? "オッズを除く要素" : "オッズ妙味"}を統合してTM INDEX ${tmIndex ?? "未評価"}と評価しました。TARGET実データに基づく決定的な初期分析です。`,
      frameEval: { score: frame, text: `馬番${displayNumber ?? "未取得"}を補助情報として評価。枠順の高度な有利不利判定は今後拡張します。` },
      trainingEval: {
        grade: trainingAnalysis.grade,
        oneWeek: { score: training, text: trainingReadable },
        final: { status: trainingAnalysis.count ? "確認済み" : "一部未取得", text: trainingAnalysis.finalText },
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
      verdict: {
        status: "active",
        label: tmIndex >= 82 ? "最上位評価" : tmIndex >= 74 ? "高評価" : "注視",
        summary: `${recentText}。${bloodSummary}。${valueText}。`,
        evidence: [`TM INDEX ${tmIndex}`, `近走 ${form} / 調教 ${training} / 血統 ${blood} / Value ${value ?? "未評価"}`, contextSummary, trainingReadable],
      },
      topSignal: { status: "active", label: tmIndex >= 82 ? "最上位評価" : "注目評価", summary: `${displayName} / TM INDEX ${tmIndex}` },
    },
  };
};

export { buildVerdictPayload };
