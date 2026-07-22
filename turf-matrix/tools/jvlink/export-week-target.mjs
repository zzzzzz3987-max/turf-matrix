import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const summaryPath = path.join(repoRoot, "tools", "jvlink", "output", "week-race-summary.json");
const targetHorsesPath = path.join(repoRoot, "tools", "jvlink", "output", "target-horses.json");
const configPath = process.env.TURF_MATRIX_RACE_CONFIG || path.join(repoRoot, "tools", "race-batch-config.json");
const targetDir = path.join(repoRoot, "data", "target");
const logPath = path.join(targetDir, "jvfetch-log.txt");

const COURSE_NAMES = {
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
};

const GRADE_NAMES = {
  A: "G1",
  B: "G2",
  C: "G3",
  D: "重賞",
  E: "特別",
  F: "J-G1",
  G: "J-G2",
  H: "J-G3",
  L: "L",
};

const COURSE_SLUGS = {
  "01": "sapporo",
  "02": "hakodate",
  "03": "fukushima",
  "04": "niigata",
  "05": "tokyo",
  "06": "nakayama",
  "07": "chukyo",
  "08": "kyoto",
  "09": "hanshin",
  "10": "kokura",
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
}

function log(level, message) {
  fs.mkdirSync(targetDir, { recursive: true });
  fs.appendFileSync(logPath, `[${new Date().toISOString()}] [${level}] ${message}\n`, "utf8");
}

