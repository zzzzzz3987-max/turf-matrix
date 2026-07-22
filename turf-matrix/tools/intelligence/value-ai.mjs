// Value AI v1.5 deterministic odds-value scoring.
// Runs only from normalized odds data; no dummy odds or guessed popularity.

const clamp = (value, min = 35, max = 96) => Math.max(min, Math.min(max, Math.round(value)));

const impliedProbability = (odds) => (odds > 0 ? 1 / odds : null);
const WIN_PROBABILITY_POWER = 7;

const starsForEv = (ev) => {
  if (!Number.isFinite(ev)) return 0;
  if (ev >= 3) return 0;
  if (ev >= 1.5) return 5;
  if (ev >= 1.2) return 4;
  if (ev >= 1) return 3;
  if (ev >= 0.8) return 2;
  return 1;
};

const verdictForEv = (ev) => {
  if (!Number.isFinite(ev)) return null;
  if (ev >= 3) return { label: "高オッズ妙味(参考)", tone: "gray" };
  if (ev >= 1.15) return { label: "妙味あり", tone: "blue" };
  if (ev >= 0.95) return { label: "中立", tone: "gray" };
  return { label: "過剰人気気味", tone: "gray" };
};

const buildRaceValueMetrics = (horses) => {
  const evaluated = horses.filter((horse) => Number.isFinite(horse.tmIndex));
  if (!evaluated.length || evaluated.length !== horses.length) return new Map();

  const weights = evaluated.map((horse) => ({
    horse,
    weight: Math.pow(horse.tmIndex / 100, WIN_PROBABILITY_POWER),
  }));
  const total = weights.reduce((sum, item) => sum + item.weight, 0);
  if (!(total > 0)) return new Map();

  return new Map(weights.map(({ horse, weight }) => {
    const oddsActive = horse.oddsDetail?.status === "active" || horse.dataStatus?.odds === "active";
    const probability = weight / total;
    const ev = oddsActive && Number.isFinite(horse.odds) && horse.odds > 0
      ? probability * horse.odds
      : null;
    return [horse.id, {
      probability,
      ev,
      stars: starsForEv(ev),
      verdict: verdictForEv(ev),
    }];
  }));
};

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

export {
  scoreValue,
  buildValueAnalysis,
  buildRaceValueMetrics,
  starsForEv,
  verdictForEv,
};
