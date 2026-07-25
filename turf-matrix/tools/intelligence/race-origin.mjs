const JRA_COURSES = new Set([
  "札幌",
  "函館",
  "福島",
  "新潟",
  "東京",
  "中山",
  "中京",
  "京都",
  "阪神",
  "小倉",
]);

const LOCAL_CLASS_PATTERN =
  /(?:^|[\s　])(?:[ＡＢＣA-C][１２３1-3]?|Ｃ[１２３1-3](?:[-－][０-９0-9]+)?)(?:$|[\s　])/u;

const isLocalRun = (run = {}) => {
  if (run.isLocal === true || run.jurisdiction === "local") return true;

  const course = String(run.course ?? "").trim();
  if (course && !JRA_COURSES.has(course)) return true;

  const raceName = String(run.raceName ?? "");
  return !course && LOCAL_CLASS_PATTERN.test(` ${raceName} `);
};

const splitRunsByOrigin = (runs = []) => ({
  central: runs.filter((run) => !isLocalRun(run)),
  local: runs.filter(isLocalRun),
});

export { isLocalRun, splitRunsByOrigin };
