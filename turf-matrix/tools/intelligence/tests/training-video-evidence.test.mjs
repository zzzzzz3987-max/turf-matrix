import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { diagnoseTrainingVideo, eligibleVideoReview, videoEvidenceDigest } from "../training-video-evidence.mjs";

const require = createRequire(import.meta.url);
const legacy = require("../../../data/master/training-video-reviews.json");
const pilot = require("../../../data/shadow/training-video-v2/2026-09-12-matenro-gale.json");
const horse = { horseName: "TEST", currentRace: { raceDate: "2026-09-12" } };
const policy = { scoringEnabled: true, maxAdjustment: 2, adoption: { status: "passed", report: "test-only-independent-evaluation" } };
function fixture() {
  return {
    schemaVersion: 2, horseName: "TEST", raceDate: "2026-09-12", videoDate: "2026-09-09",
    durationSeconds: 10,
    sourceUrl: "https://regist.prc.jp/api/windowopen.aspx?target=training/test", observer: "observer-a",
    observedAt: "2026-09-10T00:00:00Z", identity: { verified: true, evidence: "test saddlecloth and overlay" },
    status: "provisional", adjustment: 0,
    segments: [{ id: "s1", sameShot: true, view: "side", frames: [0, 0.5, 1, 1.5, 2].map((time) => ({
      time, observed: true, reference: `test frame ${time}`, note: "test visible positions", visible: { target: true, companion: true },
    })) }],
    findings: [{ code: "relative_gain", segmentId: "s1", rationale: "test target moves forward relative to companion", limitations: ["speed not measured"] }],
  };
}
function approve(review) {
  review.status = "approved";
  review.adjustment = 20;
  review.verification = { status: "passed", independent: true, reviewer: "reviewer-b", report: "test-only-review",
    checkedAt: "2026-09-11T00:00:00Z", evidenceDigest: videoEvidenceDigest(review) };
  return review;
}
const first = (review) => diagnoseTrainingVideo(review).dimensions[0];

test("sufficient relative-position evidence produces a provisional finding, not a performance grade", () => {
  const result = diagnoseTrainingVideo(fixture());
  assert.equal(result.status, "provisional");
  assert.equal(result.scoreAdjustment, 0);
  assert.equal(result.dimensions[0].status, "provisional_observation");
  assert.equal(result.dimensions.filter((item) => item.status === "insufficient").length, 5);
  assert.equal(eligibleVideoReview(fixture(), horse, policy), null);
});

test("sparse stills cannot become rhythm or response diagnosis", () => {
  const review = fixture();
  review.findings.push({ ...review.findings[0], code: "rhythm_maintained" }, { ...review.findings[0], code: "movement_after_cue" });
  const result = diagnoseTrainingVideo(review);
  assert.ok(result.dimensions.find((item) => item.dimension === "rhythm").reasons.includes("sampling_too_sparse"));
  assert.ok(result.dimensions.find((item) => item.dimension === "response").reasons.includes("cue_before_and_after_missing"));
});

test("dense annotated sequences support each dimension only with its required context", () => {
  const codes = ["relative_gain", "movement_after_cue", "rhythm_maintained", "path_stable", "finish_maintained", "posture_stable"];
  const review = fixture();
  review.segments = codes.map((code, i) => ({
    id: `s${i}`, sameShot: true, view: code === "path_stable" ? "front" : "side",
    cue: { time: 2, description: "test visible rider cue" }, effortContext: "test documented instructions",
    finishPointVerified: true,
    frames: Array.from({ length: 41 }, (_, frame) => ({ time: frame / 10, observed: true,
      reference: `synthetic ${i}:${frame}`, note: "synthetic observation, not actual footage",
      visible: { target: true, companion: true, rider: true, legs: true, body: true, courseLine: true } })),
  }));
  review.findings = codes.map((code, i) => ({ code, segmentId: `s${i}`, rationale: "synthetic observed sequence", limitations: ["synthetic test only"] }));
  assert.ok(diagnoseTrainingVideo(review).dimensions.every((item) => item.status === "provisional_observation"));
  review.segments[4].finishPointVerified = false;
  const finish = diagnoseTrainingVideo(review).dimensions.find((item) => item.dimension === "finish");
  assert.equal(finish.status, "insufficient");
  assert.ok(finish.reasons.includes("finish_point_unknown"));
});

