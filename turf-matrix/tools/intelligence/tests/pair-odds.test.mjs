import test from "node:test";
import assert from "node:assert/strict";
import { buildPairOddsIndex, pairOddsFor } from "../../pair-odds.mjs";

const payload = {
  RaceDate: "2026-09-05",
  Source: "JV-Link pair odds",
  Races: [
    {
      Race: { CourseName: "阪神", RaceNo: 11 },
      Type: "quinella",
      UpdatedAt: "2026-09-05T15:28",
      Status: "active",
      Entries: [{ HorseNumbers: [3, 4], MinOdds: 8.6, MaxOdds: 8.6, Popularity: 4 }],
    },
    {
      Race: { CourseName: "阪神", RaceNo: 11 },
      Type: "wide",
      UpdatedAt: "2026-09-05T15:28",
      Status: "active",
      Entries: [{ HorseNumbers: [4, 13], MinOdds: 3.2, MaxOdds: 3.8, Popularity: 7 }],
    },
  ],
};

test("JV-Link pair odds preserve quinella and wide market shapes", () => {
  const index = buildPairOddsIndex(payload);
  assert.deepEqual(pairOddsFor(index, { track: "阪神", raceNo: 11, type: "quinella", first: 4, second: 3 }), {
    type: "quinella",
    numbers: [3, 4],
    minOdds: 8.6,
    maxOdds: 8.6,
    popularity: 4,
    updatedAt: "2026-09-05T15:28",
    source: "JV-Link pair odds",
    status: "active",
  });
  assert.equal(pairOddsFor(index, { track: "阪神", raceNo: 11, type: "wide", first: 13, second: 4 }).maxOdds, 3.8);
});

test("a different race or unsupported ticket type never cross-joins", () => {
  const index = buildPairOddsIndex(payload);
  assert.equal(pairOddsFor(index, { track: "阪神", raceNo: 10, type: "wide", first: 4, second: 13 }), null);
  assert.equal(pairOddsFor(index, { track: "阪神", raceNo: 11, type: "exacta", first: 4, second: 13 }), null);
});

test("no-vote pair odds stay unavailable instead of becoming zero odds", () => {
  const index = buildPairOddsIndex({
    ...payload,
    Races: [{
      ...payload.Races[0],
      Entries: [{ HorseNumbers: [1, 2], MinOdds: null, MaxOdds: null, Popularity: 55 }],
    }],
  });
  const odds = pairOddsFor(index, { track: "阪神", raceNo: 11, type: "quinella", first: 1, second: 2 });
  assert.equal(odds.minOdds, null);
  assert.equal(odds.maxOdds, null);
});
