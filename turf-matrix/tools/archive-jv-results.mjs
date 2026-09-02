import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const LIVE_RESULTS = join(ROOT, "data", "target", "results.latest.json");
const COURSE_SLUG = { "01": "sapporo", "04": "niigata", "07": "chukyo" };

const readJson = (path) => JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
const normalizeName = (value) => String(value ?? "")
  .normalize("NFKC")
  .replace(/[\s　*＊$＄]/g, "");
const num = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
const pct = (value) => Number((value * 100).toFixed(1));

if (!existsSync(LIVE_RESULTS)) throw new Error(`JV-Link result file not found: ${LIVE_RESULTS}`);
const live = readJson(LIVE_RESULTS);
const date = live.RaceDate;
const snapshotPath = join(ROOT, "data", "archive", `${date}-preodds.json`);
if (!existsSync(snapshotPath)) throw new Error(`Publication snapshot not found: ${snapshotPath}`);
const snapshot = readJson(snapshotPath);

const resultRaceByBundle = new Map((live.Races ?? []).map((race) => {
  const slug = COURSE_SLUG[race.Race?.CourseCode];
  if (!slug) throw new Error(`Unsupported JV-Link course code: ${race.Race?.CourseCode}`);
  return [`${date}-${slug}-${String(race.Race.RaceNo).padStart(2, "0")}R`, race];
}));

const pairPayoutsFor = (resultRace, type) => (resultRace.Payouts ?? [])
  .filter((entry) => entry.Type === type && Array.isArray(entry.HorseNumbers) && entry.HorseNumbers.length === 2)
  .map((entry) => ({ numbers: entry.HorseNumbers.map(Number), payout: entry.Payout, popularity: entry.Popularity }));

const archiveRaces = [];
const reviewRaces = [];

const attachResult = (snapshotHorse, resultRace) => {
  const horseNumber = Number(snapshotHorse.number);
  const resultHorse = resultRace.Horses.find((horse) => Number(horse.HorseNumber) === horseNumber);
  if (!resultHorse) throw new Error(`${resultRace.Race.CourseCode}${resultRace.Race.RaceNo}R horse ${horseNumber}: result missing`);
  if (normalizeName(resultHorse.HorseName) !== normalizeName(snapshotHorse.name)) {
    throw new Error(`${resultRace.Race.CourseCode}${resultRace.Race.RaceNo}R horse ${horseNumber}: name mismatch (${snapshotHorse.name} / ${resultHorse.HorseName})`);
  }
  const winPayout = resultRace.Payouts.find((entry) => entry.Type === "win" && Number(entry.HorseNumber) === horseNumber)?.Payout ?? 0;
  const placePayout = resultRace.Payouts.find((entry) => entry.Type === "place" && Number(entry.HorseNumber) === horseNumber)?.Payout ?? 0;
  return {
    finishPosition: num(resultHorse.FinishPosition),
    horseNumber,
    horseName: snapshotHorse.name,
    popularity: num(resultHorse.FinalPopularity) ?? num(snapshotHorse.popularity),
    corner1: num(resultHorse.Corner1),
    corner2: num(resultHorse.Corner2),
    corner3: num(resultHorse.Corner3),
    corner4: num(resultHorse.Corner4),
    runningStyleCode: resultHorse.RunningStyleCode || null,
    winPayout,
    placePayout,
    abnormalityCode: resultHorse.AbnormalityCode || null,
  };
};

const strategySummary = (horses) => {
  const bets = horses.length;
  const winReturn = horses.reduce((sum, horse) => sum + horse.winPayout, 0);
  const placeReturn = horses.reduce((sum, horse) => sum + horse.placePayout, 0);
  return {
    bets,
    stake: bets * 100,
    winHits: horses.filter((horse) => horse.finishPosition === 1).length,
    placeHits: horses.filter((horse) => horse.finishPosition >= 1 && horse.finishPosition <= 3).length,
    winReturn,
    placeReturn,
    winReturnRate: bets ? pct(winReturn / (bets * 100)) : 0,
    placeReturnRate: bets ? pct(placeReturn / (bets * 100)) : 0,
  };
};

