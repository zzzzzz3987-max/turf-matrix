// Form AI v1.5 deterministic ability and recent-form scoring.

const clamp = (value, min = 35, max = 96) => Math.max(min, Math.min(max, Math.round(value)));

const avg = (values, fallback = 60) => {
  const nums = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  return nums.length ? nums.reduce((sum, value) => sum + value, 0) / nums.length : fallback;
};

const finishScore = (run) => {
  const field = run.fieldSize || 16;
  const finish = run.finishPosition || field;
  return ((field - finish + 1) / field) * 100;
};

const marginScore = (run) => (run.margin == null ? 60 : 74 - run.margin * 18);

const classBonus = (run) => {
  const text = `${run.grade ?? ""}${run.raceName ?? ""}${run.className ?? ""}`;
  if (/G1|Ｇ１|GⅠ/.test(text)) return 10;
  if (/G2|Ｇ２|GⅡ/.test(text)) return 7;
  if (/G3|Ｇ３|GⅢ/.test(text)) return 5;
  if (/\(L\)|リステッド|OP|オープン/.test(text)) return 3;
  return 0;
};

const popularityGapScore = (run) => {
  if (!run.popularity || !run.finishPosition) return 0;
  const gap = run.popularity - run.finishPosition;
  return Math.max(-8, Math.min(10, gap * 1.8));
};

const distanceFitBonus = (run, targetDistance) => {
  if (!targetDistance || !run.distance) return 0;
  const gap = Math.abs(run.distance - targetDistance);
  if (gap <= 200) return 4;
  if (gap <= 400) return 1;
  return -3;
};

const runScore = (run, index, targetDistance) => {
  const recentWeight = 1 - index * 0.08;
  const base =
    finishScore(run) * 0.42 +
    marginScore(run) * 0.28 +
    (run.last3F ? clamp(90 - (run.last3F - 33.5) * 7, 45, 92) : 60) * 0.15 +
    60 * 0.15;
  return (base + classBonus(run) + popularityGapScore(run) + distanceFitBonus(run, targetDistance)) * recentWeight;
};

const scoreZi = (horse) => {
  const zi = horse.odds?.zi ?? horse.availableIndex ?? horse.currentRace?.zi;
  if (typeof zi === "number" && Number.isFinite(zi)) return clamp(42 + (zi - 80) * 1.3);
  return clamp(scoreRecentForm(horse) - 4);
};

const scoreRecentForm = (horse) => {
  const runs = (horse.pastRuns ?? []).slice(0, 5);
  if (!runs.length) return 50;
  return clamp(avg(runs.map((run, index) => runScore(run, index, horse.currentRace?.distance))));
};

const formatRun = (run) => {
  if (!run) return "近走データ未取得";
  const course = run.course ? `${run.course}` : "";
  const name = run.raceName ?? "前走";
  const finish = run.finishPosition ? `${run.finishPosition}着` : "着順未取得";
  const distance = run.distance ? `${run.surface ?? ""}${run.distance}m` : "";
  return `${course}${name}${distance ? `(${distance})` : ""}で${finish}`;
};

const buildFormAnalysis = (horse, score = scoreRecentForm(horse)) => {
  const runs = horse.pastRuns ?? [];
  const recent = runs.slice(0, 5);
  const best = [...recent].sort((a, b) => runScore(b, 0, horse.currentRace?.distance) - runScore(a, 0, horse.currentRace?.distance))[0] ?? null;
  const topClassRuns = recent.filter((run) => classBonus(run) >= 5);
  const distanceMatches = recent.filter((run) => distanceFitBonus(run, horse.currentRace?.distance) >= 4);
  const popularityUpsets = recent.filter((run) => popularityGapScore(run) >= 4);
  const label = score >= 82 ? "近走内容は強い" : score >= 70 ? "近走内容は良好" : score >= 58 ? "近走内容は標準" : "近走評価は控えめ";

  return {
    score,
    status: runs.length ? "active" : "missing",
    count: runs.length,
    label,
    summary: runs.length
      ? `${formatRun(recent[0])}。直近${Math.min(5, recent.length)}走の着順、着差、相手関係、距離適性を分解して評価。`
      : "近走データが未取得のため、能力評価は控えめに扱います。",
    strengths: [
      best ? `評価材料: ${formatRun(best)}` : "評価材料: 近走データ未取得",
      topClassRuns.length ? `重賞/上級条件の経験 ${topClassRuns.length}走` : "上級条件での強い裏付けは次データで確認",
      distanceMatches.length ? `今回距離に近い実績 ${distanceMatches.length}走` : "今回距離への直接実績は限定的",
      popularityUpsets.length ? `人気以上に走った近走 ${popularityUpsets.length}走` : "市場評価を上回る近走は限定的",
    ],
    evidence: recent.map((run) => ({
      text: formatRun(run),
      score: clamp(runScore(run, 0, horse.currentRace?.distance)),
    })),
  };
};

export { scoreZi, scoreRecentForm, buildFormAnalysis };
