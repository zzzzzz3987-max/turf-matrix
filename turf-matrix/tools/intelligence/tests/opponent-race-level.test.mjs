import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateOpponentRaceLevel,
  combineRaceLevelRelation,
  evaluateEncounter,
} from "../opponent-race-level.mjs";

const target = (overrides = {}) => ({
  bloodRegistrationNumber: "TARGET",
  raceKey: "R1",
  raceDate: "2026-01-01",
  finishPosition: 2,
  margin: 0.2,
  fieldSize: 12,
  ...overrides,
});

const peer = (id, finishPosition = 3) => ({ bloodRegistrationNumber: id, horseName: id, finishPosition });

const fixture = ({ gradeCode = "", targetRun = target(), laterDate = "2026-01-10" } = {}) => {
  const field = [targetRun, peer("P1"), peer("P2", 8)];
  const raceByKey = new Map([
    [targetRun.raceKey, { raceKey: targetRun.raceKey, raceDate: targetRun.raceDate, gradeCode, fieldSize: 12 }],
    ["L1", { raceKey: "L1", raceDate: laterDate, gradeCode: "", fieldSize: 10 }],
  ]);
  const runsByHorse = new Map([
    ["P1", [{ bloodRegistrationNumber: "P1", raceKey: "L1", raceDate: laterDate, finishPosition: 1 }]],
    ["P2", [{ bloodRegistrationNumber: "P2", raceKey: "L1", raceDate: laterDate, finishPosition: 9 }]],
  ]);
  return { field, raceByKey, runsByHorse };
};

test("strong graded close loss outranks weak general-race win", () => {
  const strongRun = target({ raceKey: "G1", finishPosition: 4, margin: 0.2 });
  const weakRun = target({ raceKey: "W1", finishPosition: 1, margin: 0 });
  const strong = fixture({ gradeCode: "A", targetRun: strongRun });
  const weak = fixture({ gradeCode: "", targetRun: weakRun });
  const strongScore = evaluateEncounter({ targetRun: strongRun, ...strong, evaluationDate: "20260201" }).score;
  const weakScore = evaluateEncounter({ targetRun: weakRun, ...weak, evaluationDate: "20260201" }).score;
  assert.ok(strongScore > weakScore, `${strongScore} should exceed ${weakScore}`);
});

test("results on or after evaluation day never leak into the score", () => {
  const before = fixture({ laterDate: "2026-02-01" });
  const after = fixture({ laterDate: "2026-02-02" });
  const input = { horseId: "TARGET", targetRuns: [target()], evaluationDate: "20260201" };
  const scoreBefore = calculateOpponentRaceLevel({ ...input, fieldsByRace: new Map([["R1", before.field]]), ...before });
  const scoreAfter = calculateOpponentRaceLevel({ ...input, fieldsByRace: new Map([["R1", after.field]]), ...after });
  assert.equal(scoreBefore.score, null);
  assert.equal(scoreAfter.score, null);
});

test("odds and popularity do not affect opponent race level", () => {
  const base = fixture();
  const changed = structuredClone(base.field);
  changed.forEach((runner, index) => {
    runner.odds = index ? 999 : 1.1;
    runner.popularity = changed.length - index;
  });
  const args = { targetRun: target(), runsByHorse: base.runsByHorse, raceByKey: base.raceByKey, evaluationDate: "20260201" };
  assert.deepEqual(
    evaluateEncounter({ ...args, field: base.field }),
    evaluateEncounter({ ...args, field: changed }),
  );
});

test("one later run is shrunk toward neutral", () => {
  const data = fixture();
  const encounter = evaluateEncounter({ targetRun: target(), ...data, evaluationDate: "20260201" });
  const bestPeer = encounter.peers.find((item) => item.horseId === "P1");
  assert.ok(bestPeer.score > 50 && bestPeer.score < 70);
});

test("missing history returns an explicit missing result", () => {
  const run = target();
  const result = calculateOpponentRaceLevel({
    horseId: "TARGET",
    targetRuns: [run],
    fieldsByRace: new Map([["R1", [run, peer("P1")]]]),
    evaluationDate: "20260201",
  });
  assert.equal(result.status, "missing");
  assert.equal(result.score, null);
});

test("same input is deterministic", () => {
  const data = fixture();
  const args = {
    horseId: "TARGET",
    targetRuns: [target()],
    fieldsByRace: new Map([["R1", data.field]]),
    runsByHorse: data.runsByHorse,
    raceByKey: data.raceByKey,
    evaluationDate: "20260201",
  };
  assert.deepEqual(calculateOpponentRaceLevel(args), calculateOpponentRaceLevel(args));
});

test("race level refines rather than replaces the legacy relation score", () => {
  assert.equal(combineRaceLevelRelation(70, 50), 64);
  assert.equal(combineRaceLevelRelation(70, null), 70);
  assert.equal(combineRaceLevelRelation(null, 60), 60);
});
