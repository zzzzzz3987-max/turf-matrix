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

const isValidLast3F = (run) => typeof run.last3F === "number" && run.last3F > 0 && run.last3F < 45;

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

const sampleConfidence = (runCount) => {
  if (runCount >= 6) return 1;
  if (runCount >= 4) return 0.94;
  if (runCount === 3) return 0.88;
  if (runCount === 2) return 0.8;
  if (runCount === 1) return 0.68;
  return 0.6;
};

const applySampleDiscount = (score, runCount) => {
  const confidence = sampleConfidence(runCount);
  return clamp(score * confidence + 58 * (1 - confidence), 35, 92);
};

const classPerformanceScore = (run) => {
  const grade = classBonus(run);
  if (grade < 5) return null;

  const field = run.fieldSize || 16;
  const finish = run.finishPosition || field;
  const finishBase = finishScore({ ...run, fieldSize: field, finishPosition: finish });
  const marginBase = run.margin == null ? 64 : clamp(82 - run.margin * 18, 54, 92);
  const gradeBase = grade >= 10 ? 84 : grade >= 7 ? 80 : 74;
  const podiumBonus = finish <= 3 ? 5 : finish <= 5 ? 2 : 0;

  return clamp(finishBase * 0.35 + marginBase * 0.3 + gradeBase * 0.35 + podiumBonus, 55, 94);
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
    (isValidLast3F(run) ? clamp(90 - (run.last3F - 33.5) * 7, 45, 92) : 60) * 0.15 +
    60 * 0.15;
  return (base + classBonus(run) + popularityGapScore(run) + distanceFitBonus(run, targetDistance)) * recentWeight;
};

const scoreZi = (horse) => {
  const zi = horse.odds?.zi ?? horse.availableIndex ?? horse.currentRace?.zi;
  const recentForm = scoreRecentForm(horse);
  const classScores = (horse.pastRuns ?? []).slice(0, 8).map(classPerformanceScore).filter((score) => score != null);
  const classScore = classScores.length ? avg(classScores, 60) : null;
  const peerScore = scorePeerEvidence(horse.peerRuns ?? []);
  const relationScore = peerScore != null && classScore != null ? Math.max(peerScore, classScore) : (peerScore ?? classScore);

  if (typeof zi === "number" && Number.isFinite(zi)) {
    const ziScore = clamp(42 + (zi - 80) * 1.3);
    const classPart = relationScore ?? recentForm;
    return applySampleDiscount(clamp(ziScore * 0.42 + recentForm * 0.25 + classPart * 0.33), horse.pastRuns?.length ?? 0);
  }

  return applySampleDiscount(clamp(recentForm * 0.65 + (relationScore ?? recentForm) * 0.35), horse.pastRuns?.length ?? 0);
};

const scoreRecentForm = (horse) => {
  const runs = (horse.pastRuns ?? []).slice(0, 5);
  if (!runs.length) return 50;
  return clamp(avg(runs.map((run, index) => runScore(run, index, horse.currentRace?.distance))));
};

const scoreDistanceEvidence = (runs, targetDistance) => {
  if (!targetDistance || !runs.length) return null;
  return clamp(avg(runs.map((run) => 66 + distanceFitBonus(run, targetDistance) * 5), 60), 45, 92);
};

const scoreMarginEvidence = (runs) => {
  const scored = runs.filter((run) => typeof run.margin === "number");
  return scored.length ? clamp(avg(scored.map(marginScore), 60), 45, 92) : null;
};

const scoreLapEvidence = (runs) => {
  const scored = runs.filter(isValidLast3F);
  return scored.length ? clamp(avg(scored.map((run) => clamp(90 - (run.last3F - 33.5) * 7, 45, 92)), 60), 45, 92) : null;
};

const scorePeerEvidence = (peerRuns = []) => {
  if (!peerRuns.length) return null;
  const scores = peerRuns.map((run) => {
    const peers = run.peers ?? [];
    const behindCount = peers.filter((peer) =>
      Number.isFinite(run.finishPosition) &&
      Number.isFinite(peer.finishPosition) &&
      run.finishPosition < peer.finishPosition
    ).length;
    const aheadCount = peers.filter((peer) =>
      Number.isFinite(run.finishPosition) &&
      Number.isFinite(peer.finishPosition) &&
      run.finishPosition > peer.finishPosition
    ).length;
    const closeBehind = peers.filter((peer) =>
      Number.isFinite(run.finishPosition) &&
      Number.isFinite(peer.finishPosition) &&
      run.finishPosition < peer.finishPosition &&
      Number.isFinite(peer.margin) &&
      Number.isFinite(run.margin) &&
      peer.margin - run.margin <= 0.5
    ).length;
    return 62 + behindCount * 8 + closeBehind * 3 - aheadCount * 5;
  });
  return clamp(avg(scores, 60), 45, 92);
};

