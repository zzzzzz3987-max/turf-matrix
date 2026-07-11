import officialWeekData from "../../tools/week-data.json";

const candidateModules = import.meta.glob("../../tools/week-data.candidate.json", {
  eager: true,
  import: "default",
});

const candidateWeekData = candidateModules["../../tools/week-data.candidate.json"] ?? null;
export const dataMode = import.meta.env.VITE_TURF_DATA_MODE === "candidate" && candidateWeekData ? "candidate" : "official";

const isCandidatePayload = (data) =>
  data?.mode === "candidate" || data?.mode === "candidate-preodds" || Boolean(data?.races?.[0]?.horses?.[0]?.currentRace);

const adaptCandidateHorse = (horse) => ({
  id: horse.id,
  number: horse.number,
  name: horse.name,
  jockey: horse.jockey,
  popularity: horse.popularity ?? null,
  odds: horse.odds ?? null,
  aiScore: horse.tmIndex ?? null,
  comment: "分析準備中",
  currentRace: horse.currentRace,
  pastRuns: horse.pastRuns ?? [],
  training: horse.training ?? { slope: [], wood: [] },
  pedigreeRaw: horse.pedigree,
  dataStatus: horse.dataStatus,
  analysis: {
    status: "not_connected",
    confidence: null,
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
  },
});

const buildSummary = (candidate, horses) => {
  const oddsCount = horses.filter((horse) => horse.odds != null && horse.popularity != null).length;
  const trainingCount = horses.filter((horse) => horse.dataStatus?.training === "active").length;

  return {
    text: `TARGET実データを接続済み。オッズは${oddsCount}頭分、TM INDEX/TM VALUEは分析未接続です。`,
    highlights: [
      `出走馬${horses.length}頭をcurrent-race-detail.csvから取得`,
      `過去走${candidate.join?.pastRunCount ?? "311"}件、血統${horses.filter((horse) => horse.dataStatus?.pedigree === "active").length}頭、調教${trainingCount}頭を接続`,
      "Value AIとTM VALUEは次Sprintで正式接続",
    ],
  };
};

const adaptCandidate = (candidate, { previewMode = false } = {}) => {
  const race = candidate.races?.[0];
  if (!race) return officialWeekData;

  const horses = (race.horses ?? []).map(adaptCandidateHorse);

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
      oddsUpdatedAt: candidate.meta?.oddsUpdatedAt ?? race.oddsUpdatedAt ?? null,
      oddsStatus: candidate.meta?.oddsStatus ?? race.oddsStatus ?? race.dataStatus?.odds ?? "missing",
      featuredRaceId: race.id,
      previewMode,
      intelligenceLayerConnected: candidate.intelligenceLayerConnected,
    },
    dailySummary: buildSummary(candidate, horses),
    races: [
      {
        id: race.id,
        track: race.track,
        number: race.number,
        name: race.name,
        nameRaw: race.nameRaw,
        grade: race.grade,
        time: null,
        surface: race.surface,
        distance: race.distance,
        going: null,
        fieldSize: race.fieldSize,
        oddsUpdatedAt: race.oddsUpdatedAt ?? candidate.meta?.oddsUpdatedAt ?? null,
        oddsStatus: race.oddsStatus ?? race.dataStatus?.odds ?? candidate.meta?.oddsStatus ?? "missing",
        oddsSource: race.oddsSource ?? null,
        featured: true,
        category: "grade",
        dataStatus: race.dataStatus,
        horses,
      },
    ],
    featured: [],
  };
};

const selectedWeekData = dataMode === "candidate" ? candidateWeekData : officialWeekData;

export const weekData = isCandidatePayload(selectedWeekData)
  ? adaptCandidate(selectedWeekData, { previewMode: dataMode === "candidate" })
  : selectedWeekData;
