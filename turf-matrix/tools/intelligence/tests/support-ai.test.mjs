import assert from "node:assert/strict";
import test from "node:test";
import { buildStableAnalysis } from "../support-ai.mjs";

test("Stable AI scores only a learned pattern, not unvalidated rotation, rider, or travel heuristics", () => {
  const result = buildStableAnalysis({
    trainer: "テスト調教師",
    stableSide: "栗東",
    jockey: "継続騎手",
    currentRace: {
      raceDate: "2026-08-29",
      course: "新潟",
      trainer: "テスト調教師",
      stableSide: "栗東",
      jockey: "継続騎手",
    },
    pastRuns: [
      { date: "2026-08-15", jockey: "継続騎手" },
      { date: "2026-06-01", jockey: "別騎手" },
    ],
  }, {
    phaseRepresentatives: { final: {}, oneWeek: {} },
    stablePattern: {
      status: "照合済",
      degree: 0.75,
      text: "勝負調教パターンへの合致度75%（複勝率40.0%、n=20）",
    },
  });

  assert.equal(result.status, "active");
  assert.equal(result.confidence, "high");
  assert.equal(result.rotation.adjustment, 0);
  assert.equal(result.jockey.adjustment, 0);
  assert.equal(result.travel.adjustment, 0);
  assert.equal(result.stablePattern.adjustment, 2);
  assert.equal(result.score, 72);
  assert.match(result.summary, /合致度75%/);
  assert.match(result.summary, /加点していません/);
  assert.ok(result.evidence.some((item) => item.includes("休養明け2戦目")));
  assert.ok(result.evidence.some((item) => item.includes("前走から継続")));
  assert.ok(result.evidence.includes("最終・一週前追い切りを取得済み"));
  assert.ok(result.evidence.some((item) => item.includes("合致度75%")));
});

test("Stable AI does not expose an unregistered-pattern message", () => {
  const result = buildStableAnalysis({
    currentRace: {
      raceDate: "2026-08-29",
      course: "札幌",
      trainer: "テスト調教師",
      stableSide: "美浦",
      jockey: "今回騎手",
    },
    pastRuns: [{ date: "2026-08-09", jockey: "前走騎手" }],
  }, {
    stablePattern: {
      status: "DB未登録",
      degree: 0,
      text: "テスト調教師厩舎の勝負調教パターンは学習待ちです。",
    },
  });

  assert.equal(result.stablePattern.label, null);
  assert.equal(result.travel.isAway, true);
  assert.equal(result.summary.includes("未登録"), false);
  assert.equal(result.summary.includes("学習待ち"), false);
  assert.match(result.summary, /今回は陣営面の加点なし/);
  assert.ok(result.evidence.some((item) => item.includes("乗り替わり")));
  assert.equal(result.jockey.adjustment, 0);
  assert.equal(result.travel.adjustment, 0);
});

test("Stable AI remains explicit when trainer data is unavailable", () => {
  const result = buildStableAnalysis({ currentRace: { raceDate: "2026-08-29", course: "新潟" }, pastRuns: [] });

  assert.equal(result.status, "missing");
  assert.equal(result.confidence, "low");
  assert.equal(result.score, 58);
});
