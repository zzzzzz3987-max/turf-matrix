// Pace AI v1.6: deterministic field-level pace projection and style fit.

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

const normalizedPosition = (run) => {
  const position = firstPassing(run);
  if (!position) return null;
  const fieldSize = Number(run.fieldSize);
  if (Number.isFinite(fieldSize) && fieldSize > 1) return (position - 1) / (fieldSize - 1);
  return Math.min(1, (position - 1) / 15);
};

const classifyRunningStyle = (horse) => {
  const explicit = horse.runningStyle ?? horse.currentRace?.runningStyle;
  if (["逃げ", "先行", "差し", "追込"].includes(explicit)) return explicit;

  const runs = (horse.pastRuns ?? []).slice(0, 5);
  const positions = runs.map(firstPassing).filter(Number.isFinite);
  const normalized = runs.map(normalizedPosition).filter(Number.isFinite);
  if (!positions.length || !normalized.length) return "不明";

  const leadRate = positions.filter((position) => position === 1).length / positions.length;
  const hasFieldSizes = runs.some((run) => Number.isFinite(Number(run.fieldSize)) && Number(run.fieldSize) > 1);
  if (!hasFieldSizes) {
    const absoluteMean = avg(positions, 8);
    if (leadRate >= 0.4) return "逃げ";
    if (absoluteMean <= 5.5) return "先行";
    if (absoluteMean <= 9) return "差し";
    return "追込";
  }
  const frontRate = normalized.filter((position) => position <= 0.25).length / normalized.length;
  const mean = avg(normalized, 0.5);

  if (leadRate >= 0.4 || (leadRate >= 0.25 && mean <= 0.12)) return "逃げ";
  if (frontRate >= 0.6 || mean <= 0.3) return "先行";
  if (mean <= 0.68) return "差し";
  return "追込";
};

const buildRacePaceScenario = (horses = []) => {
  const styles = horses.map((horse) => ({
    horseName: horse.horseName ?? horse.name ?? horse.currentRace?.horseName ?? null,
    horseNumber: horse.horseNumber ?? horse.number ?? horse.currentRace?.horseNumber ?? null,
    style: classifyRunningStyle(horse),
  }));
  const known = styles.filter((item) => item.style !== "不明");
  const counts = Object.fromEntries(["逃げ", "先行", "差し", "追込", "不明"].map((style) => [
    style,
    styles.filter((item) => item.style === style).length,
  ]));
  const fieldSize = styles.length;
  const coverage = fieldSize ? known.length / fieldSize : 0;
  const escapeCount = counts["逃げ"];
  const frontCount = counts["先行"];

  let expectedPace = "標準";
  if (escapeCount >= 3 || (escapeCount >= 2 && frontCount >= 4)) expectedPace = "ハイ";
  else if (escapeCount <= 1 && frontCount <= 2) expectedPace = "スロー";

  const confidence = coverage >= 0.8 ? "high" : coverage >= 0.5 ? "mid" : "low";
  const reason = `逃げ候補${escapeCount}頭・先行候補${frontCount}頭から${expectedPace}想定`;

  return {
    expectedPace,
    confidence,
    coverage: Math.round(coverage * 1000) / 1000,
    fieldSize,
    knownCount: known.length,
    counts,
    reason,
    runners: styles,
  };
};

const scenarioAdjustment = (style, expectedPace) => {
  if (expectedPace === "ハイ") return { "逃げ": -5, "先行": -2, "差し": 4, "追込": 5 }[style] ?? 0;
  if (expectedPace === "スロー") return { "逃げ": 5, "先行": 3, "差し": -2, "追込": -5 }[style] ?? 0;
  return { "逃げ": 0, "先行": 1, "差し": 1, "追込": 0 }[style] ?? 0;
};

const courseStyleAdjustment = (style, context) => {
  const styleBias = context?.styleBias ?? [];
  return styleBias.includes(style) ? 2 : 0;
};

