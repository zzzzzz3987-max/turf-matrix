import { diagnoseTrainingVideo, videoEvidenceDigest } from "./training-video-evidence.mjs";

const key = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, "");
const isoDate = (value) => {
  const raw = String(value ?? "");
  const date = /^\d{8}$/.test(raw) ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6)}` : raw;
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) &&
    new Date(date).toISOString().slice(0, 10) === date ? date : null;
};
const stamp = (value) => typeof value === "string" && isoDate(value.slice(0, 10)) &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? Date.parse(value) : NaN;
const phaseOf = (videoDate, raceDate) => {
  const days = (Date.parse(raceDate) - Date.parse(videoDate)) / 86400000;
  return days >= 0 && days <= 4 ? "final" : days <= 12 && days > 4 ? "oneWeek" : "other";
};
const phaseLabel = (phase) => ({ final: "最終", oneWeek: "一週前", other: "中間" })[phase];

function matchClock(review, sessions) {
  const type = review.context?.trainingType;
  if (!["slope", "wood"].includes(type)) return { status: "unmatched", reason: "training_type_unknown" };
  const candidates = sessions.filter((session) => isoDate(session.date) === review.videoDate && session.type === type);
  const times = review.overlay?.times;
  if (![times?.["4F"], times?.["1F"]].every((value) => typeof value === "number" && Number.isFinite(value) && value > 0)) return { status: "unmatched", reason: "overlay_clocks_missing" };
  const splits = [["4F", "f4"], ["3F", "f3"], ["2F", "f2"], ["1F", "f1"]]
    .filter(([label]) => Object.hasOwn(times, label));
  if (splits.some(([label]) => typeof times[label] !== "number" || !Number.isFinite(times[label]) || times[label] <= 0)) {
    return { status: "unmatched", reason: "overlay_clocks_invalid" };
  }
  if (!candidates.length) return { status: "unmatched", reason: "same_date_clock_missing" };
  // A missing split cannot establish a match; a known disagreement must not be hidden by it.
  const compatible = candidates.filter((session) => splits.every(([label, field]) =>
    !Number.isFinite(session[field]) || Math.abs(session[field] - times[label]) < 0.051));
  if (!compatible.length) return { status: "conflict", reason: "clock_values_disagree" };
  const matching = compatible.filter((session) => splits.every(([, field]) => Number.isFinite(session[field]) && session[field] > 0));
  if (!matching.length) return { status: "unmatched", reason: "clock_splits_missing" };
  const signatures = new Set(matching.map((session) => JSON.stringify([session.type, session.f4, session.f3, session.f2, session.f1, session.course, session.lap])));
  if (signatures.size > 1) return { status: "unmatched", reason: "multiple_sessions_ambiguous" };
  const session = matching[0];
  return { status: "matched", date: review.videoDate, type, f4: session.f4, f1: session.f1,
    checkedSplits: splits.map(([label]) => label), source: "existing_training_clock", duplicatedPoints: false };
}

function comparePhases(clips) {
  const latest = (phase) => clips.filter((clip) => clip.phase === phase && clip.clock.status === "matched")
    .sort((a, b) => b.videoDate.localeCompare(a.videoDate))[0];
  const final = latest("final");
  const oneWeek = latest("oneWeek");
  if (!final || !oneWeek) return { status: "insufficient", reasons: ["一週前と最終の、時計と照合できた映像記録がそろっていない。"], clockDelta: null, trend: "not_established" };
  const reasons = [];
  for (const [field, label] of [["trainingType", "調教コースの種類"], ["trainingCenter", "調教場"], ["surfaceCondition", "馬場状態"], ["effort", "追い方の強度"]]) {
    const left = oneWeek.context?.[field];
    const right = final.context?.[field];
    if (!left || !right || left === "unknown" || right === "unknown") reasons.push(`${label}が未確認のため、単純比較しない。`);
    else if (left !== right) reasons.push(`${label}が異なるため、時計の差を状態の変化とみなさない。`);
  }
  return { status: reasons.length ? "conditions_differ_or_unknown" : "clock_comparison_only", reasons,
    oneWeekDate: oneWeek.videoDate, finalDate: final.videoDate,
    clockDelta: reasons.length ? null : { f4: Number((final.clock.f4 - oneWeek.clock.f4).toFixed(1)), f1: Number((final.clock.f1 - oneWeek.clock.f1).toFixed(1)) },
    trend: "not_established", summary: "調教の狙いと撮影条件を含むため、時計・映像だけで仕上がりの上昇や下降を断定しない。" };
}

export function buildTrainingVideoDiagnosis(horse, profile, records, { asOf } = {}) {
  const cutoff = stamp(asOf);
  const raceDate = isoDate(horse.currentRace?.raceDate);
  if (!Number.isFinite(cutoff) || !raceDate) throw new Error("Video diagnosis requires a valid race date and an explicit timezone-aware asOf timestamp.");
  const raceStart = Date.parse(`${raceDate}T00:00:00+09:00`);
  const relevant = records.filter((review) => review && key(review.horseName) === key(horse.horseName ?? horse.name) && review.raceDate === raceDate);
  const clips = [];
  const excluded = [];
  const used = new Set();
  for (const review of relevant) {
    const digest = videoEvidenceDigest(review);
    if (used.has(digest)) continue;
    used.add(digest);
    const observedAt = stamp(review.observedAt);
    if (!Number.isFinite(observedAt) || observedAt > cutoff || observedAt >= raceStart) {
      excluded.push({ videoDate: review.videoDate, reason: "observation_not_available_before_cutoff" });
      continue;
    }
    const diagnosis = diagnoseTrainingVideo(review);
    if (diagnosis.status === "invalid") {
      excluded.push({ videoDate: review.videoDate, reason: "invalid_video_evidence", details: diagnosis.issues });
      continue;
    }
    const phase = phaseOf(review.videoDate, raceDate);
    if (review.phase !== phase) {
      excluded.push({ videoDate: review.videoDate, reason: "phase_date_mismatch" });
      continue;
    }
    const conflicts = relevant.filter((other) => other !== review && other.videoDate === review.videoDate &&
      other.sourceUrl === review.sourceUrl && stamp(other.observedAt) <= cutoff && stamp(other.observedAt) < raceStart && videoEvidenceDigest(other) !== digest);
    if (conflicts.length) {
      excluded.push({ videoDate: review.videoDate, reason: "conflicting_review_versions" });
      continue;
    }
    const clock = matchClock(review, profile.sessions ?? []);
    if (clock.status === "conflict") {
      excluded.push({ videoDate: review.videoDate, reason: clock.reason });
      continue;
    }
    const findings = diagnosis.dimensions.filter((item) => item.status === "provisional_observation");
    clips.push({ videoDate: review.videoDate, phase, phaseLabel: phaseLabel(phase), sourceUrl: review.sourceUrl,
      context: review.context ?? {}, evidenceDigest: digest, clock, reviewNotes: review.reviewNotes ?? [],
      status: findings.length && clock.status === "matched" ? "provisional" : "needs_review",
      findings, pending: diagnosis.dimensions.filter((item) => item.status === "insufficient"),
      observationMethod: "sampled_browser_frames", independentReview: review.verification?.status === "passed" && review.verification?.independent === true ? "recorded_not_revalidated_here" : "pending" });
  }
  clips.sort((a, b) => a.videoDate.localeCompare(b.videoDate));
  const matched = clips.filter((clip) => clip.status === "provisional");
  const observations = matched.flatMap((clip) => clip.findings.map((finding) => `${clip.phaseLabel}（${clip.videoDate}）：${finding.summary}`));
  return { horseName: horse.horseName ?? horse.name, raceDate, asOf,
    status: matched.length ? "provisional" : clips.length || excluded.length ? "needs_review" : "not_reviewed",
    summary: observations.length ? observations.join(" ") : clips.length
      ? "映像の観察記録はあるが、所見の確定に必要な視認性または時計照合が不足。時計評価とは分けて診断を保留する。"
      : "診断に使える映像の観察記録はまだない。時計評価とは分けて保留する。",
    clips, excluded, phaseComparison: comparePhases(matched),
    supportedDimensions: [...new Set(matched.flatMap((clip) => clip.findings.map((finding) => finding.dimension)))],
    scoreAdjustment: 0, productionEligible: false,
    limits: ["抜粋画像の観察に基づく暫定所見であり、動画全体の自動診断ではない。", "健康状態・余力・仕上がりの総合判定は未検証。", "時計と映像に同じ根拠を重複加点しない。"] };
}
