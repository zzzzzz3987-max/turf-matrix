import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const summaryPath = path.join(repoRoot, "tools", "jvlink", "output", "intelligence-summary.json");
const manifestPath = path.join(repoRoot, "tools", "jvlink", "output", "target-horses.json");
const configPath = path.join(repoRoot, "tools", "race-batch-config.json");
const targetDir = path.join(repoRoot, "data", "target");
const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8").replace(/^\uFEFF/, ""));
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8").replace(/^\uFEFF/, ""));
const config = JSON.parse(fs.readFileSync(configPath, "utf8").replace(/^\uFEFF/, ""));

const csv = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
const row = (values) => values.map(csv).join(",");
const seconds = (value) => Number.isFinite(value) ? value.toFixed(1) : "";
const timestamp = () => {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
};

const safeWrite = (fileName, lines) => {
  const outputPath = path.join(targetDir, fileName);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const nextPath = path.join(path.dirname(outputPath), `${path.basename(fileName, path.extname(fileName))}.next-${timestamp()}${path.extname(fileName)}`);
  fs.writeFileSync(nextPath, `\uFEFF${lines.join("\n")}\n`, "utf8");
  if (fs.existsSync(outputPath)) {
    const backupPath = path.join(targetDir, "_backup", timestamp(), fileName);
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    fs.copyFileSync(outputPath, backupPath);
  }
  try {
    fs.copyFileSync(nextPath, outputPath);
    return outputPath;
  } catch (error) {
    console.error(`WARN ${fileName} could not be replaced: ${error.message}`);
    console.error(`WARN generated file was kept at: ${nextPath}`);
    return nextPath;
  }
};

const COURSE_NAMES = {
  "01": "札幌", "02": "函館", "03": "福島", "04": "新潟", "05": "東京",
  "06": "中山", "07": "中京", "08": "京都", "09": "阪神", "10": "小倉",
};
const COURSE_CODES = {
  sapporo: "01", hakodate: "02", fukushima: "03", niigata: "04", tokyo: "05",
  nakayama: "06", chukyo: "07", kyoto: "08", hanshin: "09", kokura: "10",
};
const GRADE_NAMES = { A: "G1", B: "G2", C: "G3", D: "重賞", E: "特別", F: "J-G1", G: "J-G2", H: "J-G3", L: "L" };
const TRACK_CONDITIONS = { "1": "良", "2": "稍重", "3": "重", "4": "不良" };
const SEX_NAMES = { "1": "牡", "2": "牝", "3": "セ" };
const RUNNING_STYLES = { "1": "逃", "2": "先", "3": "差", "4": "追" };
const raceGradeSuffix = (code) => ({ A: "G1", B: "G2", C: "G3", F: "J-G1", G: "J-G2", H: "J-G3" })[code] ?? "";

const surfaceFromTrackCode = (code) => {
  const value = String(code ?? "").trim();
  if (/^(1[0-9]|2[0-2])$/.test(value)) return "芝";
  if (/^2[3-9]$/.test(value)) return "ダ";
  if (/^5[1-9]$/.test(value)) return "障";
  return "";
};

const formatRaceTime = (secondsValue) => {
  if (!Number.isFinite(secondsValue)) return "";
  const minutes = Math.floor(secondsValue / 60);
  return `${minutes}:${(secondsValue - minutes * 60).toFixed(1).padStart(4, "0")}`;
};

