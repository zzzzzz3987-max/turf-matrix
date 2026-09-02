import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFrameAptitudeModel,
  relativeGateZone,
  resolveFrameAptitude,
} from "../../learn/frame-aptitude-learning.mjs";

test("relative gate position is normalized by field size", () => {
  assert.equal(relativeGateZone(1, 18), "inner");
  assert.equal(relativeGateZone(7, 18), "middle");
  assert.equal(relativeGateZone(18, 18), "outer");
  assert.equal(relativeGateZone(10, 9), null);
});

test("insufficient exact samples fall back to a supported parent context", () => {
  const model = {
    levels: {
      course_surface_distance_field: {
        minimumSampleSize: 12,
        cells: { "niigata|turf|mile|large": { baselineHitRate: 0.2, zones: { inner: { sampleSize: 3, adjustedLift: 0.1 } } } },
      },
      surface: {
        minimumSampleSize: 40,
        cells: { turf: { baselineHitRate: 0.22, zones: { inner: { sampleSize: 120, adjustedLift: 0.02 } } } },
      },
    },
  };
  const resolved = resolveFrameAptitude(model, {
    course: "niigata", surface: "turf", distanceBand: "mile", fieldSizeBand: "large", zone: "inner",
  });
  assert.equal(resolved.level, "surface");
  assert.equal(resolved.zoneStats.sampleSize, 120);
});

test("a one-race perfect outer result is shrunk toward the population mean", () => {
  const history = {
    source: "test",
    races: [{
      key: "2026-06-01-niigata-01R",
      date: "2026-06-01",
      course: "niigata",
      distance: 1600,
      trackCode: "11",
      fieldSize: 9,
      horses: Array.from({ length: 9 }, (_, index) => ({
        horseNumber: index + 1,
        finishPosition: index >= 6 ? index - 5 : index + 4,
      })),
    }],
  };
  const model = buildFrameAptitudeModel(history);
  const outer = model.levels.global.cells["*"].zones.outer;
  assert.equal(outer.hitRate, 1);
  assert.ok(outer.adjustedHitRate < 0.38);
  assert.ok(outer.adjustedLift < 0.05);
});

test("same history produces the same learned levels", () => {
  const history = {
    source: "test",
    races: [{
      key: "2026-06-01-chukyo-01R", date: "2026-06-01", course: "chukyo", distance: 1200, trackCode: "11", fieldSize: 6,
      horses: Array.from({ length: 6 }, (_, index) => ({ horseNumber: index + 1, finishPosition: index + 1 })),
    }],
  };
  assert.deepEqual(buildFrameAptitudeModel(history).levels, buildFrameAptitudeModel(history).levels);
});
