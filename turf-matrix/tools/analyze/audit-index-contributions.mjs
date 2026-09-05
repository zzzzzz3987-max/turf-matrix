import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { calibrateIndexScores } from "../intelligence/tm-index-engine.mjs";
import { indexRanking } from "../race-signal-selection.mjs";

const clip = (value) => Math.max(45, Math.min(92, value));
const round = (value) => Math.round(value * 1000) / 1000;
const parse = (value) => JSON.parse(String(value).replace(/^\uFEFF/, ""));
const hash = (value) => createHash("sha256").update(value).digest("hex");
const normalizeName = (value) => String(value).normalize("NFKC").replace(/[\s\u3000]/g, "");

// Reconstruct from published factor inputs, including weight normalization and rounding.
export const traceIndex = (horse, context) => {
  const analysis = horse.analysis;
  const entries = analysis?.indexContributions;
  if (!entries?.length) throw new Error(`Missing contributions: ${horse.name}`);
  if (entries.some((entry) => !Number.isFinite(entry.score) || !Number.isFinite(entry.weight))) {
    throw new Error(`Invalid contribution input: ${horse.name}`);
  }
  const scores = Object.fromEntries(entries.map((entry) => [entry.key, entry.score]));
  const effective = calibrateIndexScores(scores, context);
  const totalWeight = entries.reduce((sum, entry) => sum + entry.weight, 0);
  if (!(totalWeight > 0)) throw new Error("Non-positive total weight");
  const factors = Object.fromEntries(entries.map((entry) => [entry.key, effective[entry.key] * entry.weight / totalWeight]));
  const weighted = Object.values(factors).reduce((sum, value) => sum + value, 0);
  const raw = clip(Math.round(weighted + 8));
  const adjustments = Object.fromEntries(["sampleAdjustment", "goingAdjustment", "loadAdjustment", "trackBiasAdjustment"].map((key) => {
    if (!Number.isFinite(analysis[key])) throw new Error(`Missing ${key}: ${horse.name}`);
    return [key, analysis[key]];
  }));
  const beforeClip = raw + Object.values(adjustments).reduce((sum, value) => sum + value, 0);
  const final = clip(beforeClip);
  return {
    totalWeight,
    factors,
    weighted,
    raw,
    roundingAndRawClip: raw - weighted - 8,
    adjustments,
    finalClip: final - beforeClip,
    final,
    rawMatches: raw === analysis.rawTmIndex,
    finalMatches: final === horse.tmIndex,
  };
};

export const tracePair = (leader, second, context) => {
  const a = traceIndex(leader, context);
  const b = traceIndex(second, context);
  const deltas = Object.fromEntries([...new Set([...Object.keys(a.factors), ...Object.keys(b.factors)])]
    .map((key) => [key, (a.factors[key] ?? 0) - (b.factors[key] ?? 0)]));
  deltas.roundingAndRawClip = a.roundingAndRawClip - b.roundingAndRawClip;
  for (const key of Object.keys(a.adjustments)) deltas[key] = a.adjustments[key] - b.adjustments[key];
  deltas.finalClip = a.finalClip - b.finalClip;
  const reconstructedGap = Object.values(deltas).reduce((sum, value) => sum + value, 0);
  return { leader: a, second: b, deltas, reconstructedGap, gap: leader.tmIndex - second.tmIndex };
};

