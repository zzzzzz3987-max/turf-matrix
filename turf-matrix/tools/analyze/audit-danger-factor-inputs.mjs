import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { buildTrainingAnalysis } from "../intelligence/training-ai.mjs";
import { buildRecentFormWeightEvidence, scoreRecentForm } from "../intelligence/form-ai.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const review = read(path.join(root, "docs/reviews/2026-09-19-22-results.json"));
const repository = path.join(process.env.LOCALAPPDATA, "TurfMatrix/odds-runner/turf-matrix");
const cache = new Map();
const snapshot = (source) => {
  if (!cache.has(source.commit)) cache.set(source.commit, execFileSync("git", ["show", `${source.commit}:turf-matrix/tools/week-data.json`],
    { cwd: repository, encoding: "utf8", maxBuffer: 50_000_000 }));
  const text = cache.get(source.commit);
  assert.equal(createHash("sha256").update(text).digest("hex"), source.weekSha256);
  assert.ok(new Date(source.availableAt) < new Date(`${source.date}T${source.time}:00+09:00`));
  return JSON.parse(text);
};
const compactSession = (session) => session ? { date: session.date, type: session.type,
  daysBeforeRace: session.daysBeforeRace, score: session.score, f4: session.f4, f1: session.f1 } : null;
const eligibleScore = (analysis) => analysis.indexEligible !== false && (analysis.count > 0 || analysis.videoReview)
  ? analysis.score : null;
const rows = [];
for (const source of review.sources) {
  const race = snapshot(source).races.find((item) => item.id === source.raceId);
  if (!race) continue;
  for (const horse of race.horses) {
    assert.ok(horse.pastRuns.every((run) => (run.date ?? run.raceDate) < source.date));
    const legacy = buildTrainingAnalysis(horse, { phasePolicy: "legacy-four-day" });
    const candidate = buildTrainingAnalysis(horse);
    const factors = horse.analysis.factorsDetail;
    const formWeights = buildRecentFormWeightEvidence(horse);
    const selected = review.rows.find((row) => row.raceId === race.id && row.scope === "specialDetails" && row.role === "danger" && row.number === horse.number);
    const recent = horse.pastRuns.slice(0, 5);
    rows.push({ date: source.date, raceId: race.id, number: horse.number, name: horse.name, commit: source.commit,
      publishedDanger: Boolean(selected), dangerFinish: selected?.finishPosition ?? null,
      ability: { score: factors.ability?.score, components: factors.ability?.components?.map(({ key, score, status }) => ({ key, score, status })) },
      form: { published: factors.form?.score, legacyReplay: scoreRecentForm(horse), normalizedCandidate: scoreRecentForm(horse, { normalizeWeights: true }),
        normalizationConnected: false, currentSurface: horse.currentRace.surface,
        differentSurfaceRecentCount: recent.filter((run) => run.surface && run.surface !== horse.currentRace.surface).length,
        weightEvidence: formWeights,
        recent: recent.map(({ date, surface, distance, finishPosition, last3F }) => ({ date, surface, distance, finishPosition, last3F })) },
      training: { published: factors.training?.score, legacyReplay: eligibleScore(legacy), candidate: eligibleScore(candidate),
        baselineMatches: factors.training?.score === eligibleScore(legacy),
        indexEligible: candidate.indexEligible, phasePolicy: candidate.phasePolicy,
        delta: eligibleScore(candidate) == null || eligibleScore(legacy) == null ? null : candidate.score - legacy.score,
        oldFinal: compactSession(legacy.final), newFinal: compactSession(candidate.final),
        oldOneWeek: compactSession(legacy.oneWeek), newOneWeek: compactSession(candidate.oneWeek),
        oldComponents: legacy.components, newComponents: candidate.components,
        excludedSessionCount: Math.max(0, (horse.training?.slope?.length ?? 0) + (horse.training?.wood?.length ?? 0) - candidate.sessions.length) } });
  }
}
const changed = rows.filter((row) => row.training.delta !== null && row.training.delta !== 0);
const report = { generatedAt: new Date().toISOString(), policy: { retrospectiveOnly: true, source: "hash-checked pre-start snapshots",
  currentRaceResultUsedForScoring: false, publicPayloadChanged: false, indexWeightsChanged: false,
  scope: "Special-race runners only. Training-factor replay, not an end-to-end new index or ROI simulation.",
  caveat: "Local stable/history dictionaries are reused by both phase variants. Published-vs-legacy mismatches are reported, never treated as exact historical replay." },
  summary: { raceCount: new Set(rows.map((row) => row.raceId)).size, horses: rows.length,
    baselineMatches: rows.filter((row) => row.training.baselineMatches).length,
    trainingChanged: changed.length, increased: changed.filter((row) => row.training.delta > 0).length,
    decreased: changed.filter((row) => row.training.delta < 0).length,
    minDelta: changed.length ? Math.min(...changed.map((row) => row.training.delta)) : 0,
    maxDelta: changed.length ? Math.max(...changed.map((row) => row.training.delta)) : 0,
    changedByDay: Object.fromEntries(review.dates.map((date) => [date, changed.filter((row) => row.date === date).length])) },
  dangerWinners: rows.filter((row) => row.publishedDanger && row.dangerFinish === 1), rows };
const output = path.join(root, "docs/analysis/danger-factor-inputs-2026-09-19-22.json");
fs.writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ output, summary: report.summary,
  winners: report.dangerWinners.map((row) => ({ name: row.name, ability: row.ability.score,
    form: row.form.published, normalizedForm: row.form.normalizedCandidate,
    differentSurfaceRuns: row.form.differentSurfaceRecentCount, training: row.training.published,
    newTraining: row.training.candidate, oldFinal: row.training.oldFinal, newFinal: row.training.newFinal })),
  baselineMismatches: rows.filter((row) => !row.training.baselineMatches).map((row) => ({ name: row.name,
    published: row.training.published, replay: row.training.legacyReplay })) }, null, 2));
