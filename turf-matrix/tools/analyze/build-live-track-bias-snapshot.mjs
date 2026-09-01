#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeSurface } from "../intelligence/track-bias-ai.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
const numberOrNull = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value))
  ? Number(value)
  : null;
const argValue = (name, fallback) => {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? fallback;
};
const resultsPath = argValue("results", join(ROOT, "data", "target", "results.latest.json"));
const signalsPath = argValue("signals", join(ROOT, "tools", "all-race-signals.json"));
const outPath = argValue("out", join(ROOT, "tools", "track-bias.current.json"));

if (!existsSync(resultsPath)) throw new Error(`Live result file not found: ${resultsPath}`);
if (!existsSync(signalsPath)) throw new Error(`All-race signal file not found: ${signalsPath}`);

const results = readJson(resultsPath);
const signals = readJson(signalsPath);
const raceDate = String(results.RaceDate ?? results.raceDate ?? signals.date ?? "").slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(raceDate)) throw new Error("Live track-bias race date is missing");
if (String(signals.date ?? "").slice(0, 10) !== raceDate) throw new Error("Result and all-race signal dates differ");

const meta = new Map((signals.races ?? []).map((race) => [`${race.track}-${Number(race.number ?? race.raceNo)}`, race]));
const races = [];
for (const resultRace of results.Races ?? results.races ?? []) {
  const race = resultRace.Race ?? resultRace.race ?? {};
  const track = race.CourseName ?? race.courseName ?? race.track ?? race.course;
  const raceNo = Number(race.RaceNo ?? race.raceNo ?? race.number);
  const signal = meta.get(`${track}-${raceNo}`);
  const surface = normalizeSurface(signal?.surface);
  if (!signal || !["芝", "ダート"].includes(surface) || resultRace.IsFinal === false) continue;
  const horses = (resultRace.Horses ?? resultRace.horses ?? []).map((horse) => ({
    horseNumber: numberOrNull(horse.HorseNumber ?? horse.horseNumber ?? horse.number),
    horseName: horse.HorseName ?? horse.horseName ?? horse.name ?? null,
    finish: numberOrNull(horse.FinishPosition ?? horse.finishPosition ?? horse.finish),
    popularity: numberOrNull(horse.FinalPopularity ?? horse.finalPopularity ?? horse.popularity),
    corner4: numberOrNull(horse.Corner4 ?? horse.corner4),
    abnormalityCode: horse.AbnormalityCode ?? horse.abnormalityCode ?? null,
  })).filter((horse) => Number.isFinite(horse.finish) && horse.finish > 0 && Number.isFinite(horse.horseNumber));
  if (horses.length < 3) continue;
  races.push({
    date: raceDate,
    track,
    surface,
    raceNo,
    time: signal.time ?? null,
    fieldSize: Number(signal.fieldSize) || horses.length,
    horses,
  });
}

if (!races.length) throw new Error("No finalized flat races could be joined to the all-race signal metadata");
races.sort((left, right) => left.track.localeCompare(right.track, "ja") || left.raceNo - right.raceNo);
const artifact = {
  schemaVersion: 2,
  targetDate: raceDate,
  sourceDate: raceDate,
  generatedAt: new Date().toISOString(),
  source: "JV-Link finalized SE records joined to frozen all-race metadata",
  method: "same-day earlier-race position and frame-zone audit v2",
  scoringMode: "shadow",
  policy: {
    targetRaceResultAllowed: false,
    resolverRequiresSourceRaceNoBelowTarget: true,
    currentHorsePopularityOddsValueUsed: false,
    sourcePopularityUsedOnlyForBiasDebiasing: true,
    lanePathAvailable: false,
    frameZoneMustNotBeDescribedAsLanePath: true,
    productionTmIndexConnected: false,
  },
  summary: {
    raceCount: races.length,
    horseCount: races.reduce((sum, race) => sum + race.horses.length, 0),
    tracks: [...new Set(races.map((race) => race.track))],
    maximumSourceRaceNo: Math.max(...races.map((race) => race.raceNo)),
  },
  races,
};
writeFileSync(outPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ output: outPath, ...artifact.summary }, null, 2));
