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

test("missing margin and ZI behave like absent values, not zero", () => {
  const baseline = calculateAbilityProfile(horse([run({ margin: undefined })]));
  for (const value of [null, "", " ", false]) {
    const profile = calculateAbilityProfile(horse([run({ margin: value })], { availableIndex: value }));
    assert.equal(profile.marginScore, baseline.marginScore);
    assert.equal(profile.ziScore, null);
    assert.equal(profile.score, baseline.score);
  }
});

test("missing opponent scores use relation evidence instead of a zero score", () => {
  const profile = (value) => calculateAbilityProfile(horse([run()], { opponentEvidence: {
    encounters: [{ finishPosition: 2, peers: [{ finishPosition: 5, evidenceScore: value, qualityScore: value }] }],
  } }));
  for (const value of [null, "", " ", false]) assert.equal(profile(value).encounterScore, profile(undefined).encounterScore);
  assert.equal(profile(undefined).encounterScore, 78);
});

test("unknown and non-finishing positions are not ability or direct-peer wins", () => {
  for (const value of [null, "", 0, -1, false]) {
    const profile = calculateAbilityProfile(horse([run({ finishPosition: value })], {
      peerRuns: [{ finishPosition: value, peers: [{ finishPosition: 5 }] }],
      opponentEvidence: { encounters: [{ finishPosition: 2, peers: [{ finishPosition: value }] }] },
    }));
    assert.equal(profile.runCount, 0);
    assert.equal(profile.peerScore, null);
    assert.equal(profile.encounterScore, null);
  }
});

test("Unicode grade notation matches ASCII grade notation", () => {
  for (const [ascii, unicode] of [["GI", "GⅠ"], ["GII", "GⅡ"], ["GIII", "GⅢ"]]) {
    assert.equal(calculateAbilityProfile(horse([run({ grade: ascii })])).score,
      calculateAbilityProfile(horse([run({ grade: unicode })])).score);
  }
});

test("relation contributions reproduce the actual score with missing sources excluded", () => {
  const profile = calculateAbilityProfile(horse([run({ grade: "G3" })], {
    opponentEvidence: { score: 80 },
  }));
  const trace = profile.relationEvidence;
  assert.equal(trace.scope, "relation-score");
  assert.equal(trace.fallback, null);
  assert.ok(Math.abs(trace.components.reduce((sum, item) => sum + item.contribution, 0) - trace.rawScore) < 1e-10);
  assert.equal(Math.round(trace.rawScore), profile.relationScore);
  assert.equal(trace.components.find(item => item.key === "direct-peers").share, 0);
  assert.equal(trace.independentEvidenceSources, false);
});

test("relation trace explicitly distinguishes fallback from opponent evidence", () => {
  const profile = calculateAbilityProfile(horse([run()]));
  assert.equal(profile.relationEvidence.fallback, "recent-ability");
  assert.equal(profile.relationEvidence.rawScore, profile.recentScore);
  assert.ok(profile.relationEvidence.components.every(item => item.share === 0));
});

test("encounter trace preserves the actual opponent race and score source", () => {
  const profile = calculateAbilityProfile(horse([run()], { opponentEvidence: { encounters: [{
    raceKey: "sample", raceDate: "20260101", raceName: "テスト重賞", finishPosition: 3,
    peers: [{ horseName: "相手A", finishPosition: 1, qualityScore: 80, laterStarts: 3 },
      { horseName: "相手B", finishPosition: 5 }],
  }] } }));
  const [a, b] = profile.relationEvidence.encounters;
  assert.equal(a.horseName, "相手A");
  assert.equal(a.raceKey, "sample");
  assert.equal(a.relation, "lost");
  assert.equal(a.source, "quality-and-result");
  assert.equal(b.source, "result-only");
  assert.equal(b.relation, "beat");
  assert.equal(Math.round(a.value * a.share + b.value * b.share), profile.encounterScore);
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

test("historical co-runner results contribute without TARGET ZI", () => {
  const profile = calculateAbilityProfile(horse([
    run({ finishPosition: 2, margin: 0.2 }),
    run({ finishPosition: 4, margin: 0.5 }),
  ], {
    opponentEvidence: {
      score: 68,
      encounters: [{
        finishPosition: 2,
        peers: [
          { horseName: "A", finishPosition: 5, laterStarts: 2 },
          { horseName: "B", finishPosition: 1, laterStarts: 1 },
        ],
      }],
    },
  }));

  assert.equal(profile.ziScore, null);
  assert.ok(Number.isFinite(profile.encounterScore));
  assert.ok(Number.isFinite(profile.relationScore));
});

test("later opponent quality differentiates otherwise identical encounters", () => {
  const baseRuns = [run({ finishPosition: 2, margin: 0.2 }), run({ finishPosition: 3, margin: 0.4 })];
  const evidence = (evidenceScore) => ({
    score: 65,
    encounters: [{
      finishPosition: 2,
      peers: [{ horseName: "A", finishPosition: 3, laterStarts: 5, qualityScore: evidenceScore, evidenceScore }],
    }],
  });
  const strong = calculateAbilityProfile(horse(baseRuns, { opponentEvidence: evidence(82) }));
  const weak = calculateAbilityProfile(horse(baseRuns, { opponentEvidence: evidence(44) }));
  assert.ok(strong.encounterScore > weak.encounterScore);
  assert.ok(strong.score > weak.score);
});
