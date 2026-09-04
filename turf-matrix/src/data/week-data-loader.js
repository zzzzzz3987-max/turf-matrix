import officialWeekDataUrl from "../../tools/week-data.json?url";
import { updateDiffForRace } from "../lib/public-update-diff.js";
import { shouldUseCandidatePreview } from "../lib/week-data-selection.js";

const candidateModules = import.meta.glob("../../tools/week-data.batch-candidate.json", {
  eager: true,
  query: "?url",
  import: "default",
});

const batchCandidateWeekDataUrl = candidateModules["../../tools/week-data.batch-candidate.json"] ?? null;
const requestedMode = import.meta.env.VITE_TURF_DATA_MODE;
const candidateModeRequested = requestedMode === "candidate" || requestedMode === "batch";
export let dataMode = candidateModeRequested && batchCandidateWeekDataUrl ? "candidate" : "official";

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
    id: horse.id ?? horse.currentRace?.horseId ?? `${horse.currentRace?.raceDate ?? "preview"}-${horse.name}`,
    number: horse.number,
    name: horse.name,
    jockey: horse.jockey,
    popularity: horse.popularity ?? null,
    odds: horse.odds ?? null,
    oddsDetail: horse.oddsDetail ?? null,
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
  const pedigreeCount = horses.filter((horse) => horse.dataStatus?.pedigree === "active").length;
  const raceCount = candidate.races?.length ?? 0;

  return {
    text: top
      ? `本日の最高評価は${top.name}（TM INDEX ${top.aiScore}）。${raceCount}レース${horses.length}頭を比較しています。`
      : `${raceCount}レースを掲載しています。`,
    highlights: [
      `出走馬 ${horses.length}頭`,
      `過去走 ${pastRunCount}件 / 血統 ${pedigreeCount}頭 / 調教 ${trainingCount}頭`,
      `単勝オッズ ${oddsCount}頭分を反映`,
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
      note: horse.analysis?.verdict?.summary ?? horse.comment ?? `TM INDEX ${horse.aiScore}`,
      priority: index + 1,
    }));

const adaptCandidate = (candidate, { previewMode = false, officialWeekData = null } = {}) => {
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
      weather: race.weather ?? null,
      going: race.going ?? null,
      goingUpdatedAt: race.goingUpdatedAt ?? null,
      trackBias: race.trackBias ?? race.raceContext?.trackBias ?? null,
      courseType: race.courseType ?? null,
      conditionSummary: race.conditionSummary ?? null,
      raceContext: race.raceContext ?? null,
      fieldSize: race.fieldSize,
      oddsUpdatedAt: race.oddsUpdatedAt ?? candidate.meta?.oddsUpdatedAt ?? null,
      oddsStatus: race.oddsStatus ?? race.dataStatus?.odds ?? candidate.meta?.oddsStatus ?? "missing",
      oddsSource: race.oddsSource ?? null,
      updateDiff: updateDiffForRace(candidate.publicUpdate, race.id, candidate.meta?.date),
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

let weekDataPromise = null;

const fetchJson = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`週次データの読み込みに失敗しました (${response.status})`);
  return response.json();
};

export const loadWeekData = () => {
  if (!weekDataPromise) {
    weekDataPromise = Promise.all([
      fetchJson(officialWeekDataUrl),
      batchCandidateWeekDataUrl ? fetchJson(batchCandidateWeekDataUrl) : Promise.resolve(null),
    ]).then(([officialWeekData, batchCandidateWeekData]) => {
      const useCandidate = shouldUseCandidatePreview({
        requestedMode,
        candidate: batchCandidateWeekData,
        official: officialWeekData,
      });
      dataMode = useCandidate ? "candidate" : "official";
      const selectedWeekData = useCandidate ? batchCandidateWeekData : officialWeekData;
      return isCandidatePayload(selectedWeekData)
        ? adaptCandidate(selectedWeekData, { previewMode: useCandidate, officialWeekData })
        : selectedWeekData;
    });
  }
  return weekDataPromise;
};
