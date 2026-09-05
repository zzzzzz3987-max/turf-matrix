import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { loadFrozenPublicRoleDays } from "./lib/public-role-archive.mjs";
import { scoreRecentForm } from "../intelligence/form-ai.mjs";
import { scoreCourse } from "../intelligence/course-ai.mjs";
import { calculateTmIndex } from "../intelligence/tm-index-engine.mjs";
import { indexRanking } from "../race-signal-selection.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const date = process.argv[2];
const resultPath = process.argv[3];
if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "") || !resultPath) throw new Error("Usage: node tools/analyze/evaluate-form-course-candidates.mjs YYYY-MM-DD results.json (run contribution audit first)");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
const sha = (value) => createHash("sha256").update(value).digest("hex");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const prefix = git("rev-parse", "--show-prefix").trim();
const normalize = (name) => String(name).normalize("NFKC").replace(/[\s\u3000]/g, "");
const clamp = (value) => Math.max(45, Math.min(92, value));
const modes = ["baseline", "form", "course", "combined"];
const skipped = [];
const inputs = [];
const rows = [];
const indexFor = (horse, scores, race) => {
  const raw = calculateTmIndex(scores, race);
  const count = horse.pastRuns.length;
  const experience = count < 3 ? Math.round(65 + (raw - 65) * (count === 0 ? 0.3 : count === 1 ? 0.5 : 0.7)) : raw;
  return clamp(experience + (horse.analysis.goingAdjustment ?? 0) + (horse.analysis.loadAdjustment ?? 0) + (horse.analysis.trackBiasAdjustment ?? 0));
};

const evaluateRace = (race, resultRace, source) => {
  const skip = (reason) => { skipped.push({ ...source, bundleId: race?.bundleId, reason }); };
  if (!race || !resultRace) return skip("missing race or results");
  const postTime = Date.parse(`${source.date}T${race.time}:00+09:00`);
  const committedTime = Date.parse(source.committedAt);
  if (!Number.isFinite(postTime) || !Number.isFinite(committedTime) || committedTime >= postTime) return skip("snapshot not strictly pre-race");
  const ranked = indexRanking(race);
  if (ranked.length < 2) return skip("fewer than two ranked horses");
  const assessed = [];
  for (const horse of ranked) {
    if (!Array.isArray(horse.pastRuns) || !horse.currentRace || !horse.analysis?.indexContributions?.length) return skip("missing frozen scoring inputs");
    if (!["goingAdjustment", "loadAdjustment", "trackBiasAdjustment"].every((key) => Number.isFinite(horse.analysis[key]))) return skip(`missing frozen correction: ${horse.name}`);
    const scores = Object.fromEntries(horse.analysis.indexContributions.map((entry) => [entry.key, entry.score]));
    if (scoreRecentForm(horse) !== scores.form || scoreCourse(horse) !== scores.course) return skip(`factor replay mismatch: ${horse.name}`);
    if (calculateTmIndex(scores, race) !== horse.analysis.rawTmIndex || indexFor(horse, scores, race) !== horse.tmIndex) return skip(`index replay mismatch: ${horse.name}`);
    const result = resultRace.horses.find((item) => Number(item.horseNumber) === horse.number);
    if (!result || normalize(result.horseName) !== normalize(horse.name) || !Number.isFinite(result.finishPosition) || !Number.isFinite(result.winPayout) || !Number.isFinite(result.placePayout)) return skip(`result JOIN/settlement unavailable: ${horse.name}`);
    const form = scoreRecentForm(horse, { normalizeWeights: true });
    const course = scoreCourse(horse, { sameSurfaceOnly: true });
    assessed.push({
      number: horse.number, name: horse.name,
      finish: result.finishPosition, winPayout: result.winPayout, placePayout: result.placePayout,
      oldForm: scores.form, form, oldCourse: scores.course, course,
      scores: {
        baseline: horse.tmIndex,
        form: indexFor(horse, { ...scores, form }, race),
        course: indexFor(horse, { ...scores, course }, race),
        combined: indexFor(horse, { ...scores, form, course }, race),
      },
    });
  }
  const leaders = Object.fromEntries(modes.map((mode) => [mode, [...assessed].sort((a, b) => b.scores[mode] - a.scores[mode] || a.number - b.number)[0].number]));
  rows.push({ ...source, bundleId: race.bundleId, name: race.name, track: race.track, number: race.number, leaders, horses: assessed });
};

for (const day of loadFrozenPublicRoleDays({ root })) {
  if (day.date >= date) continue;
  if (day.results.date !== day.date) {
    skipped.push({ date: day.date, reason: "result file date mismatch", actualDate: day.results.date });
    continue;
  }
  const committedAt = git("show", "-s", "--format=%cI", day.commit).trim();
  inputs.push({ date: day.date, commit: day.commit, resultsSha256: sha(JSON.stringify(day.results)) });
  for (const race of day.snapshot.races) evaluateRace(race, day.results.races.find((r) => r.bundleId === race.bundleId), { date: day.date, commit: day.commit, committedAt, period: "historical-exploratory" });
}

