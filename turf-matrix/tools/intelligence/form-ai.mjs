// Form AI v1 deterministic ability and recent-form scoring.

const clamp = (value, min = 35, max = 96) => Math.max(min, Math.min(max, Math.round(value)));
const avg = (values, fallback = 60) => {
  const nums = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  return nums.length ? nums.reduce((sum, value) => sum + value, 0) / nums.length : fallback;
};

const scoreZi = (horse) => clamp(42 + ((horse.odds?.zi ?? 95) - 80) * 1.3);

const scoreRecentForm = (horse) => {
  const runs = (horse.pastRuns ?? []).slice(0, 5);
  if (!runs.length) return 50;
  return clamp(
    avg(
      runs.map((run, index) => {
        const field = run.fieldSize || 16;
        const finish = run.finishPosition || field;
        const finishScore = ((field - finish + 1) / field) * 100;
        const marginScore = run.margin == null ? 60 : 72 - run.margin * 18;
        const recentWeight = 1 - index * 0.08;
        return (finishScore * 0.55 + marginScore * 0.45) * recentWeight;
      })
    )
  );
};

export { scoreZi, scoreRecentForm };
