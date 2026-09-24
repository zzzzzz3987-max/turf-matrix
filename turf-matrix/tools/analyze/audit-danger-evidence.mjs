import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { DANGER_ASSESSMENT_VERSION, assessPublicDangerCandidates, selectPublicDangerEvidenceHorse } from "../../src/lib/public-danger-assessment.js";
import { selectPublicDangerHorse } from "../../src/lib/public-role-selection.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const argument = (key, fallback) => process.argv.find((arg) => arg.startsWith(`--${key}=`))?.slice(key.length + 3) ?? fallback;
const input = path.resolve(argument("input", path.join(root, "docs/reviews/2026-09-19-22-results.json")));
const repository = argument("repository", path.join(process.env.LOCALAPPDATA, "TurfMatrix/odds-runner/turf-matrix"));
const output = path.resolve(argument("output", path.join(root, "docs/analysis/danger-evidence-2026-09-19-22.json")));
assert.notEqual(input, output, "Do not replace the historical results report");
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const review = read(input);
const cache = new Map();
const snapshots = (commit, expectedHash) => {
  if (!cache.has(commit)) cache.set(commit, execFileSync("git", ["show", `${commit}:turf-matrix/tools/week-data.json`],
    { cwd: repository, encoding: "utf8", maxBuffer: 50_000_000 }));
  const text = cache.get(commit);
  assert.equal(createHash("sha256").update(text).digest("hex"), expectedHash, "Historical snapshot changed");
  return JSON.parse(text);
};
const compact = (item) => item ? {
  number: item.horse.number, name: item.horse.name, score: item.score,
  competitionRank: item.competitionRank, popularity: item.horse.popularity,
  rankGap: item.rankGap, leaderGap: item.leaderGap, classification: item.classification,
  risks: item.risks, protections: item.protections, reasons: item.reasons,
} : null;
const rows = [];
for (const source of review.sources) {
  assert.ok(new Date(source.availableAt) < new Date(`${source.date}T${source.time}:00+09:00`));
  const race = snapshots(source.commit, source.weekSha256).races.find((item) => item.id === source.raceId);
  if (!race) continue;
  // Selection runs exclusively on the immutable pre-race snapshot, before joining results.
  const candidates = assessPublicDangerCandidates(race);
  const revised = selectPublicDangerEvidenceHorse(race);
  const tiesOnly = selectPublicDangerHorse(race);
  const published = review.rows.find((item) => item.raceId === source.raceId && item.scope === "specialDetails" && item.role === "danger");
  const result = read(path.join(root, `data/archive/${source.date}-all-race-results.json`)).Races
    .find((item) => `${source.date}-${item.Race.CourseName}-${item.Race.RaceNo}R` === race.id);
  assert.equal(result?.IsFinal, true);
  const finish = (selection) => {
    if (!selection) return null;
    const horse = result.Horses.find((item) => item.HorseNumber === selection.number);
    const normalize = (value) => String(value).normalize("NFKC").replace(/[\s*＊$＄]/g, "");
    assert.equal(normalize(horse?.HorseName), normalize(selection.name));
    assert.ok(horse.FinishPosition > 0, "Handle cancelled/abnormal outcomes explicitly before comparison");
    return { number: selection.number, name: selection.name, finishPosition: horse.FinishPosition };
  };
  rows.push({ date: source.date, raceId: race.id, race: race.name, commit: source.commit, availableAt: source.availableAt,
    published: finish(published), tiesOnly: finish(tiesOnly), candidate: finish(revised),
    publishedAssessment: compact(candidates.find((item) => item.horse.number === published?.number)),
    assessments: candidates.filter((item) => item.classification !== "none").map(compact) });
}
const stats = (key) => {
  const selected = rows.map((row) => row[key]).filter(Boolean);
  const wins = selected.filter((row) => row.finishPosition === 1).length;
  const top3 = selected.filter((row) => row.finishPosition <= 3).length;
  return { selected: selected.length, wins, top3, outsideTop3: selected.length - top3,
    coverage: rows.length ? selected.length / rows.length : null,
    outsideTop3Rate: selected.length ? (selected.length - top3) / selected.length : null };
};
const report = { version: DANGER_ASSESSMENT_VERSION, generatedAt: new Date().toISOString(),
  policy: { productionConnected: false, retrospectiveOnly: true, thresholdValidated: false,
    resultUsedForSelection: false, indexWeightsChanged: false,
    nextStep: "Freeze this policy before future races; assess coverage and false warnings on unseen data. Do not tune to remove known winners." },
  raceCount: rows.length, summary: Object.fromEntries(["published", "tiesOnly", "candidate"].map((key) => [key, stats(key)])), rows };
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ output, raceCount: report.raceCount, summary: report.summary,
  changed: rows.filter((row) => row.published?.number !== row.candidate?.number).map((row) => ({ race: row.race,
    before: row.published, after: row.candidate, reasons: row.publishedAssessment?.reasons })) }, null, 2));
