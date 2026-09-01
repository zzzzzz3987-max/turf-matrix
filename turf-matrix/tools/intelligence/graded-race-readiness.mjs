const finite = (value) => typeof value === "number" && Number.isFinite(value);
const horseName = (horse) => horse?.name ?? horse?.horseName ?? `馬番${horse?.number ?? "?"}`;

const issue = (severity, key, message, horses = []) => ({ severity, key, message, horses });

const namesWhere = (horses, predicate) => horses.filter(predicate).map(horseName);

const summarizeGradedRaceReadiness = (race, { stage = "analysis" } = {}) => {
  const horses = race?.horses ?? [];
  const publish = stage === "publish";
  const issues = [];
  const pedigreeCounts = horses.map((horse) => horse?.pedigree?.ancestors?.length ?? 0);
  const bloodDetails = horses.map((horse) => horse?.analysis?.factorsDetail?.blood ?? null);
  const trainingDetails = horses.map((horse) => horse?.analysis?.factorsDetail?.training ?? null);
  const loadDetails = horses.map((horse) => horse?.analysis?.factorsDetail?.load ?? null);
  const paceDetails = horses.map((horse) => horse?.analysis?.factorsDetail?.pace ?? null);

  if (!horses.length) issues.push(issue("blocker", "horses", "出走馬データがありません。"));

  const missingAnalysis = namesWhere(horses, (horse) => !horse?.analysis?.status);
  if (missingAnalysis.length) {
    issues.push(issue("blocker", "analysis", "Intelligence分析が未生成です。", missingAnalysis));
  }

  const missingPedigree = namesWhere(horses, (_, index) => pedigreeCounts[index] < 14);
  const partialPedigree = namesWhere(horses, (_, index) => pedigreeCounts[index] >= 14 && pedigreeCounts[index] < 30);
  if (missingPedigree.length) {
    issues.push(issue("blocker", "pedigree", "3代相当の血統データに届いていません。", missingPedigree));
  }
  if (partialPedigree.length) {
    issues.push(issue("warning", "pedigree4", "4代30祖先は未取得で、3代相当14祖先による評価です。", partialPedigree));
  }

  const missingBlood = namesWhere(horses, (_, index) => !finite(bloodDetails[index]?.score) || bloodDetails[index]?.status === "missing");
  const partialBlood = namesWhere(horses, (_, index) => bloodDetails[index] && bloodDetails[index].status !== "active");
  if (missingBlood.length) issues.push(issue("blocker", "blood", "Blood評価が未生成です。", missingBlood));
  if (partialBlood.length) issues.push(issue("warning", "bloodPartial", "Blood辞書または統計の照合が限定的です。", partialBlood));

  const missingTraining = namesWhere(horses, (_, index) => !finite(trainingDetails[index]?.score) || trainingDetails[index]?.status === "missing");
  const partialTraining = namesWhere(horses, (_, index) => trainingDetails[index] && trainingDetails[index].status === "partial");
  if (missingTraining.length) issues.push(issue("blocker", "training", "調教時計と映像評価の両方が未取得です。", missingTraining));
  if (partialTraining.length) issues.push(issue("warning", "trainingPartial", "調教評価が一部取得です。", partialTraining));

  const missingLoad = namesWhere(horses, (_, index) => loadDetails[index]?.status !== "active");
  const missingPace = namesWhere(horses, (_, index) => paceDetails[index]?.status !== "active");
  if (missingLoad.length) issues.push(issue("blocker", "load", "斤量評価が未確定です。", missingLoad));
  if (missingPace.length) issues.push(issue("blocker", "pace", "展開評価が未確定です。", missingPace));

  const missingOdds = namesWhere(horses, (horse) => !finite(horse?.odds) || !finite(horse?.popularity));
  if (missingOdds.length) {
    issues.push(issue(publish ? "blocker" : "warning", "odds", "単勝オッズまたは人気が未取得です。", missingOdds));
  }
  if (!race?.weather) issues.push(issue(publish ? "blocker" : "warning", "weather", "天候が未取得です。"));
  if (!race?.going) issues.push(issue(publish ? "blocker" : "warning", "going", "馬場状態が未取得です。"));
  if (race?.trackBias?.status !== "active") {
    issues.push(issue("warning", "trackBias", "同開催のTrack Biasは未確定です。"));
  }

  const blockers = issues.filter((item) => item.severity === "blocker");
  const warnings = issues.filter((item) => item.severity === "warning");
  const goodRunCompared = trainingDetails.filter((detail) => detail?.goodRunComparison?.status && detail.goodRunComparison.status !== "missing").length;
  const videoReviewed = trainingDetails.filter((detail) => detail?.videoReview).length;
  const bloodActive = bloodDetails.filter((detail) => detail?.status === "active").length;
  const bloodStatEvidence = bloodDetails.filter((detail) =>
    (detail?.evidenceV2 ?? []).some((entry) => finite(entry?.sample) && entry.sample > 0)
  ).length;

  return {
    id: race?.id ?? null,
    name: race?.name ?? null,
    track: race?.track ?? null,
    number: race?.number ?? null,
    grade: race?.grade ?? null,
    stage,
    status: blockers.length ? "blocked" : warnings.length ? "conditional" : "ready",
    horseCount: horses.length,
    metrics: {
      pedigree14: pedigreeCounts.filter((count) => count >= 14).length,
      pedigree30: pedigreeCounts.filter((count) => count >= 30).length,
      bloodActive,
      bloodStatEvidence,
      trainingActive: trainingDetails.filter((detail) => detail?.status === "active").length,
      goodRunCompared,
      videoReviewed,
      loadActive: loadDetails.filter((detail) => detail?.status === "active").length,
      paceActive: paceDetails.filter((detail) => detail?.status === "active").length,
      oddsActive: horses.length - missingOdds.length,
      weatherReady: Boolean(race?.weather),
      goingReady: Boolean(race?.going),
      trackBiasActive: race?.trackBias?.status === "active",
    },
    issues,
  };
};

const evaluateGradedRaceReadiness = (weekData, options = {}) => {
  const races = (weekData?.races ?? [])
    .filter((race) => Boolean(race?.grade))
    .map((race) => summarizeGradedRaceReadiness(race, options));
  const blockers = races.reduce((sum, race) => sum + race.issues.filter((item) => item.severity === "blocker").length, 0);
  const warnings = races.reduce((sum, race) => sum + race.issues.filter((item) => item.severity === "warning").length, 0);
  return {
    stage: options.stage ?? "analysis",
    status: !races.length ? "waiting" : blockers ? "blocked" : warnings ? "conditional" : "ready",
    raceCount: races.length,
    blockers,
    warnings,
    races,
  };
};

export { evaluateGradedRaceReadiness, summarizeGradedRaceReadiness };
