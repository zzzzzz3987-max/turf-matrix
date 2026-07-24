const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const normalizeGoing = (value) => {
  const text = String(value ?? "").normalize("NFKC").replace(/\s+/g, "");
  if (!text) return null;
  if (text.includes("不良")) return "heavy";
  if (text.includes("稍重") || text === "稍") return "yielding";
  if (text.includes("重")) return "heavy";
  if (text.includes("良")) return "good";
  return null;
};

const normalizeSurface = (value) => {
  const text = String(value ?? "").normalize("NFKC").replace(/\s+/g, "");
  if (text.startsWith("芝")) return "芝";
  if (text.startsWith("ダ")) return "ダ";
  return text || null;
};

const classBonus = (run) => {
  const text = `${run?.grade ?? ""} ${run?.raceName ?? ""}`;
  if (/G1|GI(?!I)|GⅠ|Ｇ１/i.test(text)) return 10;
  if (/G2|GII(?!I)|GⅡ|Ｇ２/i.test(text)) return 7;
  if (/G3|GIII|GⅢ|Ｇ３/i.test(text)) return 5;
  if (/\(L\)|リステッド|\bL\b|OP|オープン/i.test(text)) return 3;
  return 0;
};

const performanceScore = (run) => {
  const margin = Number(run?.margin);
  const finish = Number(run?.finishPosition);
  const fieldSize = Number(run?.fieldSize);
  if (!Number.isFinite(margin) || !Number.isFinite(finish) || !Number.isFinite(fieldSize) || fieldSize <= 0) {
    return null;
  }
  const marginScore = clamp(72 - margin * 18 + classBonus(run), 35, 96);
  const finishScore = clamp(((fieldSize - finish + 1) / fieldSize) * 100, 0, 100);
  return marginScore * 0.82 + finishScore * 0.18;
};

const average = (values) => {
  const valid = values.filter(Number.isFinite);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
};

const averageMargin = (runs) => average(runs.map((run) => Number(run.margin)));

const shrinkFactorFor = (runCount) => {
  if (runCount <= 0) return 0;
  if (runCount === 1) return 0.25;
  if (runCount === 2) return 0.45;
  if (runCount === 3) return 0.65;
  if (runCount <= 5) return 0.8;
  return 1;
};

const statusFor = (runCount) => {
  if (runCount <= 0) return "unexperienced";
  if (runCount === 1) return "reference";
  if (runCount === 2) return "partial";
  return "active";
};

const goingLabel = (going) => {
  if (going === "heavy") return "重・不良";
  if (going === "yielding") return "稍重";
  if (going === "good") return "良";
  return "未取得";
};

const buildGoingAdjustment = (horse, context = {}) => {
  const going = normalizeGoing(context.going ?? horse?.currentRace?.going ?? horse?.currentRace?.trackCondition);
  const surface = normalizeSurface(context.surface ?? horse?.currentRace?.surface);
  const base = {
    key: "goingAdjustment",
    label: "馬場適性補正",
    going: goingLabel(going),
    surface,
    adjustment: 0,
    relevantRunCount: 0,
    goodRunCount: 0,
    rawDifference: null,
    shrinkFactor: 0,
    evidence: [],
  };

  if (!going) {
    return { ...base, status: "missing", summary: "公式馬場状態が未取得のため補正しません。" };
  }
  if (going === "good") {
    return { ...base, status: "not_applicable", summary: "良馬場のため馬場適性補正は適用しません。" };
  }
  if (going === "yielding") {
    return { ...base, status: "not_applicable", summary: "稍重はv1の補正対象外です。" };
  }
  if (!surface) {
    return { ...base, status: "missing", summary: "芝・ダート区分が未取得のため補正しません。" };
  }

  const sameSurfaceRuns = (horse?.pastRuns ?? [])
    .filter((run) => normalizeSurface(run.surface) === surface)
    .filter((run) => Number.isFinite(performanceScore(run)));
  const relevantRuns = sameSurfaceRuns.filter((run) => normalizeGoing(run.trackCondition ?? run.going) === "heavy").slice(0, 8);
  const goodRuns = sameSurfaceRuns.filter((run) => normalizeGoing(run.trackCondition ?? run.going) === "good").slice(0, 8);
  const relevantRunCount = relevantRuns.length;
  const goodRunCount = goodRuns.length;
  const shrinkFactor = shrinkFactorFor(relevantRunCount);

  if (!relevantRunCount) {
    return {
      ...base,
      status: "unexperienced",
      relevantRunCount,
      goodRunCount,
      summary: `${surface}の重・不良は未経験のため補正しません。`,
      evidence: [`${surface}重・不良 0走`, `良馬場 ${goodRunCount}走`],
    };
  }
  if (!goodRunCount) {
    return {
      ...base,
      status: "missing",
      relevantRunCount,
      goodRunCount,
      shrinkFactor,
      summary: `${surface}の良馬場比較がないため補正しません。`,
      evidence: [`${surface}重・不良 ${relevantRunCount}走`, "良馬場比較 0走"],
    };
  }

  const relevantScore = average(relevantRuns.map(performanceScore));
  const goodScore = average(goodRuns.map(performanceScore));
  const rawDifference = relevantScore - goodScore;
  const rawAdjustment = clamp(rawDifference / 8, -3, 3);
  const adjustment = Math.round(clamp(rawAdjustment * shrinkFactor, -2, 2));
  const relevantMargin = averageMargin(relevantRuns);
  const goodMargin = averageMargin(goodRuns);
  const direction = adjustment > 0 ? "プラス" : adjustment < 0 ? "マイナス" : "中立";

  return {
    ...base,
    status: statusFor(relevantRunCount),
    adjustment,
    relevantRunCount,
    goodRunCount,
    rawDifference: Math.round(rawDifference * 10) / 10,
    shrinkFactor,
    summary: `${surface}重・不良${relevantRunCount}走と良馬場${goodRunCount}走を同馬内で比較し、${direction}補正${adjustment >= 0 ? "+" : ""}${adjustment}。`,
    evidence: [
      `${surface}重・不良 ${relevantRunCount}走・平均着差 ${relevantMargin.toFixed(2)}秒`,
      `良馬場 ${goodRunCount}走・平均着差 ${goodMargin.toFixed(2)}秒`,
      `サンプル収縮係数 ${shrinkFactor.toFixed(2)}`,
    ],
  };
};

export { buildGoingAdjustment, normalizeGoing, normalizeSurface, shrinkFactorFor };
