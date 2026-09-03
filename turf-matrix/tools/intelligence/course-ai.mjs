import { courseGroup } from "./dictionaries/course-bias-dictionary.mjs";
import { resolveCourseGeometry } from "./course-geometry.mjs";
import { buildDistanceProfile, distanceFit, finishQuality } from "./distance-ai.mjs";

const clamp = (value, min = 35, max = 96) => Math.max(min, Math.min(max, Math.round(value)));

const avg = (values, fallback = 60) => {
  const nums = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  return nums.length ? nums.reduce((sum, value) => sum + value, 0) / nums.length : fallback;
};

const geometrySimilarity = (target, actual) => {
  if (!target || !actual) return 0;
  const keys = ["turn", "layout", "straight", "hill"];
  const available = keys.filter((key) => target[key] && actual[key]);
  if (!available.length) return 0;
  return available.filter((key) => target[key] === actual[key]).length / available.length;
};

const describeGeometry = (shape) => {
  if (!shape) return "コース形態未取得";
  const labels = {
    straight: "直線コース", left: "左回り", right: "右回り",
    small: "小回り", inner: "内回り", outer: "外回り", wide: "広いコース", dirt: "ダートコース",
    very_short: "非常に短い直線", short: "短い直線", medium: "標準的な直線", long: "長い直線", very_long: "非常に長い直線", full_course: "全区間直線",
    flat: "平坦", mostly_flat: "ほぼ平坦", mild: "緩い坂", steep: "急坂", third_corner: "3角の起伏",
  };
  return [shape.turn, shape.layout, shape.straight, shape.hill]
    .map((value) => labels[value])
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index)
    .join("・") || "コース形態取得済み";
};

