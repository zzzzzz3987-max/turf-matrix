// Pace AI v1.5 deterministic lap and running-position scoring.

const clamp = (value, min = 35, max = 96) => Math.max(min, Math.min(max, Math.round(value)));

const avg = (values, fallback = 60) => {
  const nums = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  return nums.length ? nums.reduce((sum, value) => sum + value, 0) / nums.length : fallback;
};

const isValidLast3F = (run) => typeof run.last3F === "number" && run.last3F > 0 && run.last3F < 45;

const scoreLap = (horse) => {
  const runs = (horse.pastRuns ?? []).filter(isValidLast3F).slice(0, 8);
  if (!runs.length) return 55;
  return clamp(avg(runs.map((run) => 92 - (run.last3F - 33) * 8)));
};

const firstPassing = (run) => {
  const order = run.passingOrder ?? [];
  return order.find((value) => typeof value === "number" && value > 0) ?? null;
};

const runningStyle = (horse) => {
  const explicit = horse.runningStyle ?? horse.currentRace?.runningStyle;
  if (explicit) return explicit;
  const positions = (horse.pastRuns ?? []).slice(0, 8).map(firstPassing).filter(Boolean);
  if (!positions.length) return "不明";
  const mean = avg(positions, 8);
  if (mean <= 2.5) return "逃げ";
  if (mean <= 5.5) return "先行";
  if (mean <= 9) return "差し";
  return "追込";
};

const scorePace = (horse) => {
  const orders = (horse.pastRuns ?? [])
    .slice(0, 8)
    .flatMap((run) => run.passingOrder ?? [])
    .filter((value) => typeof value === "number" && value > 0);
  if (!orders.length) return 58;
  const mean = avg(orders, 8);
  const style = runningStyle(horse);
  const styleBonus = style === "先行" || style === "差し" ? 4 : style === "逃げ" ? 1 : 0;
  return clamp(76 - Math.abs(mean - 6) * 3.5 + styleBonus);
};

const buildPaceAnalysis = (horse, context, scores = {}) => {
  const runs = horse.pastRuns ?? [];
  const style = runningStyle(horse);
  const firstPositions = runs.slice(0, 8).map(firstPassing).filter(Boolean);
  const meanPosition = firstPositions.length ? avg(firstPositions, 8) : null;
  const lapRuns = runs.filter(isValidLast3F).slice(0, 8);
  const bestLap = [...lapRuns].sort((a, b) => a.last3F - b.last3F)[0] ?? null;
  const paceScore = scores.pace ?? scorePace(horse);
  const lapScore = scores.lap ?? scoreLap(horse);

  return {
    score: paceScore,
    lapScore,
    style,
    status: runs.length ? "active" : "missing",
    summary: `${style}傾向。近走の位置取りと上がりから、今回の流れへの合いやすさを評価します。`,
    strengths: [
      meanPosition ? `平均位置取り ${meanPosition.toFixed(1)}番手` : "位置取りデータは限定的",
      bestLap ? `最速上がり材料: ${bestLap.raceName ?? "過去走"} ${bestLap.last3F}` : "上がり時計は未取得",
      context?.profile ? `${context.profile}条件での脚質バランスを確認` : "条件別の脚質評価は今後拡張",
    ],
    evidence: [
      `展開適性 ${paceScore}`,
      `上がり/ラップ適性 ${lapScore}`,
    ],
  };
};

export { scoreLap, scorePace, buildPaceAnalysis };
