import { findPedigreeStudyProfile } from "../data/pedigree-study-profiles.js";

const surfaceOf = (value) => value === "芝" ? "芝" : ["ダ", "ダート"].includes(value) ? "ダート" : null;
const positive = (value) => typeof value === "number" && Number.isFinite(value) && value > 0;
const dayOf = (value) => {
  const match = String(value ?? "").match(/^(\d{4})-?(\d{2})-?(\d{2})$/);
  if (!match) return null;
  const [, y, m, d] = match;
  const iso = `${y}-${m}-${d}`;
  const time = Date.parse(`${iso}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === iso ? iso : null;
};

// Strictly pre-race, completed starts; duplicate rows must not inflate the evidence.
const eligibleRuns = (horse, date) => {
  const seen = new Set();
  return (horse?.pastRuns ?? []).filter((run) => {
    const day = dayOf(run?.date);
    const finish = run?.confirmedFinishPosition ?? run?.finishPosition;
    if (!day || day >= date || !Number.isInteger(finish) || finish < 1 || !positive(run.distance)) return false;
    if (positive(run.fieldSize) && finish > run.fieldSize) return false;
    const key = `${day}:${run.course ?? ""}:${run.raceNumber ?? ""}:${run.distance}:${surfaceOf(run.surface)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => dayOf(b.date).localeCompare(dayOf(a.date)));
};

const finishOf = (run) => run.confirmedFinishPosition ?? run.finishPosition;
const recordText = (runs) => `${runs.length}走、3着以内${runs.filter((run) => finishOf(run) <= 3).length}回`;
const exampleText = (run) => `${dayOf(run.date)} ${run.course ?? ""}${surfaceOf(run.surface)}${run.distance}m ${finishOf(run)}着`;

export const buildPedigreeRaceEvidence = (horse, pedigree = horse?.analysis?.pedigree) => {
  if (!pedigree) return null;
  const identity = pedigree.identity ?? {};
  const reading = [["父", identity.sire], ["母父", identity.broodmareSire]].flatMap(([role, name]) => {
    const profile = findPedigreeStudyProfile(name);
    if (!profile) return [];
    return [{
      role, name, text: profile.tendency,
      question: role === "母父"
        ? "これは種牡馬としての特徴です。母父に入った場合も同じ効果があるとは限らず、父との組み合わせと本馬の実績を優先します。"
        : profile.question ?? "血統からの見立てと、以下の距離・コース実績が噛み合うかを確認します。",
    }];
  });
  const race = horse?.currentRace ?? {};
  const date = dayOf(race.raceDate);
  const surface = surfaceOf(race.surface);
  const distance = race.distance;
  const unavailable = { reading, evidence: [], conclusion: "今回の距離・芝ダート・開催日が揃っていないため、過去走との比較は保留。", caution: "血統の特徴だけで、この馬の適性を断定しません。" };
  if (!date || !surface || !positive(distance)) return unavailable;

  const runs = eligibleRuns(horse, date).filter((run) => surfaceOf(run.surface) === surface);
  const exact = runs.filter((run) => run.distance === distance);
  const near = runs.filter((run) => run.distance !== distance && Math.abs(run.distance - distance) <= 200);
  const course = exact.filter((run) => race.course && run.course === race.course);
  const going = race.going ?? race.trackCondition;
  const sameGoing = exact.filter((run) => going && run.trackCondition === going);
  const evidence = [
    exact.length ? { label: `同じ${surface}${distance}m`, text: `${recordText(exact)}。直近は${exampleText(exact[0])}。` } : null,
    course.length ? { label: `うち${race.course}での実績`, text: `${recordText(course)}。` } : null,
    sameGoing.length ? { label: `うち${going}馬場での実績`, text: `${recordText(sameGoing)}。` } : null,
    near.length ? { label: "近い距離の実績（別集計）", text: `距離差200m以内で${recordText(near)}。直近は${exampleText(near[0])}。同距離の実績には含めません。` } : null,
  ].filter(Boolean);
  const hits = exact.filter((run) => finishOf(run) <= 3).length;
  const conclusion = !exact.length
    ? `${surface}${distance}mの完走実績は手元の過去走にありません。血統からの期待と、実績で確かめられた適性は分けて考えます。`
    : hits
      ? `${surface}${distance}mでの3着以内が${hits}回あり、今回距離をこなした実績はあります。ただし、血統が好走の理由だったとまでは言えません。`
      : `${surface}${distance}mは${exact.length}走して3着以内なし。血統の期待だけで強く推せず、相手関係や展開も確認したい条件です。`;
  const caution = [
    exact.length === 1 ? "同距離の実績は1走だけで、得意・不得意の判断は慎重に。" : null,
    !course.length && race.course ? `${race.course}の同距離では、コース適性の裏付けがまだありません。` : null,
    "ここでの比較は距離・馬場の実績確認です。走法や瞬発力・持続力の裏付けには、ラップや映像による別の確認が必要です。",
  ].filter(Boolean).join("");
  return { reading, evidence, conclusion, caution };
};