const trackBiasAdjustment = (horse, context) => {
  const bias = context?.trackBias;
  if (!bias || bias.style !== "front") return 0;
  const style = classifyRunningStyle(horse);
  const strong = bias.strength === "strong";
  if (style === "逃げ" || style === "先行") return strong ? 4 : 2;
  if (style === "追込") return strong ? -3 : -1;
  return 0;
};

const legacyPositionScore = (horse) => {
  const orders = (horse.pastRuns ?? [])
    .slice(0, 8)
    .flatMap((run) => run.passingOrder ?? [])
    .filter((value) => typeof value === "number" && value > 0);
  if (!orders.length) return 58;
  const mean = avg(orders, 8);
  const style = classifyRunningStyle(horse);
  const styleBonus = style === "先行" || style === "差し" ? 4 : style === "逃げ" ? 1 : 0;
  return 76 - Math.abs(mean - 6) * 3.5 + styleBonus;
};

const scorePace = (horse, context = {}) => {
  const scenario = context?.paceScenario;
  if (!scenario || scenario.confidence === "low") {
    return clamp(legacyPositionScore(horse) + trackBiasAdjustment(horse, context));
  }
  const style = classifyRunningStyle(horse);
  return clamp(
    72
      + scenarioAdjustment(style, scenario.expectedPace)
      + courseStyleAdjustment(style, context)
      + trackBiasAdjustment(horse, context),
  );
};

const buildPaceAnalysis = (horse, context, scores = {}) => {
  const runs = horse.pastRuns ?? [];
  const style = classifyRunningStyle(horse);
  const firstPositions = runs.slice(0, 8).map(firstPassing).filter(Number.isFinite);
  const meanPosition = firstPositions.length ? avg(firstPositions, 8) : null;
  const lapRuns = runs.filter(isValidLast3F).slice(0, 8);
  const bestLap = [...lapRuns].sort((a, b) => a.last3F - b.last3F)[0] ?? null;
  const paceScore = scores.pace ?? scorePace(horse, context);
  const lapScore = scores.lap ?? scoreLap(horse);
  const liveBias = context?.trackBias ?? null;
  const liveBiasAdjustment = trackBiasAdjustment(horse, context);
  const scenario = context?.paceScenario ?? null;
  const fitAdjustment = scenario ? scenarioAdjustment(style, scenario.expectedPace) : 0;

  return {
    score: paceScore,
    lapScore,
    style,
    status: runs.length ? "active" : "missing",
    expectedPace: scenario?.expectedPace ?? null,
    scenarioConfidence: scenario?.confidence ?? "missing",
    scenarioFitAdjustment: fitAdjustment,
    summary: scenario
      ? `${scenario.expectedPace}想定。${style}脚質との相性を出走構成から評価します。`
      : `${style}傾向。レース全体の脚質構成は未取得のため、位置取り傾向のみ評価します。`,
    strengths: [
      scenario?.reason ?? "レース全体の想定ペースは未算出",
      `脚質 ${style} / 展開相性補正 ${fitAdjustment >= 0 ? "+" : ""}${fitAdjustment}`,
      meanPosition ? `平均位置取り ${meanPosition.toFixed(1)}番手` : "位置取りデータは限定的",
      bestLap ? `最速上がり材料: ${bestLap.raceName ?? bestLap.course ?? "過去走"} ${bestLap.last3F}` : "上がり時計は未取得",
      liveBias ? `当日トラックバイアス: ${liveBias.summary}` : "当日トラックバイアスは未取得",
    ],
    evidence: [
      `想定ペース ${scenario?.expectedPace ?? "未算出"}`,
      `脚質 ${style}`,
      `展開相性補正 ${fitAdjustment >= 0 ? "+" : ""}${fitAdjustment}`,
      `展開適性 ${paceScore}`,
      `上がり・ラップ適性 ${lapScore}`,
      ...(liveBias ? [`当日トラックバイアス補正 ${liveBiasAdjustment >= 0 ? "+" : ""}${liveBiasAdjustment}`] : []),
    ],
  };
};

export {
  buildPaceAnalysis,
  buildRacePaceScenario,
  classifyRunningStyle,
  scoreLap,
  scorePace,
  trackBiasAdjustment,
};
