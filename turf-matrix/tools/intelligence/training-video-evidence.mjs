import { createHash } from "node:crypto";

const text = (value) => typeof value === "string" && value.trim().length > 0;
const date = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value ?? "") &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const key = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, "");
const array = (value) => Array.isArray(value) ? value : [];

// Collection requirements, not validated thresholds for predicting race performance.
export const VIDEO_DIMENSIONS = Object.freeze({
  relativePosition: { label: "併走馬との前後関係", minFrames: 3, minSpan: 2, maxGap: 1, views: ["side", "oblique"], visibility: ["target", "companion"] },
  response: { label: "促してからの変化", minFrames: 12, minSpan: 3, maxGap: 0.3, views: ["side", "oblique"], visibility: ["target", "rider"] },
  rhythm: { label: "走りのリズム", minFrames: 24, minSpan: 3, maxGap: 0.15, views: ["side"], visibility: ["target", "legs"] },
  straightness: { label: "進路の安定", minFrames: 12, minSpan: 3, maxGap: 0.3, views: ["front", "rear"], visibility: ["target", "courseLine"] },
  finish: { label: "終点までの動き", minFrames: 12, minSpan: 3, maxGap: 0.3, views: ["side", "oblique"], visibility: ["target", "legs"] },
  balance: { label: "姿勢の変化", minFrames: 24, minSpan: 3, maxGap: 0.15, views: ["side", "front", "rear"], visibility: ["target", "body", "legs"] },
});

const FINDINGS = {
  relative_gain: ["relativePosition", "観察区間では、併走馬に対して前へ出る幅が広がっている。"],
  relative_maintained: ["relativePosition", "観察区間では、併走馬との前後関係をおおむね保っている。"],
  relative_loss: ["relativePosition", "観察区間では、併走馬に対して後ろへ下がっている。"],
  movement_after_cue: ["response", "促す動作の後に、走り方の変化が観察される。速さや能力の優劣とは分けて扱う。"],
  rhythm_maintained: ["rhythm", "観察区間では、反復する脚運びのリズムがおおむね保たれている。"],
  rhythm_changed: ["rhythm", "観察区間で脚運びのリズムに変化がある。原因は映像だけでは確定しない。"],
  path_stable: ["straightness", "確認できるコースの線に対し、大きな進路の変化は観察されない。"],
  path_changed: ["straightness", "確認できるコースの線に対し、進路の変化が観察される。"],
  finish_maintained: ["finish", "確認できた調教の終点まで、走りのリズムをおおむね保っている。余力の断定はしない。"],
  posture_stable: ["balance", "観察区間では、姿勢に大きな崩れは観察されない。健康状態の診断ではない。"],
  posture_changed: ["balance", "観察区間で姿勢の変化が観察される。故障や疲労の判定には使わない。"],
};

export function videoEvidenceDigest(review) {
  const { verification, ...evidence } = review ?? {};
  return createHash("sha256").update(JSON.stringify(evidence)).digest("hex");
}

function sourceValid(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ["regist.prc.jp", "prc.jp"].includes(url.hostname) && !url.username && !url.password;
  } catch { return false; }
}

function segmentIssues(segment, dimension) {
  const rule = VIDEO_DIMENSIONS[dimension];
  const frames = array(segment?.frames);
  const issues = [];
  if (!segment || !text(segment.id)) return ["segment_missing"];
  if (segment.sameShot !== true) issues.push("camera_cut_or_unknown");
  if (!rule.views.includes(segment.view)) issues.push("camera_angle_unsuitable");
  if (frames.length < rule.minFrames) issues.push("too_few_frames");
  const times = frames.map((frame) => frame?.time);
  if (times.some((time) => typeof time !== "number" || !Number.isFinite(time) || time < 0) ||
      times.some((time, i) => i > 0 && time <= times[i - 1])) issues.push("invalid_frame_times");
  if (frames.some((frame) => frame?.observed !== true || !text(frame?.note) || !text(frame?.reference))) issues.push("unobserved_or_untraceable_frame");
  if (frames.some((frame) => rule.visibility.some((part) => frame?.visible?.[part] !== true))) issues.push("required_parts_not_visible");
  if (!issues.includes("invalid_frame_times")) {
    if (times.length < 2 || times.at(-1) - times[0] < rule.minSpan) issues.push("interval_too_short");
    if (times.some((time, i) => i > 0 && time - times[i - 1] > rule.maxGap)) issues.push("sampling_too_sparse");
  }
  if (dimension === "response") {
    const cue = segment.cue;
    if (!cue || !Number.isFinite(cue.time) || !text(cue.description) ||
        !(times[0] < cue.time && cue.time < times.at(-1))) issues.push("cue_before_and_after_missing");
    if (!text(segment.effortContext)) issues.push("effort_context_missing");
  }
  if (dimension === "finish" && segment.finishPointVerified !== true) issues.push("finish_point_unknown");
  return issues;
}

