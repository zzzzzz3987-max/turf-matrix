import { trainingThreshold } from "./dictionaries/training-thresholds.mjs";

const clamp = (value, min = 35, max = 96) => Math.max(min, Math.min(max, Math.round(value)));

const toSessionDateValue = (dateText) => {
  const text = String(dateText ?? "");
  const full = text.match(/(\d{4})[./-]\s*(\d{1,2})[./-]\s*(\d{1,2})/);
  if (full) return Number(full[1]) * 10000 + Number(full[2]) * 100 + Number(full[3]);
  const short = text.match(/(\d{1,2})[./-]\s*(\d{1,2})/);
  if (short) return Number(short[1]) * 100 + Number(short[2]);
  return 0;
};

const lapValues = (lap) =>
  [lap?.lap4, lap?.lap3, lap?.lap2, lap?.lap1].filter((value) => typeof value === "number" && Number.isFinite(value));

const formatSession = (session) => {
  if (!session) return "時計未取得";
  const type = session.type === "wood" ? "ウッド" : "坂路";
  const course = session.course ? `${session.course}` : type;
  return `${session.date ?? "日付未取得"} ${course} 4F${session.f4 ?? "-"}-1F${session.f1 ?? "-"}`;
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
      summary: "調教時計は未取得です。調教面は強く評価せず、近走・血統・オッズを中心に見ます。",
      finalText: "最終追切の時計が未取得です。別馬の時計を補完せず、調教評価は控えめに扱います。",
      patternText: "調教パターンは未判定です。",
      strengths: ["調教時計未取得"],
    };
  }

  const best = [...sessions].sort((a, b) => b.score - a.score)[0];
  const final = sessions[0];
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
    accelCount ? `加速ラップ ${accelCount}本` : "加速ラップは目立たない",
  ];

  return {
    score,
    lapScore,
    grade,
    status: "取得済み",
    count: sessions.length,
    best,
    final,
    lightAfterFinal: null,
    fastFinish,
    accelCount,
    activeCount,
    strengths,
    summary: `${sessions.length}本の調教時計を確認。${strengths.join(" / ")}。`,
    finalText: `${formatSession(final)}。最終追切の確認材料として${final.score >= 74 ? "動きの良さを評価できます" : final.score >= 62 ? "標準的な内容です" : "強調材料は控えめです"}。`,
    patternText: `${formatSession(best)}が最も評価できる時計です。${fastFinish ? "終いの反応も確認できます。" : "終いの反応は強調しすぎません。"}`,
  };
};

export { buildTrainingAnalysis };
