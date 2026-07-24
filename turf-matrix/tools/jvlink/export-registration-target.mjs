import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const registrations = JSON.parse(fs.readFileSync(path.join(repoRoot, "tools", "jvlink", "output", "week-registrations.json"), "utf8"));
const raceSummary = JSON.parse(fs.readFileSync(path.join(repoRoot, "tools", "jvlink", "output", "week-race-summary.json"), "utf8"));
const targetDir = path.join(repoRoot, "data", "target", "races");

const courseNames = { "01": "札幌", "02": "函館", "03": "福島", "04": "新潟", "05": "東京", "06": "中山", "07": "中京", "08": "京都", "09": "阪神", "10": "小倉" };
const courseSlugs = { "01": "sapporo", "02": "hakodate", "03": "fukushima", "04": "niigata", "05": "tokyo", "06": "nakayama", "07": "chukyo", "08": "kyoto", "09": "hanshin", "10": "kokura" };
const sexNames = { "1": "牡", "2": "牝", "3": "セ" };
const stableNames = { "1": "美浦", "2": "栗東", "3": "地方", "4": "海外" };
const gradeSuffix = { A: "G1", B: "G2", C: "G3", F: "J-G1", G: "J-G2", H: "J-G3" };
const surface = (code) => /^(1[0-9]|2[0-2])$/.test(String(code)) ? "芝" : /^2[3-9]$/.test(String(code)) ? "ダ" : "";
const csv = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
const postTime = (value) => /^\d{4}$/.test(String(value ?? "")) ? `${String(value).slice(0, 2)}:${String(value).slice(2)}` : "";

const raByCourseRace = new Map(
  raceSummary.races
    .filter((race) => race.raceDate === registrations.raceDate)
    .map((race) => [`${race.courseCode}|${Number(race.raceNo)}`, race]),
);

const outputs = [];
for (const race of registrations.races) {
  const ra = raByCourseRace.get(`${race.courseCode}|${Number(race.raceNo)}`);
  if (!ra) throw new Error(`RA record missing for ${race.courseCode}/${race.raceNo}R`);
  const bundleId = `${race.raceDate}-${courseSlugs[race.courseCode]}-${String(race.raceNo).padStart(2, "0")}R`;
  const lines = race.runners.map((horse) => {
    const fields = Array(34).fill("");
    const birthYear = Number(String(horse.bloodRegistrationNumber).slice(0, 4));
    fields[0] = race.raceDate.slice(2).replaceAll("-", "");
    fields[1] = courseNames[race.courseCode];
    fields[2] = race.raceNo;
    fields[4] = `${race.raceNameShort10 || race.raceName}${gradeSuffix[race.gradeCode] ?? ""}`;
    fields[5] = surface(race.trackCode);
    fields[6] = race.distance;
    fields[7] = horse.horseName;
    fields[8] = sexNames[horse.sexCode] ?? "";
    fields[9] = Number.isFinite(birthYear) ? Number(race.raceDate.slice(0, 4)) - birthYear : "";
    fields[11] = horse.carriedWeight ?? "";
    fields[12] = horse.trainerNameShort ?? "";
    fields[13] = stableNames[horse.affiliationCode] ?? "";
    fields[18] = horse.bloodRegistrationNumber;
    fields[33] = postTime(ra.postTime);
    return fields.map(csv).join(",");
  });
  const outputPath = path.join(targetDir, bundleId, "current-race-detail.csv");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `\uFEFF${lines.join("\n")}\n`, "utf8");
  outputs.push({ bundleId, runners: race.runners.length, path: outputPath });
}

console.log(JSON.stringify({ mode: "preodds-registration-target", productionWeekDataUpdated: false, outputs }, null, 2));
