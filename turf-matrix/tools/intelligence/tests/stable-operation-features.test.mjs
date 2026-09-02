import assert from "node:assert/strict";
import test from "node:test";
import {
  affiliationLabel,
  rotationBucket,
  stableOperationSnapshot,
  travelClass,
} from "../stable-operation-features.mjs";

test("JV-Link affiliation codes map to the correct training centers", () => {
  assert.equal(affiliationLabel("1"), "美浦");
  assert.equal(affiliationLabel("2"), "栗東");
  assert.equal(affiliationLabel("3"), null);
});

test("travel classification separates home, cross-region, and Hokkaido trips", () => {
  assert.equal(travelClass({ affiliationCode: "1", courseCode: "05" }), "home");
  assert.equal(travelClass({ affiliationCode: "1", courseCode: "09" }), "away");
  assert.equal(travelClass({ affiliationCode: "2", courseCode: "09" }), "home");
  assert.equal(travelClass({ affiliationCode: "2", courseCode: "01" }), "away");
});

test("rotation buckets preserve the operational intervals", () => {
  assert.equal(rotationBucket(7), "0-7");
  assert.equal(rotationBucket(8), "8-20");
  assert.equal(rotationBucket(42), "21-42");
  assert.equal(rotationBucket(90), "43-90");
  assert.equal(rotationBucket(91), "91+");
  assert.equal(rotationBucket(-1), null);
});

test("stable operation snapshot only uses a strictly earlier run", () => {
  const snapshot = stableOperationSnapshot({
    trainer: "検証太郎",
    stableSide: "美浦",
    jockey: "現騎手",
    currentRace: { raceDate: "2026-09-06", course: "阪神" },
    pastRuns: [
      { date: "2026-09-07", trainer: "未来厩舎", jockey: "未来騎手" },
      { date: "2026-08-23", trainer: "検証太郎", jockey: "現騎手" },
      { date: "2026-08-02", trainer: "検証太郎", jockey: "別騎手" },
    ],
  });
  assert.equal(snapshot.previousRaceDate, "2026-08-23");
  assert.equal(snapshot.intervalDays, 14);
  assert.equal(snapshot.rotationBucket, "8-20");
  assert.equal(snapshot.jockeyContinuity, true);
  assert.equal(snapshot.sameTrainer, true);
  assert.equal(snapshot.travelClass, "away");
});
