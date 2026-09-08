import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildPedigreeRaceEvidence } from "../../../src/lib/pedigree-race-evidence.js";
import { findPedigreeStudyProfile, PEDIGREE_STUDY_PROFILES } from "../../../src/data/pedigree-study-profiles.js";
import { auditPedigreeStudyCoverage } from "../../analyze/audit-pedigree-study-coverage.mjs";

const run = (changes = {}) => ({ date: "2026-08-15", course: "札幌", surface: "芝", distance: 1800, finishPosition: 2, fieldSize: 12, ...changes });
const horse = (pastRuns = []) => ({
  currentRace: { raceDate: "2026-09-06", course: "札幌", surface: "芝", distance: 1800 },
  pastRuns,
  analysis: { pedigree: { identity: { sire: "キングカメハメハ", broodmareSire: "グラスワンダー" } } },
});

test("reading is exact-name matched for both parents, never inferred from an ancestor", () => {
  assert.ok(findPedigreeStudyProfile("＊King Kamehameha"));
  assert.equal(findPedigreeStudyProfile("ドゥラメンテ"), null);
  assert.equal(findPedigreeStudyProfile(""), null);
  const result = buildPedigreeRaceEvidence(horse());
  assert.deepEqual(result.reading.map((item) => item.role), ["父", "母父"]);
  const unknown = horse();
  unknown.analysis.pedigree.identity = { sire: "ドゥラメンテ", sireSire: "キングカメハメハ" };
  assert.equal(buildPedigreeRaceEvidence(unknown).reading.length, 0);
  assert.ok(PEDIGREE_STUDY_PROFILES.every((profile) => profile.source.startsWith("https://note.com/") && !("score" in profile)));
});

test("exact distance, nearby distance and other surfaces are never pooled", () => {
  const result = buildPedigreeRaceEvidence(horse([
    run(), run({ date: "2026-07-15", distance: 1700 }),
    run({ date: "2026-06-15", surface: "ダート" }),
    run({ date: "2026-05-15", distance: 2100 }),
  ]));
  assert.match(result.evidence[0].text, /1走、3着以内1回/);
  assert.match(result.evidence.find((item) => item.label.includes("近い距離")).text, /1走、3着以内1回/);
  assert.match(result.caution, /1走だけ/);
  assert.doesNotMatch(JSON.stringify(result), /ダート1800|2100m/);
});

test("future, same-day, invalid-date, duplicate and unfinished records are excluded", () => {
  const result = buildPedigreeRaceEvidence(horse([
    run(), run(), run({ date: "20260815" }),
    run({ date: "2026-09-06" }), run({ date: "2026-09-07" }),
    run({ date: "2026-02-30" }), run({ date: null }),
    run({ date: "2026-07-01", finishPosition: null }),
    run({ date: "2026-07-02", finishPosition: 99 }),
    run({ date: "2026-07-03", finishPosition: 0 }),
  ]));
  assert.match(result.evidence[0].text, /^1走、3着以内1回/);
});

test("confirmed finish overrides preliminary finish and failures are not hidden", () => {
  const result = buildPedigreeRaceEvidence(horse([run({ finishPosition: 2, confirmedFinishPosition: 4 })]));
  assert.match(result.evidence[0].text, /3着以内0回.*4着/);
  assert.match(result.conclusion, /3着以内なし/);
});

test("untried distance is not a negative verdict and absent conditions are not invented", () => {
  const result = buildPedigreeRaceEvidence(horse([run({ distance: 1700 })]));
  assert.match(result.conclusion, /完走実績は手元の過去走にありません/);
  assert.doesNotMatch(result.conclusion, /不向き|苦手|減点/);
  const missing = horse([run()]);
  missing.currentRace.raceDate = null;
  assert.equal(buildPedigreeRaceEvidence(missing).evidence.length, 0);
  assert.match(buildPedigreeRaceEvidence(missing).conclusion, /比較は保留/);
  assert.equal(buildPedigreeRaceEvidence({}), null);
});

