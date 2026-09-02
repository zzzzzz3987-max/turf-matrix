import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregateBattleRows,
  evaluateBattleSelection,
  resultForBattleHorse,
  sameBattleSelection,
} from "../../analyze/lib/battle-race-shadow.mjs";

const selection = {
  date: "2026-09-05",
  raceId: "race-1",
  bundleId: "bundle-1",
  track: "阪神",
  raceNumber: 11,
  axis: { number: 4, name: "本命" },
  opponents: [{ number: 3, name: "相手一" }, { number: 8, name: "相手二" }],
};
const resultRace = {
  horses: [
    { horseNumber: 4, horseName: "本命", finishPosition: 1, winPayout: 320, placePayout: 150 },
    { horseNumber: 3, horseName: "相手一", finishPosition: 4, winPayout: 0, placePayout: 0 },
    { horseNumber: 8, horseName: "相手二", finishPosition: 3, winPayout: 0, placePayout: 190 },
  ],
};

test("battle evaluation joins by horse number and normalized name", () => {
  assert.equal(resultForBattleHorse({ number: 4, name: " 本命 " }, resultRace).finishPosition, 1);
  assert.equal(resultForBattleHorse({ number: 4, name: "別馬" }, resultRace), null);
});

test("battle evaluation measures axis and opponent simultaneous top-three", () => {
  const row = evaluateBattleSelection(selection, new Map([["bundle-1", resultRace]]));
  assert.equal(row.axisWin, true);
  assert.equal(row.pair1Hit, false);
  assert.equal(row.pair2Hit, true);
  const aggregate = aggregateBattleRows([row]);
  assert.equal(aggregate.wins, 1);
  assert.equal(aggregate.places, 1);
  assert.equal(aggregate.pair1Hits, 0);
  assert.equal(aggregate.pair2Hits, 1);
  assert.equal(aggregate.winReturnRate, 320);
  assert.equal(aggregate.placeReturnRate, 150);
});

test("selection change includes race and axis identity", () => {
  assert.equal(sameBattleSelection(selection, { ...selection }), true);
  assert.equal(sameBattleSelection(selection, { ...selection, raceId: "race-2" }), false);
  assert.equal(sameBattleSelection(selection, { ...selection, axis: { number: 5, name: "別本命" } }), false);
});