function csv(value) {
  const text = value == null ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function surfaceFromTrackCode(code) {
  const value = String(code || "").trim();
  if (/^(1[0-9]|2[0-2])$/.test(value)) return "芝";
  if (/^2[3-9]$/.test(value)) return "ダ";
  if (/^5[1-9]$/.test(value)) return "障";
  return "";
}

function postTime(raw) {
  const value = String(raw || "").trim();
  if (!/^\d{4}$/.test(value) || value === "0000") return "";
  return `${value.slice(0, 2)}:${value.slice(2, 4)}`;
}

function sexAge(runner) {
  const sex = { 1: "牡", 2: "牝", 3: "セ" }[String(runner.sexCode || "").trim()] || "";
  return `${sex}${runner.age || ""}`;
}

function affiliation(code) {
  return { 1: "美浦", 2: "栗東", 3: "地方", 4: "海外" }[String(code || "").trim()] || "";
}

function runningStyle(code) {
  return { 1: "逃", 2: "先", 3: "差", 4: "追" }[String(code || "").trim()] || "";
}

function sexName(code) {
  return { 1: "牡", 2: "牝", 3: "セ" }[String(code || "").trim()] || "";
}

function bundleIdFor(race) {
  const courseSlug = COURSE_SLUGS[String(race.courseCode || "").padStart(2, "0")];
  if (!courseSlug || !race.raceDate || !race.raceNo) return null;
  return `${race.raceDate}-${courseSlug}-${String(race.raceNo).padStart(2, "0")}R`;
}

function compactRaceDate(raceDate) {
  const match = String(raceDate || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[1].slice(2)}${match[2]}${match[3]}` : "";
}

function currentRaceDetailRow(race, runner) {
  const raceDate = compactRaceDate(race.raceDate);
  const grade = { A: "G1", B: "G2", C: "G3" }[race.gradeCode] || "";
  const raceName = race.raceNameShort10 || race.raceName || "";
  const fields = Array(34).fill("");
  fields[0] = raceDate;
  fields[1] = COURSE_NAMES[race.courseCode] || "";
  fields[2] = race.raceNo || "";
  fields[3] = runner.horseNumber || "";
  fields[4] = `${raceName}${grade}`;
  fields[5] = surfaceFromTrackCode(race.trackCode);
  fields[6] = race.distance || "";
  fields[7] = runner.horseName || "";
  fields[8] = sexName(runner.sexCode);
  fields[9] = runner.age || "";
  fields[10] = runner.jockeyNameShort || "";
  fields[11] = runner.carriedWeight ?? "";
  fields[12] = runner.trainerNameShort || "";
  fields[13] = affiliation(runner.affiliationCode);
  fields[14] = runner.ownerName || "";
  fields[18] = runner.bloodRegistrationNumber || "";
  fields[32] = `${raceDate}${String(race.raceNo || "").padStart(2, "0")}${String(runner.horseNumber || "").padStart(2, "0")}`;
  fields[33] = postTime(race.postTime);
  return fields.map(csv).join(",");
}

function targetKeys(config) {
  const keys = new Set();
  for (const bundle of config.bundles || []) {
    const match = String(bundle).match(/^(\d{4}-\d{2}-\d{2})-([a-z]+)-(\d{1,2})R$/);
    if (!match) continue;
    const courseCode = {
      sapporo: "01",
      hakodate: "02",
      fukushima: "03",
      niigata: "04",
      tokyo: "05",
      nakayama: "06",
      chukyo: "07",
      kyoto: "08",
      hanshin: "09",
      kokura: "10",
    }[match[2]];
    if (!courseCode) continue;
    keys.add(`${match[1]}|${courseCode}|${Number(match[3])}`);
  }
  return keys;
}

function safeWrite(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const nextPath = path.join(
    path.dirname(filePath),
    `${path.basename(filePath, path.extname(filePath))}.next-${timestamp()}${path.extname(filePath)}`,
  );
  fs.writeFileSync(nextPath, `\uFEFF${content}`, "utf8");

  if (fs.existsSync(filePath)) {
    const backupDir = path.join(path.dirname(filePath), "_backup", timestamp());
    fs.mkdirSync(backupDir, { recursive: true });
    fs.copyFileSync(filePath, path.join(backupDir, path.basename(filePath)));
  }

  try {
    fs.copyFileSync(nextPath, filePath);
    return filePath;
  } catch (error) {
    console.error(`WARN ${path.basename(filePath)} could not be replaced: ${error.message}`);
    console.error(`WARN generated file was kept at: ${nextPath}`);
    return nextPath;
  }
}

function timestamp() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

const summary = readJson(summaryPath);
const config = readJson(configPath);
const keys = targetKeys(config);

const races = (summary.races || []).filter((race) =>
  keys.has(`${race.raceDate}|${race.courseCode}|${Number(race.raceNo)}`),
);

const runnerSource = [];
for (const value of Object.values(summary.runnersByRace || {})) {
  if (Array.isArray(value)) runnerSource.push(...value);
}

const raceByKey = new Map(races.map((race) => [race.raceKey, race]));
const runners = runnerSource.filter((runner) => raceByKey.has(runner.raceKey));
const runnerCountByRace = new Map();
for (const runner of runners) {
  runnerCountByRace.set(runner.raceKey, (runnerCountByRace.get(runner.raceKey) || 0) + 1);
}

if (races.length === 0 || runners.length === 0) {
  log("ERROR", "RA/SE export returned no configured races or runners; target files were not changed.");
  console.error("JV-Link returned no configured races or runners. Existing target files were not changed.");
  process.exit(2);
}

const targetHorses = sortedUniqueHorses(runners, raceByKey);
fs.writeFileSync(
  targetHorsesPath,
  `${JSON.stringify({ schemaVersion: 1, raceDate: config.raceDate, horses: targetHorses }, null, 2)}\n`,
  "utf8",
);

const sortedRaces = [...races].sort((a, b) =>
  String(a.postTime || "").localeCompare(String(b.postTime || "")) ||
  String(a.courseCode || "").localeCompare(String(b.courseCode || "")) ||
  Number(a.raceNo || 0) - Number(b.raceNo || 0),
);

const sortedRunners = [...runners].sort((a, b) =>
  String(a.raceKey || "").localeCompare(String(b.raceKey || "")) ||
  Number(a.horseNumber || 0) - Number(b.horseNumber || 0),
);

const configuredBundleIds = new Set(config.bundles || []);
const currentRaceDetailFiles = [];
for (const race of sortedRaces) {
  const bundleId = bundleIdFor(race);
  if (!bundleId || !configuredBundleIds.has(bundleId)) continue;
  const raceRunners = sortedRunners.filter((runner) => runner.raceKey === race.raceKey);
  if (!raceRunners.length) continue;
  const content = `${raceRunners.map((runner) => currentRaceDetailRow(race, runner)).join("\n")}\n`;
  const outputPath = safeWrite(
    path.join(targetDir, "races", bundleId, "current-race-detail.csv"),
    content,
  );
  currentRaceDetailFiles.push({ bundleId, path: outputPath, runnerCount: raceRunners.length });
}

const shutubaLines = [
  "日付,場所,R,レース名,クラス,芝ダ,距離,発走,頭数,枠番,馬番,馬名,性齢,騎手,調教師,所属,斤量,人気,単勝オッズ,馬主,馬体重,脚質",
];

for (const runner of sortedRunners) {
  const race = raceByKey.get(runner.raceKey) || {};
  const runnerCount = runnerCountByRace.get(runner.raceKey) || "";
  shutubaLines.push(
    [
      runner.raceKey ? race.raceDate : "",
      COURSE_NAMES[race.courseCode] || "",
      race.raceNo || "",
      race.raceNameShort10 || race.raceName || "",
      GRADE_NAMES[race.gradeCode] || "",
      surfaceFromTrackCode(race.trackCode),
      race.distance || "",
      postTime(race.postTime),
      runnerCount,
      runner.bracketNumber || "",
      runner.horseNumber || "",
      runner.horseName || "",
      sexAge(runner),
      runner.jockeyNameShort || "",
      runner.trainerNameShort || "",
      affiliation(runner.affiliationCode),
      runner.carriedWeight || "",
      runner.popularity || "",
      runner.winOdds || "",
      runner.ownerName || "",
      runner.bodyWeight || "",
      runningStyle(runner.runningStyleCode),
    ].map(csv).join(","),
  );
}

const weekConfig = {
  schemaVersion: 1,
  mode: "jvlink-week-config-draft",
  productionWeekDataUpdated: false,
  raceDate: config.raceDate,
  generatedAt: new Date().toISOString().slice(0, 19),
  races: sortedRaces.map((race) => ({
    track: COURSE_NAMES[race.courseCode] || "",
    raceNo: race.raceNo,
    raceName: race.raceNameShort10 || race.raceName || "",
    grade: GRADE_NAMES[race.gradeCode] || "",
    surface: surfaceFromTrackCode(race.trackCode),
    distance: race.distance || null,
    postTime: postTime(race.postTime),
    runners: runnerCountByRace.get(race.raceKey) || null,
    going: "",
    weather: "",
    source: "JV-Link RACE RA/SE",
  })),
};

const racesWithoutRunners = sortedRaces
  .filter((race) => !runnerCountByRace.get(race.raceKey))
  .map((race) => `${COURSE_NAMES[race.courseCode] || race.courseCode}${race.raceNo}R`);
const invalidRunners = sortedRunners.filter(
  (runner) => !runner.horseNumber || !String(runner.horseName || "").trim(),
);
const ready =
  races.length === keys.size &&
  currentRaceDetailFiles.length === keys.size &&
  racesWithoutRunners.length === 0 &&
  invalidRunners.length === 0;

const shutubaPath = safeWrite(path.join(targetDir, "shutuba.csv"), `${shutubaLines.join("\n")}\n`);
const weekConfigPath = safeWrite(
  path.join(targetDir, "week-config.draft.json"),
  `${JSON.stringify(weekConfig, null, 2)}\n`,
);

const result = {
  status: ready ? "ready" : "partial",
  source: summaryPath,
  targetRaceCount: keys.size,
  raceCount: races.length,
  runnerCount: runners.length,
  targetHorseCount: targetHorses.length,
  targetHorses: targetHorsesPath,
  currentRaceDetailFiles,
  racesWithoutRunners,
  invalidRunnerCount: invalidRunners.length,
  shutuba: shutubaPath,
  weekConfigDraft: weekConfigPath,
};

log(
  ready ? "INFO" : "WARN",
  `RA/SE export status=${result.status} races=${races.length}/${keys.size} runners=${runners.length} invalidRunners=${invalidRunners.length}`,
);
console.log(JSON.stringify(result, null, 2));
if (!ready) process.exitCode = 1;

function sortedUniqueHorses(records, racesByKey) {
  const horses = new Map();
  for (const runner of records) {
    const registrationNumber = String(runner.bloodRegistrationNumber ?? "").trim();
    const horseName = String(runner.horseName ?? "").trim();
    if (!registrationNumber || !horseName) continue;
    const race = racesByKey.get(runner.raceKey) ?? {};
    const existing = horses.get(registrationNumber) ?? {
      bloodRegistrationNumber: registrationNumber,
      horseName,
      entries: [],
    };
    existing.entries.push({
      raceKey: runner.raceKey,
      courseCode: race.courseCode ?? null,
      raceNo: race.raceNo ?? null,
      horseNumber: runner.horseNumber ?? null,
    });
    horses.set(registrationNumber, existing);
  }
  return [...horses.values()].sort((a, b) =>
    a.bloodRegistrationNumber.localeCompare(b.bloodRegistrationNumber),
  );
}
