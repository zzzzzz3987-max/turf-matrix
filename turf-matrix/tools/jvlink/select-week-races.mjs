import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const outputDir = path.join(repoRoot, "tools", "jvlink", "output");
const summary = JSON.parse(fs.readFileSync(path.join(outputDir, "week-race-summary.json"), "utf8"));
const base = JSON.parse(fs.readFileSync(path.join(repoRoot, "tools", "race-batch-config.json"), "utf8"));
const args = process.argv.slice(2);
const allRaces = args.includes("--all-races");
const specials = args.includes("--specials");
const racesIndex = args.indexOf("--races");
const requested = racesIndex >= 0
  ? String(args[racesIndex + 1] || "").split(",").map((value) => value.trim()).filter(Boolean)
  : [];
const dateIndex = args.indexOf("--date");
const requestedDate = dateIndex >= 0 ? String(args[dateIndex + 1] || "").trim() : "";
const selectedModes = [allRaces, specials, requested.length > 0].filter(Boolean).length;
if (selectedModes > 1) {
  throw new Error("--all-races, --specials and --races cannot be used together.");
}

const courses = {
  "01": ["sapporo", "札幌"],
  "02": ["hakodate", "函館"],
  "03": ["fukushima", "福島"],
  "04": ["niigata", "新潟"],
  "05": ["tokyo", "東京"],
  "06": ["nakayama", "中山"],
  "07": ["chukyo", "中京"],
  "08": ["kyoto", "京都"],
  "09": ["hanshin", "阪神"],
  "10": ["kokura", "小倉"],
};
const gradedOrSpecialCodes = new Set(["A", "B", "C", "D", "E", "F", "G", "H", "L"]);
const specialNamePattern = /(特別|賞|ステークス|S|Ｓ|カップ|C|Ｃ)$/;
const isGradedOrSpecial = (race) => {
  const gradeCode = String(race.gradeCode || "").trim().toUpperCase();
  if (gradeCode) return gradedOrSpecialCodes.has(gradeCode);
  return specialNamePattern.test(String(race.raceName || "").trim());
};

const date = requestedDate || String(base.raceDate || summary.configuredRaceDate);
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  throw new Error(`Invalid race date: ${date}`);
}

const available = (summary.races || [])
  .filter((race) => race.raceDate === date)
  .sort((a, b) =>
    String(a.postTime || "").localeCompare(String(b.postTime || ""))
    || String(a.courseCode).localeCompare(String(b.courseCode))
    || Number(a.raceNo) - Number(b.raceNo))
  .map((race) => {
    const names = courses[String(race.courseCode)] || [];
    if (!names.length) throw new Error(`Unsupported course code: ${race.courseCode}`);
    const raceNo = Number(race.raceNo);
    return {
      bundle: `${date}-${names[0]}-${String(raceNo).padStart(2, "0")}R`,
      labels: [
        `${names[1]}${raceNo}`,
        `${names[1]}${raceNo}R`,
        `${names[0]}${raceNo}`,
        `${names[0]}${raceNo}R`,
      ],
      race,
    };
  });

let bundles;
if (allRaces) {
  bundles = available.map(({ bundle }) => bundle);
} else if (specials) {
  bundles = available.filter(({ race }) => isGradedOrSpecial(race)).map(({ bundle }) => bundle);
} else if (requested.length) {
  bundles = requested.map((value) => {
    const normalized = value.replace(/\s+/g, "").toLowerCase();
    const found = available.find(({ labels }) => labels.some((label) => label.toLowerCase() === normalized));
    if (!found) throw new Error(`Requested race is unavailable: ${value}`);
    return found.bundle;
  });
} else {
  bundles = base.bundles;
}

bundles = [...new Set(bundles)];
if (!bundles.length) throw new Error("No target races were selected.");
const selectedRaceKeys = new Set(
  available.filter(({ bundle }) => bundles.includes(bundle)).map(({ race }) => race.raceKey),
);
const selectedRunners = Object.values(summary.runnersByRace || {})
  .flatMap((runners) => Array.isArray(runners) ? runners : [])
  .filter((runner) => selectedRaceKeys.has(runner.raceKey));
const numberedRunnerCount = selectedRunners.filter((runner) => Number(runner.horseNumber) > 0).length;
const provisional = selectedRunners.length > 0 && numberedRunnerCount === 0;
const runtime = {
  raceDate: date,
  expectedRaceCount: bundles.length,
  bundles,
  provisional,
  allowMissingRaceName: allRaces || Boolean(base.allowMissingRaceName),
  allowMissingPastRuns: allRaces || Boolean(base.allowMissingPastRuns),
  runnerCount: selectedRunners.length,
  numberedRunnerCount,
};
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, "race-batch-runtime.json"), `${JSON.stringify(runtime, null, 2)}\n`);
console.log(JSON.stringify({
  mode: allRaces ? "all-races" : specials ? "graded-and-special" : requested.length ? "selected" : "configured",
  ...runtime,
}, null, 2));