for (const race of snapshot.races ?? []) {
  const resultRace = resultRaceByBundle.get(race.bundleId);
  if (!resultRace) throw new Error(`${race.bundleId}: result race missing`);
  if ((race.horses ?? []).length !== (resultRace.Horses ?? []).length) {
    throw new Error(`${race.bundleId}: runner count mismatch (${race.horses.length} / ${resultRace.Horses.length})`);
  }

  const horses = race.horses.map((horse) => {
    const result = attachResult(horse, resultRace);
    const value = horse.analysis?.value ?? horse.analysis?.factorsDetail?.value ?? {};
    return {
      ...result,
      tmIndex: num(horse.tmIndex),
      indexRank: num(horse.analysis?.relative?.rank),
      confidence: horse.analysis?.confidence ?? null,
      odds: num(horse.odds),
      ev: num(value.ev),
      marketGap: num(value.marketGap),
      valueScore: num(value.score),
    };
  });

  const indexTop3 = [...horses]
    .filter((horse) => horse.indexRank != null)
    .sort((a, b) => a.indexRank - b.indexRank || a.horseNumber - b.horseNumber)
    .slice(0, 3);
  const evTop3 = [...horses]
    .filter((horse) => horse.ev != null)
    .sort((a, b) => b.ev - a.ev || a.indexRank - b.indexRank || a.horseNumber - b.horseNumber)
    .slice(0, 3);
  const displayedValue = [...horses]
    .filter((horse) => horse.marketGap >= 0 && horse.ev >= 1 && horse.ev < 3)
    .sort((a, b) => b.marketGap - a.marketGap || a.indexRank - b.indexRank || b.ev - a.ev || a.horseNumber - b.horseNumber);

  const quinellaPayouts = pairPayoutsFor(resultRace, "quinella");
  const widePayouts = pairPayoutsFor(resultRace, "wide");
  archiveRaces.push({
    bundleId: race.bundleId,
    track: race.track,
    raceNo: race.number,
    name: race.name,
    weather: race.weather ?? null,
    surface: race.surface ?? null,
    going: race.going ?? null,
    horses: horses.map(({ tmIndex, indexRank, confidence, odds, ev, marketGap, valueScore, ...horse }) => horse),
    payouts: {
      win: resultRace.Payouts.filter((entry) => entry.Type === "win").map((entry) => ({ number: entry.HorseNumber, payout: entry.Payout, popularity: entry.Popularity })),
      place: resultRace.Payouts.filter((entry) => entry.Type === "place").map((entry) => ({ number: entry.HorseNumber, payout: entry.Payout, popularity: entry.Popularity })),
      ...(quinellaPayouts.length ? { quinella: quinellaPayouts } : {}),
      ...(widePayouts.length ? { wide: widePayouts } : {}),
    },
  });
  reviewRaces.push({
    bundleId: race.bundleId,
    track: race.track,
    raceNo: race.number,
    raceName: race.name,
    indexTop3,
    evTop3,
    displayedValue,
    summary: {
      indexTop3: strategySummary(indexTop3),
      evTop3: strategySummary(evTop3),
      displayedValue: strategySummary(displayedValue.slice(0, 3)),
    },
  });
}

if (reviewRaces.length !== resultRaceByBundle.size) {
  throw new Error(`Race count mismatch (${reviewRaces.length} / ${resultRaceByBundle.size})`);
}

const all = (key) => reviewRaces.flatMap((race) => race[key]);
const archive = {
  date,
  source: live.Source,
  fetchedAt: live.GeneratedAt,
  races: archiveRaces,
};
const review = {
  date,
  analysisBasis: "immutable publication snapshot joined to JV-Link finalized SE/HR records",
  snapshotPath: `data/archive/${date}-preodds.json`,
  resultsPath: `data/archive/${date}-results.json`,
  summary: {
    raceCount: reviewRaces.length,
    horseCount: archiveRaces.reduce((sum, race) => sum + race.horses.length, 0),
    indexTop3: strategySummary(all("indexTop3")),
    evTop3: strategySummary(all("evTop3")),
    displayedValueTop3: strategySummary(reviewRaces.flatMap((race) => race.displayedValue.slice(0, 3))),
  },
  races: reviewRaces,
};

const resultPath = join(ROOT, "data", "archive", `${date}-results.json`);
const reviewPath = join(ROOT, "data", "archive", `${date}-review-data.json`);
writeFileSync(resultPath, `${JSON.stringify(archive, null, 2)}\n`, "utf8");
writeFileSync(reviewPath, `${JSON.stringify(review, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  status: "ready",
  date,
  raceCount: review.summary.raceCount,
  horseCount: review.summary.horseCount,
  indexTop3: review.summary.indexTop3,
  evTop3: review.summary.evTop3,
  displayedValueTop3: review.summary.displayedValueTop3,
  resultPath,
  reviewPath,
}, null, 2));
