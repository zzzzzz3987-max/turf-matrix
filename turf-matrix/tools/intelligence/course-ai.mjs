import { COURSE_GROUPS, courseGroup } from "./dictionaries/course-bias-dictionary.mjs";
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

const knownCourses = new Set(Object.values(COURSE_GROUPS).flat());
const normalizeCourseSurface = (value) => {
  const text = String(value ?? "").normalize("NFKC").trim();
  return text === "芝" ? "芝" : ["ダ", "ダート"].includes(text) ? "ダ" : null;
};

const buildCourseSurfaceEvidence = (horse) => {
  const runs = horse.pastRuns ?? [];
  const course = String(horse.currentRace?.course ?? "").trim();
  const surface = normalizeCourseSurface(horse.currentRace?.surface);
  const type = knownCourses.has(course) ? courseGroup(course) : null;
  const sameSurface = surface ? runs.filter((run) => normalizeCourseSurface(run.surface) === surface) : [];
  return {
    surface,
    sameSurface,
    sameCourse: course ? sameSurface.filter((run) => run.course === course) : [],
    sameType: type ? sameSurface.filter((run) => knownCourses.has(run.course) && courseGroup(run.course) === type) : [],
    excludedSurfaceCount: runs.length - sameSurface.length,
  };
};

const scoreLegacyCourse = (horse, { sameSurfaceOnly = false } = {}) => {
  const runs = horse.pastRuns ?? [];
  const currentCourse = horse.currentRace?.course;
  const currentSurface = horse.currentRace?.surface;
  const currentType = courseGroup(currentCourse);
  const matched = sameSurfaceOnly ? buildCourseSurfaceEvidence(horse) : null;
  const sameSurface = matched?.sameSurface ?? runs.filter((run) => run.surface === currentSurface);
  const sameCourse = matched?.sameCourse ?? runs.filter((run) => run.course === currentCourse);
  const sameType = matched?.sameType ?? runs.filter((run) => courseGroup(run.course) === currentType);
  const components = courseComponents(sameCourse, sameSurface, sameType);
  return clamp(components.sameCourse.score * components.sameCourse.weight
    + components.sameSurface.score * components.sameSurface.weight
    + components.courseType.score * components.courseType.weight);
};

const courseComponents = (sameCourse, sameSurface, sameType) => ({
  sameCourse: {
    score: sameCourse.length ? avg(sameCourse.map(finishQuality), 62) + Math.min(8, sameCourse.length * 2) : 52,
    weight: 0.42,
    count: sameCourse.length,
  },
  sameSurface: {
    score: sameSurface.length ? avg(sameSurface.map(finishQuality), 58) + Math.min(8, sameSurface.length) : 50,
    weight: 0.28,
    count: sameSurface.length,
  },
  courseType: {
    score: sameType.length ? avg(sameType.map(finishQuality), 58) + Math.min(6, sameType.length) : 54,
    weight: 0.3,
    count: sameType.length,
  },
});

export const COURSE_PERFORMANCE_POLICY = "venue-surface-near-distance-v1";

const performanceSurface = (value, code) => /^5[1-9]$/.test(String(code ?? "")) || ["障", "障害"].includes(value)
  ? "障" : normalizeCourseSurface(value);

