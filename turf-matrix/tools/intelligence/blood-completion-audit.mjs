const REQUIRED_COMPONENTS = [
  "sireTrait",
  "broodmareSire",
  "pairing",
  "sireLineBroodmareSireLine",
  "distanceFit",
  "surfaceFit",
  "courseFit",
  "trackGeometryFit",
  "goingFit",
  "crossFit",
  "familyFit",
  "historicalEvidence",
  "individualProfileFit",
];

const bloodFor = (horse) => horse?.analysis?.factorsDetail?.blood ?? null;
const countWhere = (rows, predicate) => rows.reduce((count, row) => count + Number(predicate(row)), 0);

const auditBloodCandidate = (weekData) => {
  const rows = (weekData?.races ?? []).flatMap((race) =>
    (race.horses ?? []).map((horse) => ({ race, horse, blood: bloodFor(horse) }))
  );
  const total = rows.length;
  const summaries = new Set(rows.map(({ blood }) => blood?.summary).filter(Boolean));
  const forbiddenGenericText = "父系と母系の両面から";
  const metrics = {
    raceCount: weekData?.races?.length ?? 0,
    horseCount: total,
    finiteScoreCount: countWhere(rows, ({ blood }) => Number.isFinite(Number(blood?.score))),
    boundedScoreCount: countWhere(rows, ({ blood }) => Number(blood?.score) >= 0 && Number(blood?.score) <= 100),
    fiveGenerationCount: countWhere(rows, ({ blood }) =>
      blood?.dataCompleteness?.status === "complete"
      && blood?.dataCompleteness?.deepestGeneration >= 5
      && blood?.dataCompleteness?.entryCount >= 62
    ),
    sireAndBroodmareSireCount: countWhere(rows, ({ blood }) =>
      Boolean(blood?.identity?.sire && blood?.identity?.broodmareSire)
    ),
    determinedCrossCount: countWhere(rows, ({ blood }) =>
      ["detected", "none_detected"].includes(blood?.crossStatus)
    ),
    detectedCrossHorseCount: countWhere(rows, ({ blood }) => blood?.crossStatus === "detected"),
    noCrossHorseCount: countWhere(rows, ({ blood }) => blood?.crossStatus === "none_detected"),
    confidenceCount: countWhere(rows, ({ blood }) => Boolean(blood?.confidenceGrade)),
    evidenceCount: countWhere(rows, ({ blood }) => (blood?.evidenceV2?.length ?? 0) > 0),
    componentCount: countWhere(rows, ({ blood }) =>
      REQUIRED_COMPONENTS.every((key) => Object.hasOwn(blood?.componentDetails ?? {}, key))
    ),
    sireProfileCount: countWhere(rows, ({ blood }) => Boolean(blood?.sireProfile?.summary)),
    broodmareSireProfileCount: countWhere(rows, ({ blood }) => Boolean(blood?.broodmareSireProfile?.summary)),
    uniqueSummaryCount: summaries.size,
    genericSummaryCount: countWhere(rows, ({ blood }) => String(blood?.summary ?? "").includes(forbiddenGenericText)),
    pairingOrCrossScoreAppliedCount: countWhere(rows, ({ blood }) =>
      (blood?.evidenceV2 ?? []).some((evidence) =>
        ["pairing", "cross"].includes(evidence.type) && evidence.scoreApplied === true
      )
    ),
  };
  const checks = [
    ["Blood scoreが全頭で有限", metrics.finiteScoreCount === total],
    ["Blood scoreが全頭0〜100", metrics.boundedScoreCount === total],
    ["5代相当62祖先を全頭取得", metrics.fiveGenerationCount === total],
    ["父・母父を全頭取得", metrics.sireAndBroodmareSireCount === total],
    ["クロスを全頭で判定", metrics.determinedCrossCount === total],
    ["Confidenceを全頭で保持", metrics.confidenceCount === total],
    ["Evidenceを全頭で保持", metrics.evidenceCount === total],
    ["Blood内部コンポーネントを全頭で保持", metrics.componentCount === total],
    ["父の固有説明または祖先フォールバックを全頭で保持", metrics.sireProfileCount === total],
    ["母父の固有説明または祖先フォールバックを全頭で保持", metrics.broodmareSireProfileCount === total],
    ["馬固有の説明文を全頭で生成", metrics.uniqueSummaryCount === total && metrics.genericSummaryCount === 0],
    ["未採用の配合・クロス統計を点数へ接続しない", metrics.pairingOrCrossScoreAppliedCount === 0],
  ].map(([label, pass]) => ({ label, pass }));
  return {
    status: total > 0 && checks.every((check) => check.pass) ? "complete" : "incomplete",
    metrics,
    checks,
    failures: rows.filter(({ blood }) =>
      !blood
      || !Number.isFinite(Number(blood.score))
      || blood.dataCompleteness?.deepestGeneration < 5
      || blood.dataCompleteness?.entryCount < 62
      || !blood.identity?.sire
      || !blood.identity?.broodmareSire
      || !["detected", "none_detected"].includes(blood.crossStatus)
      || !blood.confidenceGrade
      || !(blood.evidenceV2?.length > 0)
    ).map(({ race, horse }) => ({
      race: `${race.track ?? "-"}${race.number ?? "-"}R`,
      horse: horse.name ?? horse.horseName ?? "-",
    })),
  };
};

export { REQUIRED_COMPONENTS, auditBloodCandidate };