const buildAbilityAnalysis = (horse, score = scoreZi(horse)) => {
  const runs = (horse.pastRuns ?? []).slice(0, 8);
  const recent = runs.slice(0, 5);
  const zi = horse.odds?.zi ?? horse.availableIndex ?? horse.currentRace?.zi;
  const ziScore = typeof zi === "number" && Number.isFinite(zi) ? clamp(42 + (zi - 80) * 1.3) : null;
  const classScores = runs.map(classPerformanceScore).filter((item) => item != null);
  const classScore = classScores.length ? clamp(avg(classScores, 60)) : null;
  const recentScore = recent.length ? scoreRecentForm({ ...horse, pastRuns: recent }) : null;
  const marginEvidence = scoreMarginEvidence(recent);
  const distanceEvidence = scoreDistanceEvidence(recent, horse.currentRace?.distance);
  const lapEvidence = scoreLapEvidence(recent);
  const peerEvidence = scorePeerEvidence(horse.peerRuns ?? []);
  const gradedCount = runs.filter((run) => classBonus(run) >= 5).length;
  const closeRuns = recent.filter((run) => typeof run.margin === "number" && run.margin <= 0.5).length;
  const distanceRuns = recent.filter((run) => distanceFitBonus(run, horse.currentRace?.distance) >= 4).length;
  const fastLap = runs.filter(isValidLast3F).sort((a, b) => a.last3F - b.last3F)[0] ?? null;
  const peerRun = (horse.peerRuns ?? [])[0] ?? null;
  const peerNames = peerRun?.peers?.slice(0, 2).map((peer) => peer.horseName).join("・") ?? null;

  const components = [
    {
      key: "zi",
      label: "ZI",
      score: ziScore,
      status: ziScore == null ? "missing" : "active",
      summary: ziScore == null ? "ZI未取得" : `能力指標ZI ${zi}を基礎評価に使用`,
    },
    {
      key: "class",
      label: "相手関係",
      score: classScore,
      status: classScore == null ? "missing" : "active",
      summary: gradedCount ? `重賞/上級条件の実績 ${gradedCount}走を評価` : "上級条件の比較材料は限定的",
    },
    {
      key: "peer",
      label: "同走馬",
      score: peerEvidence,
      status: peerEvidence == null ? "missing" : "active",
      summary: peerEvidence == null
        ? "今週出走馬との直接対戦は未検出"
        : `${peerRun.raceName ?? "過去走"}で${peerNames}と直接対戦`,
    },
    {
      key: "margin",
      label: "着差",
      score: marginEvidence,
      status: marginEvidence == null ? "missing" : "active",
      summary: closeRuns ? `直近で0.5秒差以内 ${closeRuns}走` : "着差面の強調材料は控えめ",
    },
    {
      key: "distance",
      label: "距離一致",
      score: distanceEvidence,
      status: distanceEvidence == null ? "missing" : "active",
      summary: distanceRuns ? `今回距離に近い実績 ${distanceRuns}走` : "今回距離への直接材料は限定的",
    },
    {
      key: "lap",
      label: "上がり性能",
      score: lapEvidence,
      status: lapEvidence == null ? "missing" : "active",
      summary: fastLap ? `最速材料 ${fastLap.raceName ?? "過去走"} ${fastLap.last3F}` : "上がり時計は未取得",
    },
    {
      key: "recent",
      label: "近走推移",
      score: recentScore,
      status: recentScore == null ? "missing" : "active",
      summary: recent.length ? `直近${recent.length}走を能力補正に使用` : "近走データ未取得",
    },
  ];

  return {
    key: "ability",
    label: "能力",
    score,
    maxScore: 100,
    status: runs.length ? "active" : "missing",
    summary: runs.length
      ? "ZI、相手関係、同走馬、着差、距離一致、上がり性能、近走推移を分解して能力評価に反映。"
      : "近走データが未取得のため、能力評価は控えめに扱います。",
    evidence: components.map((component) => component.summary),
    components,
  };
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

export { scoreZi, scoreRecentForm, buildFormAnalysis, buildAbilityAnalysis };
