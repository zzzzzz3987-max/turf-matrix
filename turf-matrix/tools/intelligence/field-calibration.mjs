const percentile = (rank, size) => {
  if (!size || size <= 1) return 100;
  return Math.round(((size - rank) / (size - 1)) * 100);
};

const labelForGap = (rank, gapToTop) => {
  if (rank === 1) return "Top Signal";
  if (gapToTop <= 2) return "首位圏";
  if (gapToTop <= 5) return "上位圏";
  if (gapToTop <= 9) return "相手候補";
  return "押さえ";
};

const calibrateRaceIntelligence = (race) => {
  const horses = race.horses ?? [];
  const ranked = [...horses]
    .filter((horse) => Number.isFinite(horse.tmIndex))
    .sort((a, b) => b.tmIndex - a.tmIndex || (a.number ?? 999) - (b.number ?? 999));
  const topScore = ranked[0]?.tmIndex ?? null;
  const size = ranked.length;

  const rankById = new Map(
    ranked.map((horse, index) => {
      const rank = index + 1;
      const gapToTop = Number.isFinite(topScore) ? topScore - horse.tmIndex : null;
      return [
        horse.id,
        {
          rank,
          fieldSize: size,
          percentile: percentile(rank, size),
          gapToTop,
          label: labelForGap(rank, gapToTop ?? 99),
        },
      ];
    })
  );

  return {
    ...race,
    horses: horses.map((horse) => {
      const relative = rankById.get(horse.id) ?? null;
      if (!relative) return horse;
      const rankText = `${relative.rank}/${relative.fieldSize}位`;
      return {
        ...horse,
        analysis: {
          ...horse.analysis,
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
