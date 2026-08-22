import assert from "node:assert/strict";
import test from "node:test";
import { buildBloodProfile } from "../blood-ai.mjs";
import { buildTrainingProfile } from "../training-ai.mjs";

const slope = (date, f4, f1, lap2 = f1 + 0.3) => ({
  date,
  "4F": f4,
  "3F": f4 - 14,
  "2F": f1 + lap2,
  "1F": f1,
  lap: { lap4: 14, lap3: 13.5, lap2, lap1: f1 },
});

const trainingHorse = (sessions) => ({
  horseName: "TEST",
  currentRace: { raceDate: "2026-07-26", stableSide: "美浦" },
  training: { slope: sessions, wood: [] },
});

test("Training specialist classifies compact JV-Link dates into race-week phases", () => {
  const profile = buildTrainingProfile(trainingHorse([
    slope("20260723", 51.2, 12.2),
    slope("20260717", 50.8, 12.1),
    slope("20260705", 49.8, 11.9),
  ]));

  assert.equal(profile.phaseRepresentatives.final.date, "20260723");
  assert.equal(profile.phaseRepresentatives.oneWeek.date, "20260717");
  assert.equal(profile.phaseRepresentatives.intermediate.date, "20260705");
  assert.equal(profile.confidence, "high");
});

test("Training specialist does not let a stale best clock dominate current preparation", () => {
  const staleOnly = buildTrainingProfile(trainingHorse([
    slope("20260610", 48.8, 11.5),
    slope("20260718", 59.8, 14.2),
  ]));
  const currentSharp = buildTrainingProfile(trainingHorse([
    slope("20260610", 48.8, 11.5),
    slope("20260718", 51.0, 12.0),
  ]));

  assert.ok(currentSharp.score > staleOnly.score);
  assert.equal(staleOnly.phaseRepresentatives.stale.date, "20260610");
  assert.equal(staleOnly.phaseRepresentatives.oneWeek.date, "20260718");
});

test("Training specialist keeps missing data explicit", () => {
  const profile = buildTrainingProfile(trainingHorse([]));
  assert.equal(profile.score, 60);
  assert.equal(profile.status, "missing");
  assert.equal(profile.confidence, "low");
});

test("Training specialist keeps an official-video review when clock data is missing", () => {
  const profile = buildTrainingProfile({
    horseName: "パンジャタワー",
    currentRace: { raceDate: "2026-08-23", stableSide: "栗東" },
    training: { slope: [], wood: [] },
  });

  assert.equal(profile.clockScore, 60);
  assert.equal(profile.videoReview?.adjustment, 2);
  assert.equal(profile.score, 62);
  assert.equal(profile.status, "partial");
  assert.equal(profile.confidence, "low");
});

test("Training specialist does not add an unlearned stable pattern", () => {
  const profile = buildTrainingProfile({
    ...trainingHorse([slope("20260718", 51.0, 12.0)]),
    currentRace: { raceDate: "2026-07-26", stableSide: "美浦", trainer: "未登録厩舎" },
  });
  assert.equal(profile.stablePattern.status, "DB未登録");
  assert.equal(profile.stablePattern.adjustment, 0);
  assert.equal(profile.score, profile.baseScore);
});

test("Training specialist applies a bounded official-video review only to the exact date and horse", () => {
  const reviewed = buildTrainingProfile({
    horseName: "レイピア",
    currentRace: { raceDate: "2026-08-09", stableSide: "栗東" },
    training: { slope: [slope("20260805", 51.9, 13.2)], wood: [] },
  });
  const otherDate = buildTrainingProfile({
    horseName: "レイピア",
    currentRace: { raceDate: "2026-08-10", stableSide: "栗東" },
    training: { slope: [slope("20260805", 51.9, 13.2)], wood: [] },
  });

  assert.equal(reviewed.videoReview?.source, "JRA Racing Viewer");
  assert.equal(reviewed.videoReview?.adjustment, 0);
  assert.equal(reviewed.score, reviewed.clockScore);
  assert.equal(otherDate.videoReview, null);
});

