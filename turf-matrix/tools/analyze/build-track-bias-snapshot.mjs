#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
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

const readJson = (path) => JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
const round = (value, digits = 3) => Number(value.toFixed(digits));
const argValue = (name) => {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? null;
};

const classifyPosition = (corner4, fieldSize) => {
  const frontLimit = Math.max(3, Math.ceil(fieldSize * 0.25));
  if (corner4 <= frontLimit) return "front";
  if (corner4 <= fieldSize * 0.6) return "middle";
  return "rear";
};

const popularityOutperformance = (horse, fieldSize) => {
  if (fieldSize <= 1 || horse.finish == null || horse.popularity == null) return null;
  const actual = (fieldSize - horse.finish) / (fieldSize - 1);
  const expected = (fieldSize - horse.popularity) / (fieldSize - 1);
  return actual - expected;
};

const buildProfile = ({ track, surface, races }) => {
  const runners = races.flatMap((race) => race.horses.map((horse) => ({ ...horse, fieldSize: race.horses.length })));
  const front = runners.filter((horse) => horse.group === "front");
  const rear = runners.filter((horse) => horse.group === "rear");
  const frontWins = front.filter((horse) => horse.finish === 1).length;
  const frontTop3Count = front.filter((horse) => horse.finish <= 3).length;
  const rearTop3Count = rear.filter((horse) => horse.finish <= 3).length;
  const outperformance = front
    .map((horse) => popularityOutperformance(horse, horse.fieldSize))
    .filter(Number.isFinite);
  const frontPopularityOutperformance = outperformance.length
    ? round(outperformance.reduce((sum, value) => sum + value, 0) / outperformance.length)
    : null;
  const frontWinShare = races.length ? frontWins / races.length : 0;
  const frontTop3Share = races.length ? frontTop3Count / (races.length * 3) : 0;
  const active = races.length >= 4
    && rearTop3Count === 0
    && frontWinShare >= 0.6
    && frontPopularityOutperformance != null
    && frontPopularityOutperformance >= 0;
  const strong = active && frontWinShare >= 0.75 && frontTop3Share >= 0.75;

  return {
    track,
    surface,
    status: active ? "active" : "monitor",
    style: "front",
    strength: strong ? "strong" : active ? "moderate" : "watch",
    confidence: active ? "mid" : "low",
    sample: {
      raceCount: races.length,
      runnerCount: runners.length,
      frontWins,
      frontTop3Count,
      frontRunnerCount: front.length,
      rearTop3Count,
      rearRunnerCount: rear.length,
      frontPopularityOutperformance,
    },
    note: active
      ? (strong
          ? "Front runners dominated both wins and top-three finishes after the popularity check."
          : "Rear runners recorded no top-three finish; moderate anti-rear adjustment only.")
      : "Activation conditions were not all satisfied; no score correction.",
  };
};

const buildSnapshot = ({ liveResults, publishedSignals, sourceDate, targetDate }) => {
  if (String(liveResults.RaceDate ?? "") !== sourceDate) throw new Error("JV-Link result date does not match source date.");
  if (!(Date.parse(`${sourceDate}T00:00:00+09:00`) < Date.parse(`${targetDate}T00:00:00+09:00`))) {
    throw new Error("Target date must be later than source date.");
  }

  const raceMeta = new Map((publishedSignals.races ?? []).map((race) => [`${race.track}-${race.number}`, race]));
  const grouped = new Map();
  for (const resultRace of liveResults.Races ?? []) {
    const track = COURSE_NAMES[resultRace.Race?.CourseCode];
    const raceNo = number(resultRace.Race?.RaceNo);
    const meta = raceMeta.get(`${track}-${raceNo}`);
    const surface = String(meta?.surface ?? "").startsWith("ダ") ? "ダート" : meta?.surface;
    if (!track || !raceNo || !["芝", "ダート"].includes(surface)) continue;

    const horses = (resultRace.Horses ?? []).map((horse) => ({
      finish: number(horse.FinishPosition),
      popularity: number(horse.FinalPopularity),
      corner4: number(horse.Corner4),
    })).filter((horse) => horse.finish != null && horse.corner4 != null);
    if (horses.length < 3) continue;
    for (const horse of horses) horse.group = classifyPosition(horse.corner4, horses.length);
    const key = `${track}-${surface}`;
    if (!grouped.has(key)) grouped.set(key, { track, surface, races: [] });
    grouped.get(key).races.push({ horses });
  }

  const profiles = [...grouped.values()].map(buildProfile).sort((a, b) => (
    a.track.localeCompare(b.track, "ja") || a.surface.localeCompare(b.surface, "ja")
  ));
  if (!profiles.length) throw new Error("No flat-race fourth-corner records were available.");

  return {
    schemaVersion: 1,
    targetDate,
    sourceDate,
    generatedAt: new Date().toISOString(),
    source: "JV-Link finalized SE records",
    method: "same-meeting previous-day venue-surface fourth-corner audit with popularity check v1",
    definitions: {
      front: "fourth-corner position within the leading 25 percent, with at least the first three runners included",
      middle: "fourth-corner position above 25 percent and within 60 percent",
      rear: "fourth-corner position behind 60 percent",
      activation: "at least four races, zero rear-group top-three finishes, front win share at least 60 percent, and non-negative front popularity outperformance",
      maximumTmIndexAdjustment: 1,
    },
    profiles,
  };
};

const main = () => {
  const sourceDate = argValue("source-date");
  const targetDate = argValue("target-date");
  if (!sourceDate || !targetDate) throw new Error("Use --source-date=YYYY-MM-DD --target-date=YYYY-MM-DD.");
  const resultsPath = argValue("results") ?? join(ROOT, "data", "target", "results.latest.json");
  const signalsPath = argValue("signals") ?? join(ROOT, "data", "archive", `${sourceDate}-all-race-signals-pre-race.json`);
  const outPath = argValue("out") ?? join(ROOT, "tools", "track-bias.current.json");
  if (!existsSync(resultsPath)) throw new Error(`Result file not found: ${resultsPath}`);
  if (!existsSync(signalsPath)) throw new Error(`Published signal snapshot not found: ${signalsPath}`);
  const snapshot = buildSnapshot({
    liveResults: readJson(resultsPath),
    publishedSignals: readJson(signalsPath),
    sourceDate,
    targetDate,
  });
  writeFileSync(outPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(JSON.stringify({ out: outPath, profiles: snapshot.profiles.length }, null, 2));
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();

export { buildProfile, buildSnapshot, classifyPosition, popularityOutperformance };
