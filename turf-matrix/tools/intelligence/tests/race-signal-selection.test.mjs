import test from "node:test";
import assert from "node:assert/strict";
import { evidenceOpponent, indexRanking, leaderState, valueWatch } from "../../race-signal-selection.mjs";

const horse = (number, tmIndex, factors, ev, marketGap = 0) => ({
  id: String(number),
  number,
  name: `馬${number}`,
  tmIndex,
  analysis: {
    factorsDetail: {
      ability: { score: factors[0] },
      form: { score: factors[1] },
      training: { score: factors[2] },
      pace: { score: factors[3] },
      value: { ev, marketGap },
    },
  },
});

test("opponent two comes from index ranks three to five by combined evidence", () => {
  const race = { horses: [
    horse(1, 85, [80, 80, 80, 80], 0.5),
    horse(2, 82, [78, 78, 78, 78], 0.8),
    horse(3, 79, [70, 70, 70, 70], 1.2),
    horse(4, 78, [82, 81, 79, 80], 1.1),
    horse(5, 77, [75, 75, 75, 75], 2.5),
    horse(6, 60, [99, 99, 99, 99], 2.9, 8),
  ] };

  const selected = evidenceOpponent(race);
  assert.equal(selected.horse.number, 4);
  assert.equal(selected.profile.score, 80.5);
});

test("high EV alone is separated as a value watch and never becomes opponent two", () => {
  const race = { horses: [
    horse(1, 85, [80, 80, 80, 80], 0.5),
    horse(2, 82, [78, 78, 78, 78], 0.8),
    horse(3, 79, [80, 80, 80, 80], 1.2),
    horse(4, 78, [75, 75, 75, 75], 1.1),
    horse(5, 77, [74, 74, 74, 74], 1.0),
    horse(6, 60, [55, 55, 55, 55], 2.9, 8),
  ] };

  assert.equal(evidenceOpponent(race).horse.number, 3);
  assert.equal(valueWatch(race, new Set(["1", "2", "3"])).number, 6);
});

test("a leader needs a three-point gap to be treated as clear", () => {
  const closeRace = { horses: [
    horse(1, 81, [80, 80, 80, 80], 0.5),
    horse(2, 79, [78, 78, 78, 78], 0.8),
  ] };
  const clearRace = { horses: [
    horse(1, 81, [80, 80, 80, 80], 0.5),
    horse(2, 78, [78, 78, 78, 78], 0.8),
  ] };

  assert.equal(leaderState(closeRace).status, "contested");
  assert.equal(leaderState(closeRace).contenders.length, 2);
  assert.equal(leaderState(clearRace).status, "clear");
});

test("equal top scores are treated as tied rather than merely contested", () => {
  const tiedRace = { horses: [
    horse(1, 81, [80, 80, 80, 80], 0.5),
    horse(2, 81, [78, 78, 78, 78], 0.8),
    horse(3, 77, [77, 77, 77, 77], 1.0),
  ] };

  assert.equal(leaderState(tiedRace).status, "tied");
  assert.equal(leaderState(tiedRace).contenders.length, 2);
});

test("a runner absent from published win odds is excluded from race signals", () => {
  const withdrawn = { ...horse(2, 90, [90, 90, 90, 90], 0.5), odds: null };
  const active = [
    { ...horse(1, 81, [80, 80, 80, 80], 0.5), odds: 2.4 },
    { ...horse(3, 79, [78, 78, 78, 78], 0.8), odds: 4.8 },
  ];

  assert.deepEqual(indexRanking({ horses: [active[0], withdrawn, active[1]] }).map((entry) => entry.number), [1, 3]);
  assert.equal(leaderState({ horses: [active[0], withdrawn, active[1]] }).leader.number, 1);
});