const audit = readJson(join(root, "docs", "analysis", `index-contribution-audit-${date}.json`));
const resultText = readFileSync(resolve(resultPath), "utf8");
if (sha(resultText) !== audit.resultsSha256) throw new Error("Results differ from contribution audit");
const results = JSON.parse(resultText);
for (const row of audit.rows) {
  const text = git("show", `${row.commit}:${prefix}tools/week-data.json`);
  if (sha(text) !== row.snapshotSha256) throw new Error("Snapshot hash mismatch");
  const snapshot = JSON.parse(text);
  if (snapshot.meta.date !== date || results.date !== date) throw new Error("Discovery date mismatch");
  evaluateRace(snapshot.races.find((r) => r.bundleId === row.bundleId), results.races.find((r) => r.bundleId === row.bundleId), { date, commit: row.commit, committedAt: row.committedAt, period: "discovery-day-not-holdout" });
}

const summarize = (selected, mode) => {
  const picks = selected.map((row) => row.horses.find((horse) => horse.number === row.leaders[mode]));
  const winReturn = picks.reduce((sum, horse) => sum + horse.winPayout, 0);
  const placeReturn = picks.reduce((sum, horse) => sum + horse.placePayout, 0);
  return {
    races: picks.length, wins: picks.filter((h) => h.finish === 1).length,
    topThree: picks.filter((h) => h.finish <= 3).length,
    placeHits: picks.filter((h) => h.placePayout > 0).length,
    winReturn, placeReturn,
    winROI: picks.length ? +(winReturn / picks.length).toFixed(1) : null,
    placeROI: picks.length ? +(placeReturn / picks.length).toFixed(1) : null,
    changed: selected.filter((row) => row.leaders.baseline !== row.leaders[mode]).length,
  };
};
const summaries = Object.fromEntries(["historical-exploratory", "discovery-day-not-holdout", "all"].map((period) => [period, Object.fromEntries(modes.map((mode) => [mode, summarize(rows.filter((row) => period === "all" || row.period === period), mode)]))]));
const output = {
  modelVersion: "form-weight-course-surface-v1-shadow", date,
  policy: { productionConnected: false, coefficientsTunedToResults: false, prospectiveSampleSize: 0, otherFactorsAndCorrectionsFrozen: true, candidateExperienceDiscountRecomputed: true },
  sourceHashes: Object.fromEntries(["form-ai.mjs", "course-ai.mjs", "tm-index-engine.mjs"].map((name) => [name, sha(readFileSync(join(root, "tools", "intelligence", name)))])),
  inputs, summaries, skipped, rows,
};
const target = join(root, "docs", "analysis", `form-course-candidates-${date}`);
writeFileSync(`${target}.json`, `${JSON.stringify(output, null, 2)}\n`);
const lines = [
  `# Form加重平均・Course芝ダート分離の比較 ${date}`, "",
  "本番未接続。Formだけ、Courseだけ、両方の3候補を同じ保存入力で比較。係数は結果を見て調整していない。今回発見に使った日をholdoutと呼ばない。新規レースの事前固定検証は0件。",
  "現行計算が保存値へ一致しないレース、結果JOIN不成立のレースは全方式で除外。その他の因子と補正は保存値に固定し、経験数補正だけは候補の基本指数に対して再計算する。", "",
];
for (const [period, stats] of Object.entries(summaries)) {
  lines.push(`## ${period}`, "", "| 方式 | レース | 1着 | 3着内 | 複勝的中 | 単勝回収率 | 複勝回収率 | 首位変更 |", "|---|---:|---:|---:|---:|---:|---:|---:|");
  for (const [mode, s] of Object.entries(stats)) lines.push(`| ${mode} | ${s.races} | ${s.wins} | ${s.topThree} | ${s.placeHits} | ${s.winROI ?? "-"}% | ${s.placeROI ?? "-"}% | ${s.changed} |`);
  lines.push("");
}
lines.push("## 首位変更の全件", "", "| 日付・レース | 現行 | Form | Course | 両方 |", "|---|---|---|---|---|");
for (const row of rows.filter((r) => modes.some((mode) => r.leaders[mode] !== r.leaders.baseline))) {
  lines.push(`| ${row.date} ${row.track}${row.number}R | ${modes.map((mode) => { const h = row.horses.find((horse) => horse.number === row.leaders[mode]); return `${h.name} ${h.scores[mode]}点 (${h.finish}着)`; }).join(" | ")} |`);
}
lines.push("", "## 除外", "", ...skipped.map((s) => `- ${s.date} ${s.bundleId ?? ""}: ${s.reason}${s.actualDate ? ` (${s.actualDate})` : ""}`), "");
writeFileSync(`${target}.md`, lines.join("\n"));
console.log(JSON.stringify({ target, summaries, excluded: skipped.length }, null, 2));