const allCsvRow = (pastRun, race, pedigree) => {
  const values = Array(66).fill("");
  const [year = "", month = "", day = ""] = String(race.raceDate ?? "").split("-");
  const surface = surfaceFromTrackCode(race.trackCode);
  const trackConditionCode = surface === "芝" ? race.turfConditionCode : race.dirtConditionCode;
  values[0] = year;
  values[1] = month;
  values[2] = day;
  values[4] = COURSE_NAMES[race.courseCode] ?? "";
  values[6] = race.raceNo ?? "";
  values[7] = `${race.raceNameShort10 || race.raceName || ""}${raceGradeSuffix(race.gradeCode)}`;
  values[9] = surface;
  values[11] = race.distance ?? "";
  values[12] = TRACK_CONDITIONS[trackConditionCode] ?? "";
  values[13] = pastRun.horseName;
  values[14] = SEX_NAMES[pastRun.sexCode] ?? "";
  values[15] = pastRun.age ?? "";
  values[16] = pastRun.jockeyName ?? "";
  values[17] = pastRun.carriedWeight ?? "";
  values[18] = race.fieldSize ?? "";
  values[19] = pastRun.popularity ?? "";
  values[20] = pastRun.finishPosition ?? "";
  values[21] = pastRun.finishPosition ?? "";
  values[22] = race.trackCode ?? "";
  values[23] = pastRun.margin ?? "";
  values[24] = pastRun.horseNumber ?? "";
  values[25] = pastRun.timeSeconds ?? "";
  values[26] = formatRaceTime(pastRun.timeSeconds);
  (pastRun.passingOrder ?? []).slice(0, 4).forEach((position, index) => { values[28 + index] = position ?? ""; });
  values[32] = pastRun.last3F ?? "";
  values[33] = pastRun.bodyWeight ?? "";
  values[34] = pastRun.trainerName ?? "";
  values[41] = pastRun.ownerName ?? "";
  values[43] = pedigree?.ancestors?.[0]?.name ?? "";
  values[44] = pedigree?.ancestors?.[1]?.name ?? "";
  values[45] = pedigree?.ancestors?.[4]?.name ?? "";
  values[53] = RUNNING_STYLES[pastRun.runningStyleCode] ?? "";
  values[65] = pastRun.bodyWeightDiff ?? "";
  return row(values);
};

if (!Array.isArray(summary.pedigrees) || summary.pedigrees.length !== summary.targetHorseCount) {
  throw new Error(`Pedigree coverage mismatch: ${summary.pedigrees?.length ?? 0}/${summary.targetHorseCount}`);
}

const pedigreeLines = [
  row(["馬名", "父", "母", "母父", "母の母", "父父", "父母", "血統登録番号", "取得元"]),
  ...summary.pedigrees.map((pedigree) => row([
    pedigree.horseName,
    pedigree.ancestors?.[0]?.name,
    pedigree.ancestors?.[1]?.name,
    pedigree.ancestors?.[4]?.name,
    pedigree.ancestors?.[5]?.name,
    pedigree.ancestors?.[2]?.name,
    pedigree.ancestors?.[3]?.name,
    pedigree.bloodRegistrationNumber,
    "JV-Link RCVN/UM",
  ])),
];

const slopeLines = [
  row(["場所", "調教日", "時刻", "血統登録番号", "馬名", "", "", "", "", "調教師", "4F", "3F", "2F", "1F", "Lap4", "Lap3", "Lap2", "Lap1"]),
  ...summary.slope.map((training) => row([
    training.centerCode === "0" ? "美浦" : training.centerCode === "1" ? "栗東" : "",
    training.date,
    training.time,
    training.bloodRegistrationNumber,
    training.horseName,
    "", "", "", "", "",
    seconds(training.fourF), seconds(training.threeF), seconds(training.twoF), seconds(training.oneF),
    seconds(training.lap4), seconds(training.lap3), seconds(training.lap2), seconds(training.lap1),
  ])),
];