test("Training specialist keeps video adjustments within the declared two-point range", () => {
  const reviewed = buildTrainingProfile({
    horseName: "タマモイカロス",
    currentRace: { raceDate: "2026-08-09", stableSide: "栗東" },
    training: { slope: [slope("20260805", 51.9, 11.9)], wood: [] },
  });

  assert.equal(reviewed.videoReview?.adjustment, 2);
  assert.equal(reviewed.score - reviewed.clockScore, 2);
});

test("Training specialist compares current preparation with the same horse's top-three runs", () => {
  const profile = buildTrainingProfile({
    horseName: "比較馬",
    currentRace: { raceDate: "2026-07-26", stableSide: "美浦" },
    pastRuns: [{ raceDate: "2026-07-12", finish: 2, raceName: "比較レース" }],
    training: {
      slope: [slope("20260709", 50.0, 11.8), slope("20260723", 56.0, 13.5)],
      wood: [],
    },
  });

  assert.equal(profile.goodRunComparison.sampleSize, 1);
  assert.equal(profile.goodRunComparison.status, "partial");
  assert.ok(profile.goodRunComparison.delta < 0);
  assert.ok(profile.goodRunComparison.adjustment < 0);
});

test("Training specialist never treats an unplaced run as a good-run baseline", () => {
  const profile = buildTrainingProfile({
    horseName: "比較馬",
    currentRace: { raceDate: "2026-07-26", stableSide: "美浦" },
    pastRuns: [{ raceDate: "2026-07-12", finish: 8, raceName: "比較レース" }],
    training: {
      slope: [slope("20260709", 50.0, 11.8), slope("20260723", 56.0, 13.5)],
      wood: [],
    },
  });

  assert.equal(profile.goodRunComparison.status, "missing");
  assert.equal(profile.goodRunComparison.adjustment, 0);
});

const bloodContext = (bloodBiasIds, traits = { speed: 0.8, power: 0.65, stamina: 0.6, sustain: 0.8 }) => ({
  profile: "テスト条件",
  traits,
  bloodBiasIds,
  bloodBias: [],
  bloodFitTags: [],
});

const bloodHorse = (overrides = {}) => ({
  currentRace: { distance: 2000 },
  pedigree: {
    sire: "キングカメハメハ",
    dam: "テスト母",
    broodmareSire: "ロベルト",
    damDam: "テスト牝系",
    ancestors: [],
    ...overrides,
  },
});

test("Blood specialist changes course fit without changing the pedigree", () => {
  const aligned = buildBloodProfile(bloodHorse(), bloodContext(["kingmambo", "roberto"]));
  const unaligned = buildBloodProfile(bloodHorse(), bloodContext(["danzig"]));

  assert.ok(aligned.components.course > unaligned.components.course);
  assert.ok(aligned.score > unaligned.score);
});

test("Blood specialist measures the broodmare sire as maternal evidence", () => {
  const matched = buildBloodProfile(bloodHorse(), bloodContext(["roberto"]));
  const unknown = buildBloodProfile(bloodHorse({ broodmareSire: "未登録血統" }), bloodContext(["roberto"]));

  assert.ok(matched.coverage > unknown.coverage);
  assert.ok(matched.matches.some((match) =>
    match.hitEntries?.some((entry) => entry.role === "broodmareSire")
  ));
  assert.equal(matched.confidence, "high");
  assert.equal(unknown.confidence, "mid");
});

test("Blood specialist keeps missing pedigree neutral and explicit", () => {
  const profile = buildBloodProfile({ currentRace: { distance: 2000 } }, bloodContext(["kingmambo"]));
  assert.equal(profile.score, 65);
  assert.equal(profile.status, "missing");
  assert.equal(profile.confidence, "low");
});

test("Blood specialist exposes only sample-qualified aggregate statistics", () => {
  const profile = buildBloodProfile(
    bloodHorse({ sire: "ドレフォン", broodmareSire: "キングカメハメハ" }),
    bloodContext(["northern_dancer"])
  );
  assert.ok(profile.statistics.length >= 1);
  assert.ok(profile.statistics.every((item) => item.eligible));
  assert.ok(profile.statistics.every((item) => item.sampleSize >= 12));
  assert.ok(profile.statistics.every((item) => item.uniqueHorseCount >= 5));
});
