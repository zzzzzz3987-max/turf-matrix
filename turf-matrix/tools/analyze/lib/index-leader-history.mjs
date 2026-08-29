import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { indexRanking } from "../../race-signal-selection.mjs";
import { buildComparisonInput, isFiniteScore } from "./index-leader-comparator.mjs";

const readJson = (path) => JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
const normalizeName = (value) => String(value ?? "")
  .normalize("NFKC")
  .replace(/[\s\u3000]/g, "")
  .replace(/^[*＊$＄]+/, "");

const resultFor = (horse, resultRace) => {
  const expectedNumber = Number(horse.number ?? horse.horseNumber);
  const expectedName = normalizeName(horse.name ?? horse.horseName);
  const result = (resultRace?.horses ?? []).find((item) => Number(item.horseNumber) === expectedNumber);
  return result && normalizeName(result.horseName) === expectedName && isFiniteScore(result.finishPosition)
    ? result
    : null;
};

export const resolveArchivePairs = (archiveDir) => readdirSync(archiveDir)
  .map((fileName) => fileName.match(/^(\d{4}-\d{2}-\d{2})-preodds\.json$/)?.[1])
  .filter(Boolean)
  .sort()
  .map((date) => ({
    date,
    snapshotPath: join(archiveDir, `${date}-preodds.json`),
    resultsPath: join(archiveDir, `${date}-results.json`),
  }))
  .filter((pair) => existsSync(pair.resultsPath));

export const collectHistoricalComparisons = (archivePairs) => {
  const rows = [];
  let skipped = 0;
  for (const pair of archivePairs) {
    const snapshot = readJson(pair.snapshotPath);
    const results = readJson(pair.resultsPath);
    const resultsByRace = new Map((results.races ?? []).map((race) => [race.bundleId, race]));
    for (const race of snapshot.races ?? []) {
      const ranked = indexRanking(race);
      const leader = ranked[0];
      const second = ranked[1];
      const resultRace = resultsByRace.get(race.bundleId);
      if (!leader || !second || !resultRace) {
        skipped += 1;
        continue;
      }
      const leaderResult = resultFor(leader, resultRace);
      const secondResult = resultFor(second, resultRace);
      if (!leaderResult || !secondResult) {
        skipped += 1;
        continue;
      }
      const comparison = buildComparisonInput(leader, second);
      rows.push({
        date: pair.date,
        bundleId: race.bundleId,
        raceName: race.name,
        category: race.category,
        surface: race.surface,
        ...comparison,
        leader: {
          number: leader.number,
          name: leader.name,
          tmIndex: leader.tmIndex,
          finish: Number(leaderResult.finishPosition),
        },
        second: {
          number: second.number,
          name: second.name,
          tmIndex: second.tmIndex,
          finish: Number(secondResult.finishPosition),
        },
        secondAhead: Number(secondResult.finishPosition) < Number(leaderResult.finishPosition) ? 1 : 0,
      });
    }
  }
  return { rows, skipped };
};