test("course and going subsets require matching surface and exact distance", () => {
  const input = horse([
    run({ trackCondition: "良" }),
    run({ date: "2026-07-15", course: "東京", trackCondition: "稍重" }),
    run({ date: "2026-06-15", trackCondition: "良", distance: 1600 }),
  ]);
  input.currentRace.going = "良";
  const result = buildPedigreeRaceEvidence(input);
  assert.match(result.evidence.find((item) => item.label.includes("札幌")).text, /^1走/);
  assert.match(result.evidence.find((item) => item.label.includes("良馬場")).text, /^1走/);
});

test("all published runners remain unchanged, including scores and ordering", () => {
  const source = JSON.parse(readFileSync(new URL("../../week-data.json", import.meta.url), "utf8"));
  const before = JSON.stringify(source);
  const results = source.races.flatMap((race) => race.horses.map((runner) => buildPedigreeRaceEvidence(runner)));
  assert.ok(results.some((result) => result?.reading.length));
  assert.ok(results.some((result) => result?.evidence.length));
  assert.equal(JSON.stringify(source), before);
  assert.ok(results.filter(Boolean).every((result) => !/Confidence|Evidence|参照|TARGET/.test(JSON.stringify(result))));
});

test("expanded profiles have distinct identities and retain source links", () => {
  assert.equal(PEDIGREE_STUDY_PROFILES.length, 50);
  for (const profile of PEDIGREE_STUDY_PROFILES) {
    for (const name of profile.names) assert.equal(findPedigreeStudyProfile(name), profile);
    assert.ok(profile.tendency.length > 10);
    assert.match(profile.source, /^https:\/\/note\.com\/keibaotaku\/n\/n[a-f0-9]+$/);
  }
  assert.equal(findPedigreeStudyProfile("Giant’s Causeway"), findPedigreeStudyProfile("Giant's Causeway"));
  assert.equal(findPedigreeStudyProfile("Henny Hughes"), findPedigreeStudyProfile("ヘニーヒューズ"));
  assert.notEqual(findPedigreeStudyProfile("ブラックタイド").tendency, findPedigreeStudyProfile("ディープインパクト").tendency);
  assert.notEqual(findPedigreeStudyProfile("キングカメハメハ").tendency, findPedigreeStudyProfile("ロードカナロア").tendency);
});

test("all indexed parents in current publication are covered without claiming full coverage", () => {
  const source = JSON.parse(readFileSync(new URL("../../week-data.json", import.meta.url), "utf8"));
  const index = JSON.parse(readFileSync(new URL("../../../data/research/pedigree-study-index.json", import.meta.url), "utf8"));
  const before = JSON.stringify(source);
  const audit = auditPedigreeStudyCoverage(source, index);
  assert.equal(audit.summary.indexedNotReviewedNames, 0);
  assert.ok(audit.summary.notInIndexNames > 0);
  assert.ok(audit.summary.eitherParentCovered > audit.summary.bothParentsCovered);
  assert.equal(audit.summary.sireCovered + audit.summary.broodmareSireCovered,
    audit.summary.eitherParentCovered + audit.summary.bothParentsCovered);
  assert.equal(JSON.stringify(source), before);
});

test("coverage distinguishes unknown identity, unreviewed entry and absent entry", () => {
  const sample = {
    races: [{ horses: [
      { analysis: { pedigree: { identity: { sire: "資料にだけある父", broodmareSire: "目次外の母父" } } } },
      { analysis: { pedigree: { identity: { sire: "キズナ" } } } },
    ] }],
  };
  const audit = auditPedigreeStudyCoverage(sample, { names: [["資料にだけある父"], ["キズナ"]] });
  assert.equal(audit.summary.indexedNotReviewedNames, 1);
  assert.equal(audit.summary.notInIndexNames, 1);
  assert.equal(audit.summary.missingIdentitySides, 1);
  assert.equal(audit.summary.eitherParentCovered, 1);
  assert.equal(audit.summary.bothParentsCovered, 0);
});

test("new notes use a public default question and separate maternal interpretation", () => {
  const input = horse([run()]);
  input.analysis.pedigree.identity = { sire: "キズナ", broodmareSire: "ディープインパクト" };
  const result = buildPedigreeRaceEvidence(input);
  assert.match(result.reading[0].question, /距離・コース実績/);
  assert.match(result.reading[1].question, /母父に入った場合も同じ効果があるとは限らず/);
});
