import test from "node:test";
import assert from "node:assert/strict";
import { evidenceOpponent, valueWatch } from "../../race-signal-selection.mjs";

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
