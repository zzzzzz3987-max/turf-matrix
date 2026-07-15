// Value AI v1.5 deterministic odds-value scoring.
// Runs only from normalized odds data; no dummy odds or guessed popularity.

const clamp = (value, min = 35, max = 96) => Math.max(min, Math.min(max, Math.round(value)));

const impliedProbability = (odds) => (odds > 0 ? 1 / odds : null);

const scoreValue = (horse, abilityScore, tmBaseScore = null) => {
  if (!horse.odds?.winOdds || !horse.odds?.popularity) return null;
  const popularity = horse.odds.popularity;
  const odds = horse.odds.winOdds;
  const base = Number.isFinite(tmBaseScore) ? tmBaseScore : abilityScore;
  const abilityGapBonus = (abilityScore - 65) * 0.35;
  const rankGapBonus = Math.max(0, popularity - 4) * 2.1;
  const indexSupport = (base - 70) * 0.25;
  const longOddsRisk = odds > 50 ? (odds - 50) * 0.18 : 0;
  const shortOddsRisk = odds < 3 && popularity <= 2 ? 6 : 0;
  return clamp(52 + abilityGapBonus + rankGapBonus + indexSupport - longOddsRisk - shortOddsRisk);
};

const buildValueAnalysis = (horse, valueScore) => {
  if (valueScore == null || !horse.odds?.winOdds || !horse.odds?.popularity) {
    return {
      score: null,
      status: "missing",
      summary: "オッズ未取得のため、Value AIは未評価です。",
      strengths: ["オッズ追加後に妙味を評価"],
      evidence: [],
    };
  }

  const odds = horse.odds.winOdds;
  const popularity = horse.odds.popularity;
  const implied = impliedProbability(odds);
  const label = valueScore >= 82 ? "妙味大" : valueScore >= 70 ? "妙味あり" : valueScore >= 58 ? "市場評価は妥当" : "過剰人気に注意";

  return {
    score: valueScore,
    status: "active",
    label,
    impliedProbability: implied,
    summary: `単勝${odds}倍・${popularity}人気。指数評価と市場評価のズレから${label}と判定します。`,
    strengths: [
      `単勝オッズ ${odds}倍`,
      `${popularity}人気`,
      implied ? `市場の単勝示唆確率 約${(implied * 100).toFixed(1)}%` : "示唆確率未評価",
    ],
    evidence: [`Value AI ${valueScore}`, label],
  };
};

export { scoreValue, buildValueAnalysis };
