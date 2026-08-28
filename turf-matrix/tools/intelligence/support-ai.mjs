// Support AI v1 deterministic auxiliary scoring.

const clamp = (value, min = 35, max = 96) => Math.max(min, Math.min(max, Math.round(value)));

const normalizeKey = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, "").trim();

const parseRaceDate = (value) => {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length !== 8) return null;
  const year = Number(digits.slice(0, 4));
  const month = Number(digits.slice(4, 6));
  const day = Number(digits.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  return Number.isNaN(date.getTime()) ? null : date;
};

const daysBetween = (later, earlier) => {
  const laterDate = parseRaceDate(later);
  const earlierDate = parseRaceDate(earlier);
  if (!laterDate || !earlierDate) return null;
  return Math.round((laterDate.getTime() - earlierDate.getTime()) / 86400000);
};

const recentRuns = (horse) => [...(horse.pastRuns ?? [])]
  .filter((run) => parseRaceDate(run.date ?? run.raceDate))
  .sort((left, right) => parseRaceDate(right.date ?? right.raceDate) - parseRaceDate(left.date ?? left.raceDate));

const rotationAnalysis = (horse) => {
  const runs = recentRuns(horse);
  const latest = runs[0];
  const previous = runs[1];
  const intervalDays = daysBetween(horse.currentRace?.raceDate, latest?.date ?? latest?.raceDate);
  const previousIntervalDays = daysBetween(latest?.date ?? latest?.raceDate, previous?.date ?? previous?.raceDate);

  if (!Number.isFinite(intervalDays) || intervalDays < 0) {
    return { label: "出走間隔は評価対象外", adjustment: 0, intervalDays: null, previousIntervalDays };
  }
  if (Number.isFinite(previousIntervalDays) && previousIntervalDays >= 56 && intervalDays >= 8 && intervalDays <= 42) {
    return { label: `前走から${intervalDays}日・休養明け2戦目`, adjustment: 2, intervalDays, previousIntervalDays };
  }
  if (intervalDays <= 7) return { label: `前走から${intervalDays}日・連闘`, adjustment: -3, intervalDays, previousIntervalDays };
  if (intervalDays <= 20) return { label: `前走から${intervalDays}日・中${Math.max(1, Math.floor(intervalDays / 7))}週`, adjustment: 1, intervalDays, previousIntervalDays };
  if (intervalDays <= 42) return { label: `前走から${intervalDays}日・中${Math.max(2, Math.floor(intervalDays / 7))}週`, adjustment: 2, intervalDays, previousIntervalDays };
  if (intervalDays <= 90) return { label: `前走から${intervalDays}日・休み明け`, adjustment: 0, intervalDays, previousIntervalDays };
  return { label: `前走から${intervalDays}日・長期休養明け`, adjustment: -2, intervalDays, previousIntervalDays };
};

const jockeyAnalysis = (horse) => {
  const current = horse.currentRace?.jockey ?? horse.jockey;
  const runs = recentRuns(horse);
  const previous = runs[0]?.jockey;
  const recentRideCount = current
    ? runs.slice(0, 3).filter((run) => normalizeKey(run.jockey) === normalizeKey(current)).length
    : 0;

  if (!current) return { label: "騎手起用は評価対象外", adjustment: 0, current: null, previous: previous ?? null, recentRideCount: 0 };
  if (previous && normalizeKey(previous) === normalizeKey(current)) {
    const frequency = recentRideCount >= 2 ? `（近3走中${recentRideCount}走）` : "";
    return { label: `${current}騎手が前走から継続${frequency}`, adjustment: 2, current, previous, recentRideCount };
  }
  if (previous) return { label: `${previous}騎手から${current}騎手へ乗り替わり`, adjustment: 0, current, previous, recentRideCount };
  return { label: `${current}騎手を起用`, adjustment: 0, current, previous: null, recentRideCount };
};

const HOKKAIDO_COURSES = new Set(["札幌", "函館"]);
const EAST_COURSES = new Set(["福島", "新潟", "東京", "中山"]);
const WEST_COURSES = new Set(["中京", "京都", "阪神", "小倉"]);

