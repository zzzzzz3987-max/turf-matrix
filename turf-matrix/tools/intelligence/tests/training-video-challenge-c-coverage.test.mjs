import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { diagnoseTrainingVideo, eligibleVideoReview } from "../training-video-evidence.mjs";
import { buildTrainingVideoDiagnosis } from "../training-video-diagnosis.mjs";

const directory = new URL("../../../data/shadow/training-video-v2/", import.meta.url);
const records = readdirSync(directory).filter((name) => name.startsWith("2026-09-12-") && name.endsWith(".json"))
  .map((name) => JSON.parse(readFileSync(new URL(name, directory), "utf8")));
const names = [
  "フィーリウス", "ジーティーダーリン", "センツブラッド", "ガイアメンテ",
  "ピースワンデュック", "カネフラ", "ジーティーアダマン", "カラマティアノス",
  "マテンロウゲイル", "タガノデュード", "マリアイリダータ", "レーゼドラマ",
  "グランヴィノス", "ミッキーゴールド", "ジョバンニ", "マテンロウスカイ",
];
const options = { asOf: "2026-09-11T13:06:46Z" };
const horse = (name) => ({ horseName: name, currentRace: { raceDate: "2026-09-12" } });

test("Challenge C observation inventory covers all 16 runners with traceable samples", () => {
  assert.deepEqual([...new Set(records.map((record) => record.horseName))].sort(), [...names].sort());
  assert.equal(records.length, 17);
  for (const record of records) {
    assert.notEqual(diagnoseTrainingVideo(record).status, "invalid", record.horseName);
    assert.ok(record.segments.length > 0);
    for (const segment of record.segments) {
      assert.ok(segment.frames.length >= 3);
      assert.ok(segment.frames.every((frame, index, frames) => frame.observed === true &&
        frame.reference && frame.note && frame.time >= 0 && frame.time <= record.durationSeconds &&
        (index === 0 || frame.time > frames[index - 1].time)));
    }
    assert.equal(record.adjustment, 0);
    assert.equal(eligibleVideoReview(record, horse(record.horseName), { scoringEnabled: true }), null);
  }
});

test("turf footage cannot borrow a wood or slope clock on the same day", () => {
  const record = records.find((item) => item.horseName === "ジーティーダーリン");
  const times = record.overlay.times;
  const profile = { sessions: ["wood", "slope"].map((type) => ({
    type, date: "20260909", f4: times["4F"], f3: times["3F"], f1: times["1F"],
  })) };
  const result = buildTrainingVideoDiagnosis(horse(record.horseName), profile, [record], options);
  assert.equal(result.clips[0].clock.reason, "training_type_unknown");
  assert.equal(result.status, "needs_review");
  assert.equal(result.scoreAdjustment, 0);
});

test("Kanefra remains a one-week observation and cannot imply final footage was reviewed", () => {
  const record = records.find((item) => item.horseName === "カネフラ");
  assert.equal(record.videoDate, "2026-09-03");
  assert.equal(record.phase, "oneWeek");
  const result = buildTrainingVideoDiagnosis(horse(record.horseName), { sessions: [] }, [record], options);
  assert.equal(result.clips.length, 1);
  assert.equal(result.clips[0].phase, "oneWeek");
  assert.equal(result.phaseComparison.status, "insufficient");
  assert.equal(result.scoreAdjustment, 0);
});

test("occluded Maria footage remains a documented hold, not a positive finding", () => {
  const record = records.find((item) => item.horseName === "マリアイリダータ");
  assert.ok(record.segments[0].frames.some((frame) => frame.visible.target === false));
  const result = diagnoseTrainingVideo(record);
  assert.equal(result.status, "insufficient");
  assert.ok(result.dimensions.every((item) => item.status === "insufficient"));
  assert.ok(record.reviewNotes.length > 0);
});
