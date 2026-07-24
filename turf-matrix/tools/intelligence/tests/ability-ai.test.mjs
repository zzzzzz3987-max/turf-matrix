import assert from "node:assert/strict";
import test from "node:test";
import { calculateAbilityProfile } from "../ability-ai.mjs";

const run = (overrides = {}) => ({
  raceName: "条件戦",
  grade: null,
  distance: 1600,
  fieldSize: 16,
  finishPosition: 6,
  margin: 0.8,
  last3F: 35.2,
  popularity: 5,
  ...overrides,
});

const horse = (pastRuns, overrides = {}) => ({
  horseName: "TEST",
  currentRace: { distance: 1600 },
  pastRuns,
  peerRuns: [],
  ...overrides,
});

test("Ability specialist rewards proven graded performance", () => {
  const graded = calculateAbilityProfile(horse([
    run({ raceName: "重賞", grade: "G3", finishPosition: 2, margin: 0.1, last3F: 33.9, popularity: 6 }),
    run({ raceName: "Listed", grade: "L", finishPosition: 3, margin: 0.3, last3F: 34.1 }),
    run({ finishPosition: 1, margin: 0 }),
  ]));
  const ordinary = calculateAbilityProfile(horse([
    run({ finishPosition: 7, margin: 1.1 }),
    run({ finishPosition: 9, margin: 1.5 }),
    run({ finishPosition: 6, margin: 0.9 }),
  ]));

  assert.ok(graded.score > ordinary.score);
  assert.ok(graded.opponentScore > ordinary.relationScore);
});

test("Ability specialist keeps shallow-career horses distinct", () => {
  const winner = calculateAbilityProfile(horse([
    run({ finishPosition: 1, margin: 0, last3F: 33.8, popularity: 4 }),
  ]));
  const narrowLoser = calculateAbilityProfile(horse([
    run({ finishPosition: 5, margin: 0.6, last3F: 35.0, popularity: 2 }),
  ]));

  assert.notEqual(winner.score, narrowLoser.score);
  assert.equal(winner.confidence, "low");
  assert.equal(narrowLoser.confidence, "low");
});

test("Ability specialist reports confidence without changing score by a hard cap", () => {
  const oneRun = calculateAbilityProfile(horse([run({ finishPosition: 1, margin: 0 })]));
  const twoRuns = calculateAbilityProfile(horse([
    run({ finishPosition: 1, margin: 0 }),
    run({ finishPosition: 2, margin: 0.2 }),
  ]));
  const sixRuns = calculateAbilityProfile(horse(Array.from({ length: 6 }, (_, index) =>
    run({ finishPosition: index % 3 + 1, margin: index * 0.1 }),
  )));

  assert.equal(oneRun.confidence, "low");
  assert.equal(twoRuns.confidence, "mid");
  assert.equal(sixRuns.confidence, "high");
  assert.ok(new Set([oneRun.score, twoRuns.score, sixRuns.score]).size > 1);
});

test("direct peer superiority contributes independently from class", () => {
  const baseRuns = [
    run({ raceName: "条件戦", finishPosition: 2, margin: 0.2 }),
    run({ raceName: "条件戦", finishPosition: 4, margin: 0.5 }),
    run({ raceName: "条件戦", finishPosition: 3, margin: 0.4 }),
  ];
  const withPeers = calculateAbilityProfile(horse(baseRuns, {
    peerRuns: [{
      finishPosition: 2,
      peers: [
        { horseName: "A", finishPosition: 5 },
        { horseName: "B", finishPosition: 7 },
      ],
    }],
  }));
  const withoutPeers = calculateAbilityProfile(horse(baseRuns));

  assert.ok(withPeers.peerScore > 60);
  assert.ok(withPeers.score >= withoutPeers.score);
});

test("tracked opponent careers contribute without replacing direct evidence", () => {
  const baseRuns = [
    run({ raceName: "条件戦", finishPosition: 2, margin: 0.2 }),
    run({ raceName: "条件戦", finishPosition: 4, margin: 0.5 }),
    run({ raceName: "条件戦", finishPosition: 3, margin: 0.4 }),
  ];
  const strongOpponents = calculateAbilityProfile(horse(baseRuns, {
    opponentEvidence: {
      score: 82,
      status: "active",
      encounterCount: 3,
      profiledPeerCount: 24,
    },
  }));
  const unknownOpponents = calculateAbilityProfile(horse(baseRuns));

  assert.equal(strongOpponents.careerOpponentScore, 82);
  assert.ok(strongOpponents.relationScore > unknownOpponents.relationScore);
  assert.ok(strongOpponents.score > unknownOpponents.score);
});
