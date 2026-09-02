const COURSE_CODES = Object.freeze({
  "01": "札幌",
  "02": "函館",
  "03": "福島",
  "04": "新潟",
  "05": "東京",
  "06": "中山",
  "07": "中京",
  "08": "京都",
  "09": "阪神",
  "10": "小倉",
});

const HOKKAIDO_COURSES = new Set(["01", "02", "札幌", "函館"]);
const EAST_COURSES = new Set(["03", "04", "05", "06", "福島", "新潟", "東京", "中山"]);
const WEST_COURSES = new Set(["07", "08", "09", "10", "中京", "京都", "阪神", "小倉"]);

const normalizeKey = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, "").trim();

const isoDate = (value) => String(value ?? "").replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3");

const dateValue = (value) => {
  const normalized = isoDate(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
  const parsed = Date.parse(`${normalized}T00:00:00Z`);
  return Number.isFinite(parsed) ? parsed : null;
};

const daysBetween = (earlier, later) => {
  const first = dateValue(earlier);
  const second = dateValue(later);
  return first != null && second != null ? Math.round((second - first) / 86400000) : null;
};

const affiliationLabel = (code) => ({ "1": "美浦", "2": "栗東" })[String(code ?? "").trim()] ?? null;

const rotationBucket = (days) => !Number.isFinite(days) || days < 0
  ? null
  : days <= 7 ? "0-7"
    : days <= 20 ? "8-20"
      : days <= 42 ? "21-42"
        : days <= 90 ? "43-90" : "91+";

const normalizedCourse = (value) => {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (/^\d{1,2}$/.test(raw)) return raw.padStart(2, "0");
  return raw;
};

const travelClass = ({ affiliationCode, stableSide, courseCode, course } = {}) => {
  const venue = normalizedCourse(courseCode ?? course);
  const side = normalizeKey(stableSide ?? affiliationLabel(affiliationCode));
  if (!venue || !side) return null;
  if (HOKKAIDO_COURSES.has(venue)) return "away";
  if (side.includes("美浦")) {
    if (EAST_COURSES.has(venue)) return "home";
    if (WEST_COURSES.has(venue)) return "away";
  }
  if (side.includes("栗東")) {
    if (WEST_COURSES.has(venue)) return "home";
    if (EAST_COURSES.has(venue)) return "away";
  }
  return null;
};

const sortedPastRuns = (horse) => [...(horse?.pastRuns ?? [])]
  .filter((run) => dateValue(run.date ?? run.raceDate) != null)
  .sort((left, right) =>
    dateValue(right.date ?? right.raceDate) - dateValue(left.date ?? left.raceDate)
  );

const stableOperationSnapshot = (horse) => {
  const currentRace = horse?.currentRace ?? {};
  const raceDate = isoDate(currentRace.raceDate ?? currentRace.date);
  const currentDateValue = dateValue(raceDate);
  const latest = sortedPastRuns(horse).find((run) => {
    const runDate = dateValue(run.date ?? run.raceDate);
    return currentDateValue == null || runDate < currentDateValue;
  }) ?? null;
  const previousRaceDate = latest ? isoDate(latest.date ?? latest.raceDate) : null;
  const intervalDays = previousRaceDate ? daysBetween(previousRaceDate, raceDate) : null;
  const trainer = currentRace.trainer ?? horse?.trainer ?? null;
  const previousTrainer = latest?.trainer ?? latest?.trainerName ?? null;
  const currentJockey = currentRace.jockey ?? horse?.jockey ?? null;
  const previousJockey = latest?.jockey ?? latest?.jockeyName ?? null;
  const sameTrainer = trainer && previousTrainer
    ? normalizeKey(trainer) === normalizeKey(previousTrainer)
    : null;
  return {
    trainer,
    raceDate,
    previousRaceDate,
    previousTrainer,
    jockey: currentJockey,
    previousJockey,
    sameTrainer,
    intervalDays: Number.isFinite(intervalDays) && intervalDays >= 0 ? intervalDays : null,
    rotationBucket: sameTrainer === false ? null : rotationBucket(intervalDays),
    jockeyContinuity: currentJockey && previousJockey
      ? normalizeKey(currentJockey) === normalizeKey(previousJockey)
      : null,
    travelClass: travelClass({
      stableSide: currentRace.stableSide ?? horse?.stableSide,
      courseCode: currentRace.courseCode,
      course: currentRace.course,
    }),
  };
};

export {
  COURSE_CODES,
  affiliationLabel,
  daysBetween,
  isoDate,
  normalizeKey,
  rotationBucket,
  stableOperationSnapshot,
  travelClass,
};
