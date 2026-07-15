const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, Math.round(value)));

const assessDataQuality = (horse) => {
  const pastRuns = horse.pastRuns?.length ?? 0;
  const hasPedigree = Boolean(horse.pedigree);
  const trainingCount = (horse.training?.slope?.length ?? 0) + (horse.training?.wood?.length ?? 0);
  const hasOdds = Boolean(horse.odds?.winOdds && horse.odds?.popularity);
  const hasCurrentRace = Boolean(horse.currentRace?.horseName || horse.horseName || horse.name);

  const score = clamp(
    (hasCurrentRace ? 20 : 0) +
      Math.min(30, pastRuns * 3) +
      (hasPedigree ? 18 : 0) +
      Math.min(18, trainingCount * 6) +
      (hasOdds ? 14 : 0)
  );

  const status = score >= 82 ? "high" : score >= 62 ? "medium" : score >= 42 ? "limited" : "low";
  const reasons = [
    hasCurrentRace ? "今回出走情報を取得済み" : "今回出走情報が不足",
    pastRuns ? `過去走${pastRuns}件` : "過去走未取得",
    hasPedigree ? "4代血統を取得済み" : "血統情報が不足",
    trainingCount ? `調教時計${trainingCount}本` : "調教時計未取得",
    hasOdds ? "オッズ取得済み" : "オッズ未取得",
  ];

  return {
    score,
    status,
    reasons,
    summary: `データ充足度${score}/100。${reasons.join(" / ")}。`,
  };
};

export { assessDataQuality };
