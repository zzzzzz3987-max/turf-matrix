// Course AI v1 deterministic distance/course fit scoring.

const clamp = (value, min = 35, max = 96) => Math.max(min, Math.min(max, Math.round(value)));
const avg = (values, fallback = 60) => {
  const nums = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  return nums.length ? nums.reduce((sum, value) => sum + value, 0) / nums.length : fallback;
};

const scoreDistance = (horse) => {
  const target = horse.currentRace?.distance ?? 2000;
  const runs = horse.pastRuns ?? [];
  const relevant = runs
    .filter((run) => run.surface === horse.currentRace?.surface)
    .map((run) => Math.max(0, 100 - Math.abs((run.distance ?? target) - target) / 8));
  return clamp(avg(relevant.slice(0, 12), 58));
};

const scoreCourse = (horse) => {
  const runs = horse.pastRuns ?? [];
  const sameCourse = runs.filter((run) => run.course === horse.currentRace?.course);
  const sameSurface = runs.filter((run) => run.surface === horse.currentRace?.surface);
  const sameCourseScore = sameCourse.length ? 62 + Math.min(18, sameCourse.length * 3) : 52;
  const surfaceScore = sameSurface.length ? 58 + Math.min(18, sameSurface.length) : 50;
  return clamp(sameCourseScore * 0.55 + surfaceScore * 0.45);
};

export { scoreDistance, scoreCourse };
