// Training AI v1 deterministic workout scoring.
// Consumes normalized TARGET training data only.

const clamp = (value, min = 35, max = 96) => Math.max(min, Math.min(max, Math.round(value)));

const trainingThreshold = (type, stableSide) => {
  if (type === "slope") {
    return stableSide === "栗"
      ? { "4F": 52.9, "3F": 38.9, "2F": 25.9, "1F": 13.4 }
      : { "4F": 49.9, "3F": 35.9, "2F": 23.9, "1F": 12.8 };
  }
  return { "4F": 50.0, "3F": 36.8, "2F": 24.4, "1F": 12.0 };
};

const toSessionDateValue = (dateText) => {
  const match = String(dateText ?? "").match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/);
  if (!match) return 0;
  return Number(match[1]) * 10000 + Number(match[2]) * 100 + Number(match[3]);
};

const sessionDay = (dateText) => {
  const match = String(dateText ?? "").match(/\d{4}\.\s*\d{1,2}\.\s*(\d{1,2})/);
  return match ? Number(match[1]) : null;
};

const lapValues = (lap) =>
  [lap?.lap4, lap?.lap3, lap?.lap2, lap?.lap1].filter((value) => typeof value === "number" && Number.isFinite(value));

const formatSession = (session) => {
  if (!session) return "時計未取得";
  const type = session.type === "wood" ? "ウッド" : "坂路";
  const course = session.course ? `${session.course}` : type;
  return `${session.date ?? "日付不明"} ${course} 4F${session.f4 ?? "-"}-1F${session.f1 ?? "-"}`;
};

const sessionScore = (session, stableSide) => {
  const threshold = trainingThreshold(session.type, stableSide);
  const f4Gap = typeof session.f4 === "number" ? threshold["4F"] - session.f4 : -8;
  const f1Gap = typeof session.f1 === "number" ? threshold["1F"] - session.f1 : -4;
  const values = lapValues(session.lap);
  const accel = values.length >= 2 && values.at(-1) <= values.at(-2);
  const strongFinish = typeof session.f1 === "number" && session.f1 <= threshold["1F"];
  const verySharpFinish = typeof session.f1 === "number" && session.f1 <= threshold["1F"] - 0.5;
  const typeBase = session.type === "wood" ? 63 : 60;

  return clamp(
    typeBase +
      Math.max(-8, Math.min(14, f4Gap * 4.2)) +
      Math.max(-8, Math.min(18, f1Gap * 5.5)) +
      (accel ? 7 : -2) +
      (strongFinish ? 5 : 0) +
      (verySharpFinish ? 4 : 0),
    45,
    94
  );
};

const collectTrainingSessions = (horse) => {
  const slope = (horse.training?.slope ?? []).map((item) => ({
    type: "slope",
    date: item.date,
    trainer: item.trainer,
    f4: item["4F"],
    f3: item["3F"],
    f2: item["2F"],
    f1: item["1F"],
    lap: item.lap,
  }));
  const wood = (horse.training?.wood ?? []).map((item) => ({
    type: "wood",
    date: item.date,
    trainer: item.trainer,
    course: item.course,
    direction: item.direction,
    f4: item.times?.["4F"],
    f3: item.times?.["3F"],
    f2: item.times?.["2F"],
    f1: item.times?.["1F"],
    lap: item.lap,
  }));
  return [...slope, ...wood].filter((session) => typeof session.f1 === "number" || typeof session.f4 === "number");
};

const buildTrainingAnalysis = (horse) => {
  const stableSide = horse.currentRace?.stableSide ?? horse.stableSide ?? "";
  const sessions = collectTrainingSessions(horse)
    .map((session) => ({ ...session, score: sessionScore(session, stableSide), dateValue: toSessionDateValue(session.date) }))
    .sort((a, b) => b.dateValue - a.dateValue);

  if (!sessions.length) {
    return {
      score: 50,
      lapScore: 50,
      grade: "C",
      status: "未取得",
      count: 0,
      summary: "調教時計は未取得。調教面は評価に強く反映していません。",
      finalText: "最終追切の時計が取れていないため、調教評価は参考扱いです。",
      patternText: "調教時計の裏付けは未取得です。",
      strengths: ["調教時計は未取得"],
    };
  }

  const best = [...sessions].sort((a, b) => b.score - a.score)[0];
  const finalCandidates = sessions.filter((session) => session.dateValue >= 20260708 && session.dateValue <= 20260709);
  const final = finalCandidates[0] ?? sessions[0];
  const latest = sessions[0];
  const lightAfterFinal = latest?.dateValue > final?.dateValue ? latest : null;
  const fastFinish = sessions.filter((session) => {
    const threshold = trainingThreshold(session.type, stableSide);
    return typeof session.f1 === "number" && session.f1 <= threshold["1F"];
  }).length;
  const accelCount = sessions.filter((session) => {
    const values = lapValues(session.lap);
    return values.length >= 2 && values.at(-1) <= values.at(-2);
  }).length;
  const activeCount = sessions.filter((session) => session.score >= 70).length;
  const score = clamp(best.score * 0.5 + final.score * 0.3 + Math.min(10, activeCount * 2) + Math.min(8, fastFinish * 2));
  const lapScore = clamp(score + Math.min(6, accelCount * 1.5) - (accelCount ? 0 : 4));
  const grade = score >= 84 ? "A" : score >= 74 ? "B" : score >= 62 ? "C" : "D";

  const strengths = [
    best.score >= 76 ? `好時計: ${formatSession(best)}` : `基準時計: ${formatSession(best)}`,
    fastFinish ? `終い基準クリア ${fastFinish}本` : "終いの強調材料は控えめ",
    accelCount ? `加速ラップ ${accelCount}本` : "加速ラップは目立たず",
  ];

  return {
    score,
    lapScore,
    grade,
    status: "取得済み",
    count: sessions.length,
    best,
    final,
    lightAfterFinal,
    fastFinish,
    accelCount,
    activeCount,
    strengths,
    summary: `${sessions.length}本の時計から、${strengths.join(" / ")}。`,
    finalText: `${formatSession(final)}。水曜/木曜の最終追切として${final.score >= 74 ? "動きの良さを評価できます" : final.score >= 62 ? "標準的な内容です" : "強調材料は控えめです"}。${lightAfterFinal ? ` ${formatSession(lightAfterFinal)}は直前軽めとして扱います。` : ""}`,
    patternText: `${formatSession(best)}が最も評価できる時計。${fastFinish ? "終いの反応も確認できます。" : "終いの反応は強調しすぎない評価です。"}`,
  };
};

export { buildTrainingAnalysis };
