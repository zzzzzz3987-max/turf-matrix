import { buildRaceValueMetrics } from "./value-ai.mjs";

const percentile = (rank, size) => {
  if (!size || size <= 1) return 100;
  return Math.round(((size - rank) / (size - 1)) * 100);
};

const labelForGap = (rank, gapToTop, leaderGap, tiedTopCount) => {
  if (gapToTop === 0 && tiedTopCount > 1) return "指数1位タイ";
  if (rank === 1) return leaderGap >= 3 ? "Top Signal" : "指数1位（僅差）";
  if (gapToTop <= 2) return "指数上位";
  if (gapToTop <= 5) return "上位圏";
  if (gapToTop <= 9) return "相手候補";
  return "押さえ";
};

const calibrateRaceIntelligence = (race) => {
  const horses = race.horses ?? [];
  const valueMetricsByHorse = buildRaceValueMetrics(horses);
  const ranked = [...horses]
    .filter((horse) => Number.isFinite(horse.tmIndex))
    .sort((a, b) => b.tmIndex - a.tmIndex || (a.number ?? 999) - (b.number ?? 999));
  const topScore = ranked[0]?.tmIndex ?? null;
  const leaderGap = ranked.length >= 2 ? ranked[0].tmIndex - ranked[1].tmIndex : null;
  const tiedTopCount = Number.isFinite(topScore) ? ranked.filter((horse) => horse.tmIndex === topScore).length : 0;
  const size = ranked.length;

  const rankByHorse = new Map(
    ranked.map((horse, index) => {
      const rank = index + 1;
      const gapToTop = Number.isFinite(topScore) ? topScore - horse.tmIndex : null;
      return [
        horse,
        {
          rank,
          fieldSize: size,
          percentile: percentile(rank, size),
          gapToTop,
          label: labelForGap(rank, gapToTop ?? 99, leaderGap ?? 99, tiedTopCount),
        },
      ];
    })
  );

  return {
    ...race,
    horses: horses.map((horse) => {
      const relative = rankByHorse.get(horse) ?? null;
      if (!relative) return horse;
      const valueMetrics = valueMetricsByHorse.get(horse) ?? null;
      const valueDetail = {
        ...horse.analysis?.factorsDetail?.value,
        probability: valueMetrics?.probability ?? null,
        ev: valueMetrics?.ev ?? null,
        indexRank: valueMetrics?.indexRank ?? relative.rank,
        marketGap: valueMetrics?.marketGap ?? null,
        highlighted: valueMetrics?.highlighted ?? false,
        stars: valueMetrics?.stars ?? 0,
        verdict: valueMetrics?.verdict ?? null,
        eligible: valueMetrics?.eligible ?? false,
        eligibilityReasons: valueMetrics?.reasons ?? [],
      };
      const rankText = `${relative.rank}/${relative.fieldSize}位`;
      return {
        ...horse,
        analysis: {
          ...horse.analysis,
          value: valueDetail,
          factorsDetail: {
            ...horse.analysis?.factorsDetail,
            value: valueDetail,
          },
          relative,
          verdict: horse.analysis?.verdict
            ? {
                ...horse.analysis.verdict,
                evidence: [
                  ...(horse.analysis.verdict.evidence ?? []),
                  `レース内順位 ${rankText}`,
                  `首位との差 ${relative.gapToTop}`,
                ],
              }
            : horse.analysis?.verdict,
          topSignal: {
            ...(horse.analysis?.topSignal ?? {}),
            label: relative.label,
            summary: `${horse.name} / TM INDEX ${horse.tmIndex} / ${rankText}`,
          },
        },
      };
    }),
  };
};

export { calibrateRaceIntelligence };