const travelAnalysis = (horse) => {
  const side = horse.currentRace?.stableSide ?? horse.stableSide;
  const course = horse.currentRace?.course;
  if (!side || !course) return { label: "所属・開催場の組み合わせは評価対象外", adjustment: 0, isAway: false };
  const eastStable = String(side).includes("美");
  const westStable = String(side).includes("栗");
  const crossRegion = HOKKAIDO_COURSES.has(course)
    || (eastStable && WEST_COURSES.has(course))
    || (westStable && EAST_COURSES.has(course));
  return {
    label: `${side}所属・${course}開催${crossRegion ? "（遠征条件）" : ""}`,
    adjustment: crossRegion ? -1 : 0,
    isAway: crossRegion,
  };
};

const stablePatternAnalysis = (trainingAnalysis) => {
  const pattern = trainingAnalysis?.stablePattern;
  if (!pattern || pattern.status === "DB未登録") {
    return { label: null, adjustment: 0, degree: null, status: pattern?.status ?? "not_available" };
  }
  const degree = Number(pattern.degree);
  return {
    label: pattern.text ?? `厩舎調教パターン合致度${Math.round((degree || 0) * 100)}%`,
    adjustment: Number.isFinite(degree) && degree >= 0.6 ? Math.min(2, Math.round(degree * 2)) : 0,
    degree: Number.isFinite(degree) ? degree : null,
    status: pattern.status,
  };
};

const buildStableAnalysis = (horse, trainingAnalysis = {}) => {
  const trainer = horse.currentRace?.trainer ?? horse.trainer;
  const side = horse.currentRace?.stableSide ?? horse.stableSide;
  const rotation = rotationAnalysis(horse);
  const jockey = jockeyAnalysis(horse);
  const travel = travelAnalysis(horse);
  const stablePattern = stablePatternAnalysis(trainingAnalysis);
  const score = trainer
    ? clamp(70 + rotation.adjustment + jockey.adjustment + travel.adjustment + stablePattern.adjustment, 55, 84)
    : 58;
  const phaseRepresentatives = trainingAnalysis?.phaseRepresentatives ?? {};
  const preparation = phaseRepresentatives.final && phaseRepresentatives.oneWeek
    ? "最終・一週前追い切りを取得済み"
    : phaseRepresentatives.final
      ? "最終追い切りを取得済み"
      : phaseRepresentatives.oneWeek
        ? "一週前追い切りを取得済み"
        : null;
  const evidence = [
    trainer ? `${trainer}厩舎（${side || "所属取得済み"}）` : null,
    rotation.intervalDays == null ? null : rotation.label,
    jockey.current ? jockey.label : null,
    travel.label,
    stablePattern.label,
    preparation,
  ].filter(Boolean);
  const confidence = trainer && jockey.current && rotation.intervalDays != null ? "high" : trainer || jockey.current ? "mid" : "low";
  const stablePatternSummary = stablePattern.label?.replace(/[。．]+$/u, "") ?? null;
  const summaryParts = [
    trainer ? `${trainer}厩舎${side ? `（${side}）` : ""}` : "厩舎情報",
    rotation.intervalDays == null ? null : rotation.label,
    jockey.current ? jockey.label : null,
    travel.isAway ? travel.label : null,
    stablePatternSummary,
  ].filter(Boolean);

  return {
    score,
    status: trainer ? "active" : "missing",
    confidence,
    summary: `${summaryParts.join("。")}。ローテーションと騎手起用を陣営運用として評価。`,
    evidence,
    components: {
      baseline: trainer ? 70 : 58,
      rotation: rotation.adjustment,
      jockey: jockey.adjustment,
      travel: travel.adjustment,
      stablePattern: stablePattern.adjustment,
    },
    rotation,
    jockey,
    travel,
    stablePattern,
  };
};

const scoreStable = (horse, trainingAnalysis) => buildStableAnalysis(horse, trainingAnalysis).score;

const frameScore = (number) => {
  if (number <= 4) return 68;
  if (number <= 10) return 64;
  if (number <= 14) return 60;
  return 58;
};

export { scoreStable, buildStableAnalysis, frameScore };