export function diagnoseTrainingVideo(review = {}) {
  if (!review || typeof review !== "object" || Array.isArray(review)) review = {};
  const issues = [];
  if (review.schemaVersion !== 2) issues.push("legacy_or_unknown_schema");
  if (!text(review.horseName) || !date(review.raceDate) || !date(review.videoDate) || review.videoDate > review.raceDate) issues.push("invalid_identity_or_date");
  if (!sourceValid(review.sourceUrl)) issues.push("source_missing");
  if (review.identity?.verified !== true || !text(review.identity?.evidence) || !text(review.observer)) issues.push("identity_unverified");
  if (!Number.isFinite(Date.parse(review.observedAt)) ||
      !date(review.videoDate) || Date.parse(review.observedAt) < Date.parse(`${review.videoDate}T00:00:00+09:00`)) issues.push("observation_time_invalid");
  const segments = array(review.segments);
  if (!Number.isFinite(review.durationSeconds) || review.durationSeconds <= 0) issues.push("video_duration_missing");
  if (segments.some((segment) => array(segment?.frames).some((frame) => frame?.time > review.durationSeconds))) issues.push("frame_outside_video");
  if (new Set(segments.map((segment) => segment?.id)).size !== segments.length) issues.push("duplicate_segment_id");
  const dimensions = Object.entries(VIDEO_DIMENSIONS).map(([dimension, rule]) => {
    const claims = array(review.findings).filter((finding) => FINDINGS[finding?.code]?.[0] === dimension);
    const candidates = claims.map((claim) => {
      const segment = segments.find((item) => item?.id === claim.segmentId);
      const reasons = [...issues, ...segmentIssues(segment, dimension)];
      if (!text(claim.rationale) || !array(claim.limitations).length || !claim.limitations.every(text)) reasons.push("reason_or_limitations_missing");
      return { claim, segment, reasons };
    });
    const supported = candidates.filter((candidate) => candidate.reasons.length === 0);
    const conflict = new Set(supported.map(({ claim }) => claim.code)).size > 1;
    const chosen = conflict ? null : supported[0];
    return {
      dimension, label: rule.label,
      status: chosen ? "provisional_observation" : "insufficient",
      summary: chosen ? FINDINGS[chosen.claim.code][1] : "この項目を判断できる映像根拠が不足している。",
      evidence: chosen ? { segmentId: chosen.segment.id, from: chosen.segment.frames[0].time, to: chosen.segment.frames.at(-1).time, frameCount: chosen.segment.frames.length, rationale: chosen.claim.rationale } : null,
      limitations: chosen ? chosen.claim.limitations : [],
      reasons: chosen ? [] : [...new Set(conflict ? ["conflicting_findings"] : candidates.length ? candidates.flatMap((candidate) => candidate.reasons) : ["not_observed"])],
      nextCapture: { minFrames: rule.minFrames, minSpanSeconds: rule.minSpan, maxGapSeconds: rule.maxGap, views: rule.views, visibleParts: rule.visibility },
    };
  });
  if (array(review.findings).some((finding) => !FINDINGS[finding?.code])) issues.push("unknown_finding");
  return {
    horseName: review.horseName ?? null, videoDate: review.videoDate ?? null,
    status: issues.length ? "invalid" : dimensions.some((item) => item.status === "provisional_observation") ? "provisional" : "insufficient",
    issues, dimensions, scoreAdjustment: 0,
    assessment: "映像の観察記録に基づく暫定所見。仕上がりの総合評価・医学的診断・本番採点ではない。",
  };
}

export function eligibleVideoReview(review, horse, policy = {}) {
  if (!review || key(review.horseName) !== key(horse.horseName ?? horse.name ?? horse.currentRace?.horseName) || review.raceDate !== horse.currentRace?.raceDate) return null;
  const diagnosis = diagnoseTrainingVideo(review);
  const verification = review.verification;
  const raceStart = Date.parse(`${review.raceDate}T00:00:00+09:00`);
  const checkedAt = Date.parse(verification?.checkedAt);
  // Approval is tied to the exact evidence. Existing prose-only records fail closed.
  if (diagnosis.status !== "provisional" || review.status !== "approved" ||
      policy.scoringEnabled !== true || policy.adoption?.status !== "passed" || !text(policy.adoption?.report) ||
      verification?.status !== "passed" || verification?.independent !== true ||
      !text(verification?.reviewer) || verification.reviewer === review.observer || !text(verification?.report) ||
      verification?.evidenceDigest !== videoEvidenceDigest(review) || !Number.isFinite(checkedAt) ||
      checkedAt < Date.parse(review.observedAt) || checkedAt >= raceStart ||
      typeof review.adjustment !== "number" || !Number.isFinite(review.adjustment) ||
      typeof policy.maxAdjustment !== "number" || !Number.isFinite(policy.maxAdjustment) || policy.maxAdjustment < 0) return null;
  const limit = Math.min(2, policy.maxAdjustment);
  return { ...review, adjustment: Math.max(-limit, Math.min(limit, review.adjustment)),
    source: "JRA Racing Viewer", dimensions: diagnosis.dimensions.filter((item) => item.status === "provisional_observation").map((item) => item.dimension),
    note: diagnosis.dimensions.filter((item) => item.status === "provisional_observation").map((item) => item.summary).join(" ") };
}
