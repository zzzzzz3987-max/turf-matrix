import assert from "node:assert/strict";
import test from "node:test";
import { buildTrainingProfile } from "../training-ai.mjs";
import {
  filterTrainingBefore,
  trainingHistoryFor,
  trainingHistoryManifest,
  trainingHistoryShardId,
} from "../training-history.mjs";

test("training history is generated without result or market data", () => {
  assert.equal(trainingHistoryManifest.policy.resultDataUsed, false);
  assert.equal(trainingHistoryManifest.policy.popularityOddsUsed, false);
  assert.ok(trainingHistoryManifest.recordCount >= 1000);
  assert.ok(trainingHistoryManifest.sessionCount >= 10000);
});

test("training history excludes sessions on or after the evaluation date", () => {
  const filtered = filterTrainingBefore({
    slope: [{ date: "20260829" }, { date: "20260830" }, { date: "20260831" }],
    wood: [{ date: "2026-08-28" }, { date: "2026-08-30" }],
  }, "2026-08-30");
  assert.deepEqual(filtered.slope.map((item) => item.date), ["20260829"]);
  assert.deepEqual(filtered.wood.map((item) => item.date), ["2026-08-28"]);
});

test("training history shard selection is deterministic", () => {
  assert.equal(trainingHistoryShardId(" ピコシー "), trainingHistoryShardId("ピコシー"));
});

test("historical sessions support comparison but never replace missing current work", () => {
  const horse = {
    horseName: "ピコシー",
    currentRace: { raceDate: "2026-09-01", stableSide: "美浦" },
    training: { slope: [], wood: [] },
    pastRuns: [],
  };
  const history = trainingHistoryFor(horse);
  const profile = buildTrainingProfile(horse);
  assert.ok(history.slope.length + history.wood.length > 0);
  assert.equal(profile.status, "missing");
  assert.equal(profile.score, 60);
  assert.ok(profile.historySessionCount > 0);
});
