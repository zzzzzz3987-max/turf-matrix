import { courseGroup } from "./dictionaries/course-bias-dictionary.mjs";

const clamp = (value, min = 35, max = 96) => Math.max(min, Math.min(max, Math.round(value)));

const avg = (values, fallback = 60) => {
  const nums = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  return nums.length ? nums.reduce((sum, value) => sum + value, 0) / nums.length : fallback;
};

const finishQuality = (run) => {
  const field = run.fieldSize || 16;
  const finish = run.finishPosition || field;
  const finishScore = ((field - finish + 1) / field) * 100;
  const marginScore = run.margin == null ? 60 : 74 - run.margin * 18;
  return clamp(finishScore * 0.55 + marginScore * 0.45, 35, 96);
};

const distanceFit = (runDistance, targetDistance) => {
  if (!runDistance || !targetDistance) return 58;
  const gap = Math.abs(runDistance - targetDistance);
  if (gap <= 100) return 92;
  if (gap <= 200) return 84;
  if (gap <= 400) return 70;
  if (gap <= 600) return 58;
  return 46;
};

const scoreDistance = (horse) => {
  const target = horse.currentRace?.distance ?? 2000;
  const surface = horse.currentRace?.surface;
  const runs = horse.pastRuns ?? [];
  const relevant = runs
    .filter((run) => !surface || run.surface === surface)
    .slice(0, 12)
    .map((run) => distanceFit(run.distance, target) * 0.65 + finishQuality(run) * 0.35);
  return clamp(avg(relevant, 58));
};

const scoreCourse = (horse) => {
  const runs = horse.pastRuns ?? [];
  const currentCourse = horse.currentRace?.course;
  const currentSurface = horse.currentRace?.surface;
  const currentType = courseGroup(currentCourse);
  const sameCourse = runs.filter((run) => run.course === currentCourse);
  const sameSurface = runs.filter((run) => run.surface === currentSurface);
  const sameType = runs.filter((run) => courseGroup(run.course) === currentType);

  const sameCourseScore = sameCourse.length ? avg(sameCourse.map(finishQuality), 62) + Math.min(8, sameCourse.length * 2) : 52;
  const surfaceScore = sameSurface.length ? avg(sameSurface.map(finishQuality), 58) + Math.min(8, sameSurface.length) : 50;
  const typeScore = sameType.length ? avg(sameType.map(finishQuality), 58) + Math.min(6, sameType.length) : 54;

  return clamp(sameCourseScore * 0.42 + surfaceScore * 0.28 + typeScore * 0.3);
};

const buildCourseAnalysis = (horse, context, scores = {}) => {
  const runs = horse.pastRuns ?? [];
  const currentCourse = horse.currentRace?.course;
  const currentDistance = horse.currentRace?.distance;
  const sameCourse = runs.filter((run) => run.course === currentCourse);
  const nearDistance = runs.filter((run) => distanceFit(run.distance, currentDistance) >= 84);
  const sameSurface = runs.filter((run) => run.surface === horse.currentRace?.surface);
  const bestCourse = [...sameCourse].sort((a, b) => finishQuality(b) - finishQuality(a))[0] ?? null;
  const bestDistance = [...nearDistance].sort((a, b) => finishQuality(b) - finishQuality(a))[0] ?? null;

  const courseScore = scores.course ?? scoreCourse(horse);
  const distanceScore = scores.distance ?? scoreDistance(horse);
  const grade = courseScore >= 82 || distanceScore >= 84 ? "A" : courseScore >= 70 || distanceScore >= 72 ? "B" : "C";

  return {
    score: courseScore,
    distanceScore,
    grade,
    status: runs.length ? "active" : "missing",
    summary: `${context?.profile ? `${context.profile}: ` : ""}${context?.summary ?? "今回条件"} 過去走からコース形態、距離、馬場カテゴリの噛み合いを評価。`,
    strengths: [
      sameCourse.length ? `${currentCourse}実績 ${sameCourse.length}走` : `${currentCourse ?? "今回コース"}の直接実績は限定的`,
      nearDistance.length ? `${currentDistance}m前後の経験 ${nearDistance.length}走` : "今回距離に近い経験は限定的",
      sameSurface.length ? `同馬場カテゴリ ${sameSurface.length}走` : "同馬場カテゴリの実績は限定的",
    ],
    evidence: [
      bestCourse ? `同コース材料: ${bestCourse.raceName ?? "過去走"} ${bestCourse.finishPosition ?? "-"}着` : "同コース材料は未取得",
      bestDistance ? `距離材料: ${bestDistance.raceName ?? "過去走"} ${bestDistance.distance ?? "-"}m` : "距離材料は未取得",
    ],
  };
};

export { scoreDistance, scoreCourse, buildCourseAnalysis };