const scoreDistance = (horse) => buildDistanceProfile(horse).score;

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
  const distanceProfile = buildDistanceProfile(horse);
  const sameCourse = runs.filter((run) => run.course === currentCourse);
  const nearDistance = runs.filter((run) =>
    (!horse.currentRace?.surface || run.surface === horse.currentRace.surface) &&
    distanceFit(run.distance, currentDistance) >= 84
  );
  const sameSurface = runs.filter((run) => run.surface === horse.currentRace?.surface);
  const surfaceLabel = String(horse.currentRace?.surface ?? context?.surface ?? "").startsWith("ダ") ? "ダート" : "芝";
  const bestCourse = [...sameCourse].sort((a, b) => finishQuality(b) - finishQuality(a))[0] ?? null;
  const bestDistance = [...nearDistance].sort((a, b) => finishQuality(b) - finishQuality(a))[0] ?? null;
  const targetShape = context?.courseShape ?? resolveCourseGeometry({
    course: currentCourse,
    surface: horse.currentRace?.surface,
    distance: currentDistance,
  });
  const geometryRuns = runs
    .filter((run) => !horse.currentRace?.surface || run.surface === horse.currentRace.surface)
    .map((run) => ({
      run,
      shape: resolveCourseGeometry({ course: run.course, surface: run.surface, distance: run.distance }),
    }))
    .map((entry) => ({ ...entry, similarity: geometrySimilarity(targetShape, entry.shape) }))
    .filter((entry) => entry.similarity >= 0.75)
    .sort((left, right) => finishQuality(right.run) - finishQuality(left.run));
  const bestGeometry = geometryRuns[0]?.run ?? null;
  const geometryLabel = describeGeometry(targetShape);

  const courseScore = scores.course ?? scoreCourse(horse);
  const distanceScore = scores.distance ?? distanceProfile.score;
  const grade = courseScore >= 82 || distanceScore >= 84 ? "A" : courseScore >= 70 || distanceScore >= 72 ? "B" : "C";
  const direction = distanceProfile.direction;
  const cadence = distanceProfile.cadence;
  const directionSummary = direction.key === "extension" || direction.key === "shortening"
    ? `前走${direction.latestDistance}mから${Math.abs(direction.change)}m${direction.key === "extension" ? "延長" : "短縮"}。終盤の位置変化と近い距離での走りから対応力を評価。`
    : direction.key === "same" ? `前走と同じ${currentDistance}m。` : "距離変更の判断材料は限定的。";
  const cadenceSummary = cadence.sampleCount
    ? `${cadence.label}での近い条件を${cadence.sampleCount}走確認。`
    : `${cadence.label}での直接実績は限定的。`;
  const transition = direction.transition;
  const transitionSummary = transition?.sampleCount
    ? `同方向の距離変更を過去${transition.sampleCount}回確認。`
    : "同方向の距離変更実績は限定的。";

  return {
    score: courseScore,
    distanceScore,
    distanceSummary: `${currentDistance ?? "今回"}mは${cadence.label}。${directionSummary}${cadenceSummary}`,
    distanceComponents: {
      proximity: { label: "距離の近さと実績", score: distanceProfile.baseScore },
      direction: {
        label: direction.label,
        score: direction.score,
        adjustment: direction.adjustment,
        sampleCount: direction.sampleCount,
      },
      transition: {
        label: "個体別の距離変更反応",
        score: transition?.score ?? null,
        adjustment: transition?.adjustment ?? 0,
        sampleCount: transition?.sampleCount ?? 0,
      },
      cadence: {
        label: cadence.label,
        score: cadence.score,
        adjustment: cadence.adjustment,
        sampleCount: cadence.sampleCount,
      },
    },
    grade,
    status: runs.length ? "active" : "missing",
    summary: `${context?.profile ? `${context.profile}: ` : ""}${context?.summary ?? "今回条件"} ${geometryLabel}として、過去走のコース形態・距離・同じ${surfaceLabel}条件との噛み合いを評価。`,
    geometryFit: {
      source: targetShape?.source ?? "unavailable",
      label: geometryLabel,
      matchedRunCount: geometryRuns.length,
      scoreConnected: false,
    },
    strengths: [
      sameCourse.length ? `${currentCourse}実績 ${sameCourse.length}走` : `${currentCourse ?? "今回コース"}の直接実績は限定的`,
      nearDistance.length ? `${currentDistance}m前後の経験 ${nearDistance.length}走` : "今回距離に近い経験は限定的",
      direction.key === "extension" || direction.key === "shortening" ? direction.label : directionSummary,
      direction.key === "extension" || direction.key === "shortening" ? transitionSummary : null,
      cadence.sampleCount ? `${cadence.assessment}（${cadence.sampleCount}走）` : `${cadence.label}の直接実績は限定的`,
      sameSurface.length ? `同じ${surfaceLabel}条件 ${sameSurface.length}走` : `同じ${surfaceLabel}条件の実績は限定的`,
      geometryRuns.length ? `近いコース形態の経験 ${geometryRuns.length}走` : "近いコース形態の実績は限定的",
    ].filter(Boolean),
    evidence: [
      bestCourse ? `同コース材料: ${bestCourse.raceName ?? "過去走"} ${bestCourse.finishPosition ?? "-"}着` : "同コース材料は未取得",
      bestDistance ? `距離材料: ${bestDistance.raceName ?? "過去走"} ${bestDistance.distance ?? "-"}m` : "距離材料は未取得",
      direction.key === "extension" || direction.key === "shortening" ? direction.label : directionSummary,
      direction.key === "extension" || direction.key === "shortening" ? transitionSummary : null,
      cadence.sampleCount ? cadence.assessment : `${cadence.label}の材料は限定的`,
      bestGeometry ? `形態材料: ${bestGeometry.raceName ?? bestGeometry.course ?? "過去走"} ${bestGeometry.finishPosition ?? "-"}着` : "近似コース形態の材料は未取得",
      "コース形態Evidenceは表示のみでCourse点へ未接続",
    ].filter(Boolean),
  };
};

export { scoreDistance, scoreCourse, buildCourseAnalysis, describeGeometry, geometrySimilarity };