for (const [name, mutate, reason] of [
  ["duplicate timestamps", (r) => { r.segments[0].frames[1].time = 0; }, "invalid_frame_times"],
  ["invalid timestamps", (r) => { r.segments[0].frames[1].time = NaN; }, "invalid_frame_times"],
  ["outside-video timestamp", (r) => { r.segments[0].frames[4].time = 11; }, "frame_outside_video"],
  ["unseen frame", (r) => { r.segments[0].frames[1].observed = false; }, "unobserved_or_untraceable_frame"],
  ["missing reference", (r) => { delete r.segments[0].frames[1].reference; }, "unobserved_or_untraceable_frame"],
  ["occluded companion", (r) => { r.segments[0].frames[1].visible.companion = false; }, "required_parts_not_visible"],
  ["camera cut", (r) => { r.segments[0].sameShot = false; }, "camera_cut_or_unknown"],
  ["wrong angle", (r) => { r.segments[0].view = "front"; }, "camera_angle_unsuitable"],
  ["missing rationale", (r) => { r.findings[0].rationale = ""; }, "reason_or_limitations_missing"],
  ["unconfirmed horse", (r) => { r.identity.verified = false; }, "identity_unverified"],
  ["future workout", (r) => { r.videoDate = "2026-09-13"; }, "invalid_identity_or_date"],
  ["duplicate segment", (r) => { r.segments.push(structuredClone(r.segments[0])); }, "duplicate_segment_id"],
]) {
  test(`${name} prevents supported diagnosis`, () => {
    const review = fixture(); mutate(review);
    assert.equal(first(review).status, "insufficient");
    assert.ok(first(review).reasons.includes(reason));
  });
}

test("unknown and contradictory findings do not silently pass", () => {
  const review = fixture();
  review.findings.push({ ...review.findings[0], code: "relative_loss" });
  assert.equal(first(review).status, "insufficient");
  assert.ok(first(review).reasons.includes("conflicting_findings"));
  review.findings.push({ code: "healthy_and_will_win" });
  assert.equal(diagnoseTrainingVideo(review).status, "invalid");
});

test("scoring requires explicit adoption, independent review and evidence-bound approval", () => {
  const review = approve(fixture());
  assert.equal(eligibleVideoReview(review, horse, policy).adjustment, 2);
  assert.equal(eligibleVideoReview(review, horse, { ...policy, scoringEnabled: false }), null);
  assert.equal(eligibleVideoReview(review, horse, { ...policy, adoption: {} }), null);
  assert.equal(eligibleVideoReview(review, horse, { ...policy, maxAdjustment: NaN }), null);
  assert.equal(eligibleVideoReview(review, horse, { ...policy, maxAdjustment: 20 }).adjustment, 2);
  const changed = structuredClone(review);
  changed.segments[0].frames[0].note = "changed evidence";
  assert.equal(eligibleVideoReview(changed, horse, policy), null);
  review.verification.reviewer = review.observer;
  assert.equal(eligibleVideoReview(review, horse, policy), null);
});

test("approval after race-day cutoff or before observation cannot score", () => {
  for (const checkedAt of ["2026-09-12T00:00:00+09:00", "2026-09-09T00:00:00Z", "invalid"]) {
    const review = approve(fixture());
    review.verification.checkedAt = checkedAt;
    assert.equal(eligibleVideoReview(review, horse, policy), null);
  }
});

test("exact horse and date are required and negative adjustments are bounded", () => {
  const review = approve(fixture());
  review.adjustment = -20;
  review.verification.evidenceDigest = videoEvidenceDigest(review);
  assert.equal(eligibleVideoReview(review, horse, policy).adjustment, -2);
  assert.equal(eligibleVideoReview(review, { ...horse, horseName: "OTHER" }, policy), null);
  assert.equal(eligibleVideoReview(review, { ...horse, currentRace: { raceDate: "2026-09-13" } }, policy), null);
});

test("all legacy prose-only records are retained but cannot affect training scores", () => {
  assert.ok(legacy.reviews.length > 0);
  for (const review of legacy.reviews) {
    assert.equal(eligibleVideoReview(review, { horseName: review.horseName, currentRace: { raceDate: review.raceDate } }, policy), null);
  }
});

test("real pilot only supports relative position and stays outside production", () => {
  const result = diagnoseTrainingVideo(pilot);
  assert.equal(result.status, "provisional");
  assert.equal(result.dimensions.filter((item) => item.status === "provisional_observation").length, 1);
  assert.equal(result.dimensions[0].evidence.frameCount, 7);
  assert.equal(eligibleVideoReview(pilot, { horseName: pilot.horseName, currentRace: { raceDate: pilot.raceDate } }, policy), null);
});