const main = () => {
  const [date, resultFile] = process.argv.slice(2);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "") || !resultFile) {
    throw new Error("Usage: node tools/analyze/audit-index-contributions.mjs YYYY-MM-DD results.json");
  }
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const prefix = git("rev-parse", "--show-prefix").trim();
  const snapshotFile = `${prefix}tools/week-data.json`;
  const engineFile = `${prefix}tools/intelligence/tm-index-engine.mjs`;
  const currentEngineHash = git("rev-parse", `HEAD:${engineFile}`).trim();
  const resultText = readFileSync(resolve(resultFile), "utf8");
  const results = parse(resultText);
  if (results.date !== date) throw new Error("Result date mismatch");
  const scheduleCommit = git("rev-list", "-1", `--before=${date}T00:00:00+09:00`, "HEAD", "--", "tools/week-data.json").trim();
  const schedule = parse(git("show", `${scheduleCommit}:${snapshotFile}`));
  if (schedule.meta?.date !== date) throw new Error("No previous-day schedule for requested date");
  const rows = [];
  let horsesChecked = 0;
  for (const scheduled of schedule.races) {
    if (!/^\d{2}:\d{2}$/.test(scheduled.time)) throw new Error("Invalid scheduled post time");
    const cutoff = `${date}T${scheduled.time}:00+09:00`;
    const commit = git("rev-list", "-1", `--before=${cutoff}`, "HEAD", "--", "tools/week-data.json").trim();
    const committedAt = git("show", "-s", "--format=%cI", commit).trim();
    if (Date.parse(committedAt) >= Date.parse(cutoff)) throw new Error("Snapshot is not pre-race");
    if (git("rev-parse", `${commit}:${engineFile}`).trim() !== currentEngineHash) {
      throw new Error("Historical calibration differs; use that revision to audit");
    }
    const snapshotText = git("show", `${commit}:${snapshotFile}`);
    const snapshot = parse(snapshotText);
    if (snapshot.meta?.date !== date) throw new Error("Snapshot date mismatch");
    const race = snapshot.races.find((item) => item.bundleId === scheduled.bundleId);
    if (!race || race.time !== scheduled.time) throw new Error("Missing race or changed post time");
    const resultRace = results.races.find((item) => item.bundleId === race.bundleId);
    if (!resultRace) throw new Error(`Missing result race: ${race.bundleId}`);
    const ranked = indexRanking(race);
    const traces = ranked.map((horse) => traceIndex(horse, race));
    if (traces.some((trace) => !trace.rawMatches || !trace.finalMatches)) throw new Error(`Index mismatch: ${race.bundleId}`);
    horsesChecked += traces.length;
    const summarize = (horse) => {
      const result = resultRace.horses.find((item) => item.horseNumber === horse.number);
      if (!result || normalizeName(result.horseName) !== normalizeName(horse.name)) throw new Error("Result horse mismatch");
      return {
        number: horse.number, name: horse.name, tmIndex: horse.tmIndex,
        finish: result.finishPosition, placePayout: result.placePayout,
        scores: Object.fromEntries(horse.analysis.indexContributions.map((entry) => [entry.key, entry.score])),
        missingFactors: Object.entries(horse.analysis.factorsDetail).filter(([, value]) => value.status === "missing").map(([key]) => key),
        load: horse.analysis.loadAnalysis,
        runCount: horse.pastRuns.length,
        crossSurfaceSameCourseRuns: horse.pastRuns.filter((run) => run.course === horse.currentRace.course && run.surface && run.surface !== horse.currentRace.surface).length,
      };
    };
    rows.push({
      bundleId: race.bundleId, name: race.name, track: race.track, number: race.number,
      cutoff, commit, committedAt, snapshotSha256: hash(snapshotText),
      diagnostics: {
        horseCount: ranked.length,
        trainingMissing: ranked.filter((horse) => horse.analysis.factorsDetail.training.status === "missing").length,
        biasMissing: ranked.filter((horse) => horse.analysis.trackBiasAnalysis.status === "missing").length,
        crossSurfaceCourseHorses: ranked.filter((horse) => horse.pastRuns.some((run) => run.course === horse.currentRace.course && run.surface && run.surface !== horse.currentRace.surface)).map((horse) => horse.name),
      },
      first: summarize(ranked[0]), second: summarize(ranked[1]),
      trace: tracePair(ranked[0], ranked[1], race),
    });
  }
  const output = {
    date, basis: "last committed publication strictly before scheduled post time",
    engineBlob: currentEngineHash, resultsSha256: hash(resultText),
    scoreRulesChanged: false, horsesChecked,
    diagnostics: {
      trainingMissing: rows.reduce((sum, row) => sum + row.diagnostics.trainingMissing, 0),
      biasMissing: rows.reduce((sum, row) => sum + row.diagnostics.biasMissing, 0),
      crossSurfaceCourseHorses: rows.flatMap((row) => row.diagnostics.crossSurfaceCourseHorses),
    },
    rows,
  };
  const target = resolve(root, "docs", "analysis", `index-contribution-audit-${date}`);
  writeFileSync(`${target}.json`, `${JSON.stringify(output, null, 2)}\n`);
  const labels = { ability: "能力", form: "近走", distance: "距離", course: "コース", training: "調教", blood: "血統", pace: "展開", roundingAndRawClip: "丸め", sampleAdjustment: "経験", goingAdjustment: "馬場", loadAdjustment: "斤量", trackBiasAdjustment: "バイアス", finalClip: "上限下限" };
  const lines = [
    `# 指数寄与監査 ${date}`, "", `対象 ${rows.length}レース / ${horsesChecked}頭。全頭で基本指数・最終指数が保存値と一致。`,
    "発走予定時刻より前の最終commitを使用。寄与は重み合計で正規化し、丸めと補正を含めて点差へ一致させる。結果は比較対象の選定・採点に使用しない。", "",
    "| レース | 指数1位 | 指数2位 | 点差 | 能力 | 近走 | 距離 | コース | 調教 | 血統 | 展開 | 丸め | 斤量 | 馬場 |",
    "|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...rows.map((row) => `| ${row.track}${row.number}R | ${row.first.name} ${row.first.tmIndex} (${row.first.finish}着) | ${row.second.name} ${row.second.tmIndex} (${row.second.finish}着) | ${row.trace.gap} | ${["ability", "form", "distance", "course", "training", "blood", "pace", "roundingAndRawClip", "loadAdjustment", "goingAdjustment"].map((key) => round(row.trace.deltas[key] ?? 0)).join(" | ")} |`),
    "", "正値は指数1位側、負値は指数2位側への寄与差。小数表示による端数差あり。", "",
  ];
  for (const row of rows) {
    lines.push(`## ${row.track}${row.number}R ${row.name}`, "", `発走前commit: ${row.commit} (${row.committedAt})`, "",
      ...[row.first, row.second].map((horse) => `- ${horse.name}: 基本指数 ${horse === row.first ? row.trace.leader.raw : row.trace.second.raw} / 斤量 ${horse.load.adjustment} (相対斤量 ${horse.load.rawAdjustment}, 個体耐性 ${horse.load.tolerance?.adjustment ?? 0}) / 未取得 ${horse.missingFactors.join("・") || "なし"} / 同場の異馬場実績 ${horse.crossSurfaceSameCourseRuns}走`),
      `- 点差の主因: ${Object.entries(row.trace.deltas).filter(([, value]) => Math.abs(value) >= 0.1).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 4).map(([key, value]) => `${labels[key]} ${round(value)}`).join("、")}`, "");
  }
  writeFileSync(`${target}.md`, `${lines.join("\n")}\n`);
  console.log(JSON.stringify({ output: target, races: rows.length, horsesChecked, mismatches: 0 }));
};

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
