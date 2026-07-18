import officialWeekData from "../../tools/week-data.json";

const candidateModules = import.meta.glob("../../tools/week-data.batch-candidate.json", {
  eager: true,
  import: "default",
});

const batchCandidateWeekData = candidateModules["../../tools/week-data.batch-candidate.json"] ?? null;
const requestedMode = import.meta.env.VITE_TURF_DATA_MODE;
export const dataMode =
  requestedMode === "official" || requestedMode === "production"
    ? "official"
    : batchCandidateWeekData
      ? "candidate"
      : "official";

const isCandidatePayload = (data) =>
  data?.mode === "candidate" || data?.mode === "candidate-preodds" || Boolean(data?.races?.[0]?.horses?.[0]?.currentRace);

const fallbackAnalysis = {
  status: "not_connected",
  confidence: null,
  confidenceReasons: [],
  tags: [],
  factors: null,
  insight: [],
  pros: [],
  cons: [],
  commentary: null,
  frameEval: null,
  trainingEval: null,
  pedigree: null,
  factorsDetail: {},
  verdict: { status: "missing", label: "未評価", summary: null, evidence: [] },
  topSignal: { status: "missing", label: "未評価", summary: null },
};

const adaptCandidateHorse = (horse) => {
  const analysis = horse.analysis ?? fallbackAnalysis;
  return {
    id: horse.id,
    number: horse.number,
    name: horse.name,
    jockey: horse.jockey,
    popularity: horse.popularity ?? null,
    odds: horse.odds ?? null,
    aiScore: horse.tmIndex ?? null,
    tmValue: horse.tmValue ?? null,
    comment: horse.comment ?? analysis.verdict?.summary ?? "分析準備中",
    currentRace: horse.currentRace,
    pastRuns: horse.pastRuns ?? [],
    training: horse.training ?? { slope: [], wood: [] },
    pedigreeRaw: horse.pedigree,
    dataStatus: horse.dataStatus,
    analysis: {
      ...fallbackAnalysis,
      ...analysis,
      factorsDetail: analysis.factorsDetail ?? {},
      verdict: analysis.verdict ?? fallbackAnalysis.verdict,
      topSignal: analysis.topSignal ?? fallbackAnalysis.topSignal,
    },
  };
};

const buildSummary = (candidate, horses) => {
  if (!horses.length) {
    return {
      text: "レース番組を確認済みです。出走馬データの取得後にTM INDEXを生成します。",
      highlights: [
        `${candidate.races?.length ?? 0}レースを表示予定`,
        "単勝オッズ取得前はTM VALUEを未評価として扱います。",
      ],
    };
  }

  const top = [...horses].filter((horse) => horse.aiScore != null).sort((a, b) => b.aiScore - a.aiScore)[0];
  const oddsCount = horses.filter((horse) => horse.odds != null && horse.popularity != null).length;
  const trainingCount = horses.filter((horse) => horse.dataStatus?.training === "active").length;
  const pastRunCount = horses.reduce((sum, horse) => sum + (horse.pastRuns?.length ?? 0), 0);

  return {
    text: top
      ? `TARGET実データからTM INDEX v1.5を算出。Top Signalは${top.name}、指数は${top.aiScore}です。`
      : `TARGET実データを接続済み。オッズは${oddsCount}頭分、TM INDEXは分析準備中です。`,
    highlights: [
      `出走馬${horses.length}頭をcurrent-race-detail.csvから取得`,
      `過去走${pastRunCount}件、血統${horses.filter((horse) => horse.dataStatus?.pedigree === "active").length}頭、調教${trainingCount}頭を接続`,
      `単勝オッズ${oddsCount}頭分をValue評価へ反映`,
    ],
  };
};

const buildFeatured = (race, horses) =>
  [...horses]
    .filter((horse) => horse.aiScore != null)
    .sort((a, b) => b.aiScore - a.aiScore)
    .slice(0, 3)
    .map((horse, index) => ({
      raceId: race.id,
      horseId: horse.id,
      note: horse.analysis?.verdict?.summary ?? horse.comment ?? `TM INDEX v1.5 ${horse.aiScore}`,
      priority: index + 1,
    }));

const adaptCandidate = (candidate, { previewMode = false } = {}) => {
  const sourceRaces = candidate.races ?? [];
  if (!sourceRaces.length) return officialWeekData;
  const races = sourceRaces.map((race) => {
    const horses = (race.horses ?? []).map(adaptCandidateHorse);
    return {
      id: race.id,
      track: race.track,
      number: race.number,
      name: race.name,
      nameRaw: race.nameRaw,
      grade: race.grade,
      time: race.time ?? null,
      surface: race.surface,
      distance: race.distance,
      going: race.going ?? null,
      fieldSize: race.fieldSize,
      oddsUpdatedAt: race.oddsUpdatedAt ?? candidate.meta?.oddsUpdatedAt ?? null,
      oddsStatus: race.oddsStatus ?? race.dataStatus?.odds ?? candidate.meta?.oddsStatus ?? "missing",
      oddsSource: race.oddsSource ?? null,
      featured: race.id === candidate.meta?.featuredRaceId,
      category: race.category ?? (race.grade ? "grade" : "special"),
      dataStatus: race.dataStatus,
      horses,
    };
  });
  const horses = races.flatMap((race) => race.horses);

  return {
    meta: {
      date: candidate.meta?.date,
      dateLabel: candidate.meta?.dateLabel,
      venue: candidate.meta?.venue,
      updatedAt: null,
      version: previewMode ? "preview" : "production",
      brand: "TURF MATRIX",
      schemaVersion: 5,
      week: "2026-W28",
      source: "target-frontier-jv-candidate",
      dataStatus: candidate.meta?.dataStatus ?? "odds-ready",
      oddsUpdatedAt: candidate.meta?.oddsUpdatedAt ?? races[0]?.oddsUpdatedAt ?? null,
      oddsStatus: candidate.meta?.oddsStatus ?? races[0]?.oddsStatus ?? races[0]?.dataStatus?.odds ?? "missing",
      featuredRaceId: candidate.meta?.featuredRaceId ?? races[0]?.id ?? null,
      previewMode,
      intelligenceLayerConnected: candidate.intelligenceLayerConnected,
      intelligenceStage: candidate.intelligenceStage ?? null,
    },
    dailySummary: buildSummary(candidate, horses),
    races,
    featured: races.flatMap((race) => buildFeatured(race, race.horses)),
  };
};

const selectedWeekData = dataMode === "candidate" ? batchCandidateWeekData : officialWeekData;

export const weekData = isCandidatePayload(selectedWeekData)
  ? adaptCandidate(selectedWeekData, { previewMode: dataMode !== "official" })
  : selectedWeekData;
