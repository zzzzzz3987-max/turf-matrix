import test from "node:test";
import assert from "node:assert/strict";
import { buildProfile, classifyPosition } from "../../analyze/build-track-bias-snapshot.mjs";

test("fourth-corner groups use field-relative thresholds", () => {
  assert.equal(classifyPosition(3, 12), "front");
  assert.equal(classifyPosition(6, 12), "middle");
  assert.equal(classifyPosition(9, 12), "rear");
});

test("profile activation requires races, no rear placings, front wins, and popularity support", () => {
  const races = Array.from({ length: 4 }, () => ({
    horses: [
      { finish: 1, popularity: 2, group: "front" },
      { finish: 2, popularity: 3, group: "front" },
      { finish: 3, popularity: 4, group: "middle" },
      { finish: 4, popularity: 1, group: "rear" },
    ],
  }));
  const profile = buildProfile({ track: "新潟", surface: "ダート", races });

  assert.equal(profile.status, "active");
  assert.equal(profile.strength, "moderate");
  assert.equal(profile.sample.rearTop3Count, 0);
});