const buildCoursePerformanceProfile = (horse) => {
  const target = horse.currentRace ?? {};
  const surface = performanceSurface(target.surface);
  const distance = Number(target.distance);
  const targetDate = Date.parse(target.raceDate ?? "");
  const seen = new Set();
  const entries = [];
  for (const run of horse.pastRuns ?? []) {
    if (!target.course || !knownCourses.has(target.course) || !surface || !Number.isFinite(distance) || distance <= 0) continue;
    if (run.course !== target.course || performanceSurface(run.surface, run.surfaceCode) !== surface) continue;
    const actualDistance = Number(run.distance);
    const gap = Math.abs(actualDistance - distance);
    if (!Number.isFinite(actualDistance) || actualDistance <= 0 || gap > 200 || gap / distance > 0.2) continue;
    const finish = Number(run.confirmedFinishPosition ?? run.finishPosition);
    if (!Number.isInteger(finish) || finish < 1) continue;
    const runDate = Date.parse(run.date ?? "");
    if (run.date && (!Number.isFinite(runDate) || (Number.isFinite(targetDate) && runDate >= targetDate))) continue;
    const key = Number.isFinite(runDate) ? `${run.date}/${run.course}/${run.raceNumber ?? ""}` : null;
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    const normalizedRun = { ...run, finishPosition: finish };
    entries.push({ run: normalizedRun, weight: gap <= 100 ? 1 : 0.75, score: finishQuality(normalizedRun) });
  }
  const priorScore = 65;
  const priorWeight = 2;
  const totalWeight = entries.reduce((sum, entry) => sum + entry.weight, 0);
  const score = totalWeight
    ? clamp((priorScore * priorWeight + entries.reduce((sum, entry) => sum + entry.score * entry.weight, 0)) / (priorWeight + totalWeight))
    : priorScore;
  const surfaceLabel = surface === "ダ" ? "ダート" : surface === "障" ? "障害" : surface ?? "路面不明";
  const label = `${target.course ?? "今回会場"}${surfaceLabel}${Number.isFinite(distance) && distance > 0 ? `${distance}m前後` : ""}`;
  const topThreeCount = entries.filter((entry) => entry.run.finishPosition <= 3).length;
  return {
    policy: COURSE_PERFORMANCE_POLICY,
    status: entries.length ? "active" : "missing",
    score,
    sampleCount: entries.length,
    topThreeCount,
    priorScore,
    priorWeight,
    totalWeight,
    label,
    distanceTolerance: 200,
    runs: entries,
    summary: entries.length
      ? `${label}で${entries.length}走し、3着以内${topThreeCount}回。${entries.length === 1 ? "1走だけでは得意・不得意を判断しづらいため、評価は控えめです。" : ""}`
      : `${label}での実績データが不足しています。苦手という意味ではありません。`,
  };
};

const scoreCourse = (horse) => buildCoursePerformanceProfile(horse).score;

const buildCourseAnalysis = (horse, context, scores = {}) => {
  const runs = horse.pastRuns ?? [];
  const currentCourse = horse.currentRace?.course;
  const currentDistance = horse.currentRace?.distance;
  const distanceProfile = buildDistanceProfile(horse);
  const performanceProfile = buildCoursePerformanceProfile(horse);
  const sameCourse = performanceProfile.runs.map((entry) => entry.run);
  const nearDistance = runs.filter((run) =>
    (!horse.currentRace?.surface || run.surface === horse.currentRace.surface) &&
    distanceFit(run.distance, currentDistance) >= 84
  );
  const sameSurface = runs.filter((run) => run.surface === horse.currentRace?.surface);
  const currentType = courseGroup(currentCourse);
  const sameType = runs.filter((run) => courseGroup(run.course) === currentType);
  const components = { sameCourse: { score: performanceProfile.score, weight: 1, count: sameCourse.length } };
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
  const grade = courseScore >= 82 ? "A" : courseScore >= 70 ? "B" : "C";
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
    performanceProfile,
    distanceScore,
    components: Object.fromEntries(Object.entries(components).map(([key, value]) => [key, {
      ...value,
      score: Math.round(value.score * 10) / 10,
    }])),
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
    status: performanceProfile.status,
    summary: performanceProfile.summary,
    geometryFit: {
      source: targetShape?.source ?? "unavailable",
      label: geometryLabel,
      matchedRunCount: geometryRuns.length,
      scoreConnected: false,
    },
    strengths: [performanceProfile.summary],
    evidence: [
      bestCourse ? `同コース材料: ${bestCourse.raceName ?? "過去走"} ${bestCourse.finishPosition ?? "-"}着` : "同コース材料は未取得",
      performanceProfile.summary,
      "他会場・別路面・離れた距離の成績はコース点に含めません。",
    ].filter(Boolean),
  };
};

export { scoreDistance, scoreCourse, scoreLegacyCourse, buildCoursePerformanceProfile, buildCourseAnalysis, describeGeometry, geometrySimilarity, normalizeCourseSurface, buildCourseSurfaceEvidence };