const courseName = (code) => ({ "0": "A", "1": "B", "2": "C", "3": "D", "4": "E" })[String(code ?? "")] ?? "";
const directionName = (code) => ({ "0": "右", "1": "左" })[String(code ?? "")] ?? "";
const woodLines = [
  row(["場所", "コース", "回り", "調教日", "時刻", "血統登録番号", "馬名", "", "", "", "", "調教師", "10F", "9F", "8F", "7F", "6F", "5F", "4F", "3F", "2F", "1F", "Lap6", "Lap5", "Lap4", "Lap3", "Lap2", "Lap1"]),
  ...summary.wood.map((training) => row([
    training.centerCode === "0" ? "美浦" : training.centerCode === "1" ? "栗東" : "",
    courseName(training.courseCode),
    directionName(training.directionCode),
    training.date,
    training.time,
    training.bloodRegistrationNumber,
    training.horseName,
    "", "", "", "", "",
    ...[10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((furlong) => seconds(training.times?.[`${furlong}F`])),
    ...[6, 5, 4, 3, 2, 1].map((furlong) => seconds(training.laps?.[`lap${furlong}`])),
  ])),
];

const combinedTraining = [
  row(["馬名", "血統登録番号", "調教日", "調教種別", "調教コース", "回り", "累計", "取得元"]),
  ...summary.slope.map((training) => row([
    training.horseName,
    training.bloodRegistrationNumber,
    training.date,
    "坂路",
    training.centerCode === "0" ? "美浦" : training.centerCode === "1" ? "栗東" : "",
    "",
    [training.fourF, training.threeF, training.twoF, training.oneF].map(seconds).filter(Boolean).join("-"),
    "JV-Link SLOP/HC",
  ])),
  ...summary.wood.map((training) => row([
    training.horseName,
    training.bloodRegistrationNumber,
    training.date,
    "ウッド",
    courseName(training.courseCode),
    directionName(training.directionCode),
    [10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((furlong) => seconds(training.times?.[`${furlong}F`])).filter(Boolean).join("-"),
    "JV-Link WOOD/WC",
  ])),
];

const raceByKey = new Map((summary.pastRaces ?? []).map((race) => [race.raceKey, race]));
const pedigreeByRegistration = new Map(summary.pedigrees.map((record) => [record.bloodRegistrationNumber, record]));
const allCsvOutputs = [];
for (const bundleId of config.bundles) {
  const match = String(bundleId).match(/^(\d{4}-\d{2}-\d{2})-([a-z]+)-(\d{2})R$/);
  if (!match) throw new Error(`Invalid bundle id: ${bundleId}`);
  const courseCode = COURSE_CODES[match[2]];
  const raceNo = Number(match[3]);
  const targetIds = new Set(
    manifest.horses
      .filter((horse) => horse.entries?.some((entry) => entry.courseCode === courseCode && Number(entry.raceNo) === raceNo))
      .map((horse) => horse.bloodRegistrationNumber),
  );
  const records = (summary.pastRuns ?? [])
    .filter((record) => targetIds.has(record.bloodRegistrationNumber))
    .map((record) => ({ record, race: raceByKey.get(record.raceKey) }))
    .filter(({ race }) => race)
    .sort((a, b) =>
      String(a.record.bloodRegistrationNumber).localeCompare(String(b.record.bloodRegistrationNumber)) ||
      String(b.race.raceDate).localeCompare(String(a.race.raceDate)) ||
      Number(b.race.raceNo ?? 0) - Number(a.race.raceNo ?? 0),
    );
  const lines = records.map(({ record, race }) => allCsvRow(record, race, pedigreeByRegistration.get(record.bloodRegistrationNumber)));
  if (!targetIds.size || !lines.length) {
    throw new Error(`${bundleId}: direct past-run export returned no target horses or rows.`);
  }
  allCsvOutputs.push({
    bundleId,
    horseCount: targetIds.size,
    rowCount: lines.length,
    path: safeWrite(path.join("races", bundleId, "all.csv"), lines),
  });
}

const outputs = {
  pedigree: safeWrite("pedigree.csv", pedigreeLines),
  training: safeWrite("training.csv", combinedTraining),
  trainingSlope: safeWrite("training-slope.csv", slopeLines),
  trainingWood: safeWrite("training-wood.csv", woodLines),
  allCsv: allCsvOutputs,
};

console.log(JSON.stringify({
  status: "ready",
  targetHorseCount: summary.targetHorseCount,
  pedigreeCount: summary.pedigrees.length,
  slopeCount: summary.slope.length,
  woodCount: summary.wood.length,
  pastRaceCount: summary.pastRaces?.length ?? 0,
  pastRunCount: summary.pastRuns?.length ?? 0,
  outputs,
}, null, 2));
