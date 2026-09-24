import test from "node:test";
import assert from "node:assert/strict";
import { isCurrentOrFutureRaceDate, tokyoCalendarDate } from "../../release-date-guard.mjs";

test("release guard compares race dates with the Tokyo calendar date", () => {
  const beforeTokyoMidnight = new Date("2026-09-23T15:05:00.000Z");
  assert.equal(tokyoCalendarDate(beforeTokyoMidnight), "2026-09-24");
  assert.equal(isCurrentOrFutureRaceDate("2026-09-23", "2026-09-24"), false);
  assert.equal(isCurrentOrFutureRaceDate("2026-09-24", "2026-09-24"), true);
  assert.equal(isCurrentOrFutureRaceDate("2026-09-27", "2026-09-24"), true);
});

test("release guard rejects malformed dates", () => {
  assert.equal(isCurrentOrFutureRaceDate("2026-9-27", "2026-09-24"), false);
  assert.equal(isCurrentOrFutureRaceDate("2026-02-30", "2026-01-01"), false);
  assert.equal(isCurrentOrFutureRaceDate(null, "2026-09-24"), false);
});
