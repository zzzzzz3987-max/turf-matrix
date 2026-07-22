import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const outputDir = path.join(repoRoot, "tools", "jvlink", "output");
const summary = JSON.parse(fs.readFileSync(path.join(outputDir, "week-race-summary.json"), "utf8"));
const base = JSON.parse(fs.readFileSync(path.join(repoRoot, "tools", "race-batch-config.json"), "utf8"));
const args = process.argv.slice(2);
const allRaces = args.includes("--all-races");
const racesIndex = args.indexOf("--races");
const requested = racesIndex >= 0 ? String(args[racesIndex + 1] || "").split(",").map((v) => v.trim()).filter(Boolean) : [];
if (allRaces && requested.length) throw new Error("--all-races and --races cannot be used together.");

const course = {
  "01": ["sapporo", "札幌"], "02": ["hakodate", "函館"], "03": ["fukushima", "福島"],
  "04": ["niigata", "新潟"], "05": ["tokyo", "東京"], "06": ["nakayama", "中山"],
  "07": ["chukyo", "中京"], "08": ["kyoto", "京都"], "09": ["hanshin", "阪神"], "10": ["kokura", "小倉"],
};
const date = String(base.raceDate || summary.configuredRaceDate);
const available = (summary.races || []).filter((race) => race.raceDate === date).sort((a, b) =>
  String(a.courseCode).localeCompare(String(b.courseCode)) || Number(a.raceNo) - Number(b.raceNo),
).map((race) => {
  const names = course[String(race.courseCode)] || [];
  return { bundle: `${date}-${names[0]}-${Number(race.raceNo)}R`, labels: [`${names[1]}${Number(race.raceNo)}`, `${names[1]}${Number(race.raceNo)}R`, `${names[0]}${Number(race.raceNo)}`, `${names[0]}${Number(race.raceNo)}R`] };
});

let bundles;
if (allRaces) bundles = available.map((race) => race.bundle);
else if (requested.length) {
  bundles = requested.map((value) => {
    const normalized = value.replace(/\s+/g, "").toLowerCase();
    const found = available.find((race) => race.labels.some((label) => label.toLowerCase() === normalized));
    if (!found) throw new Error(`Requested race is unavailable: ${value}`);
    return found.bundle;
  });
} else bundles = base.bundles;

bundles = [...new Set(bundles)];
if (!bundles.length) throw new Error("No target races were selected.");
const runtime = { raceDate: date, expectedRaceCount: bundles.length, bundles };
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, "race-batch-runtime.json"), `${JSON.stringify(runtime, null, 2)}\n`);
console.log(JSON.stringify({ mode: allRaces ? "all-races" : requested.length ? "selected" : "configured", ...runtime }, null, 2));
