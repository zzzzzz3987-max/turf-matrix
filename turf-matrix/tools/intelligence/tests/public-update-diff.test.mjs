import test from "node:test";
import assert from "node:assert/strict";
import { buildPublicUpdateDiff, updateDiffForRace } from "../../../src/lib/public-update-diff.js";

const horse = ({ id, number, score, popularity, odds, value = {}, load = {} }) => ({
  id,
  number,
  name: `馬${id}`,
  tmIndex: score,
  popularity,
  odds,
  analysis: {
    factorsDetail: {
      ability: { score },
      value: { eligible: false, marketGap: 0, indexRank: null, ...value },
      load: { adjustment: 0, ...load },
    },
  },
});

const data = ({ date = "2026-09-05", updatedAt, going = "良", weather = "晴", horses }) => ({
  meta: { date, oddsUpdatedAt: updatedAt },
  races: [{
    id: `${date}-中山-9R`,
    track: "中山",
    number: 9,
    going,
    weather,
    oddsUpdatedAt: updatedAt,
    horses,
  }],
});

const previousHorses = [
  horse({ id: "a", number: 1, score: 82, popularity: 1, odds: 2.0, value: { indexRank: 1 } }),
  horse({ id: "b", number: 2, score: 80, popularity: 3, odds: 4.0, value: { indexRank: 2 } }),
  horse({ id: "c", number: 3, score: 76, popularity: 6, odds: 10.0, value: { eligible: true, marketGap: 3, indexRank: 3 } }),
  horse({ id: "d", number: 4, score: 72, popularity: 2, odds: 5.0, value: { indexRank: 4 } }),
];

const currentHorses = [
  horse({ id: "a", number: 1, score: 80, popularity: 2, odds: 3.0, value: { indexRank: 2 } }),
  horse({ id: "b", number: 2, score: 83, popularity: 1, odds: 2.5, value: { indexRank: 1 } }),
  horse({ id: "c", number: 3, score: 76, popularity: 6, odds: 10.4, value: { eligible: true, marketGap: 3, indexRank: 3 } }),
  horse({ id: "d", number: 4, score: 72, popularity: 3, odds: 5.0, value: { indexRank: 4 }, load: { adjustment: -1, relativeKg: 1 } }),
];

test("public update diff reports only real same-race changes", () => {
  const previous = data({ updatedAt: "2026-09-05T00:30:00.000Z", horses: previousHorses });
  const current = data({ updatedAt: "2026-09-05T01:00:00.000Z", going: "稍重", horses: currentHorses });
  const result = buildPublicUpdateDiff(previous, current);
  const events = result.races[0].events;

  assert.equal(result.raceDate, "2026-09-05");
  assert.equal(events[0].type, "going");
  assert.ok(events.some((event) => event.type === "role" && event.horseId === "b" && event.after === "本命"));
  assert.ok(events.some((event) => event.type === "risk_added" && event.horseId === "d" && event.after === "相対斤量重め"));
  assert.ok(events.some((event) => event.type === "popularity" && event.horseId === "a"));
  assert.ok(events.some((event) => event.type === "odds" && event.horseId === "a"));
  assert.equal(events.some((event) => event.type === "odds" && event.horseId === "c"), false);
  assert.equal(updateDiffForRace(result, current.races[0].id, current.meta.date)?.events.length, events.length);
});

test("public update diff refuses to compare different race dates", () => {
  const previous = data({ date: "2026-08-30", updatedAt: "2026-08-30T01:00:00.000Z", horses: previousHorses });
  const current = data({ updatedAt: "2026-09-05T01:00:00.000Z", horses: currentHorses });

  assert.deepEqual(buildPublicUpdateDiff(previous, current).races, []);
});

test("public update diff is deterministic and ignores unchanged snapshots", () => {
  const previous = data({ updatedAt: "2026-09-05T00:30:00.000Z", horses: previousHorses });
  const current = data({ updatedAt: "2026-09-05T01:00:00.000Z", horses: currentHorses });

  assert.deepEqual(buildPublicUpdateDiff(previous, current), buildPublicUpdateDiff(previous, current));
  assert.deepEqual(buildPublicUpdateDiff(current, current).races, []);
});

test("analysis changes are detected even when the odds timestamp is unchanged", () => {
  const timestamp = "2026-09-05T01:00:00.000Z";
  const result = buildPublicUpdateDiff(
    data({ updatedAt: timestamp, horses: previousHorses }),
    data({ updatedAt: timestamp, horses: currentHorses }),
  );

  assert.ok(result.races[0].events.some((event) => event.type === "role"));
});

test("race lookup rejects a stale public update payload", () => {
  const payload = buildPublicUpdateDiff(
    data({ updatedAt: "2026-09-05T00:30:00.000Z", horses: previousHorses }),
    data({ updatedAt: "2026-09-05T01:00:00.000Z", horses: currentHorses }),
  );

  assert.equal(updateDiffForRace(payload, "2026-09-05-中山-9R", "2026-09-06"), null);
});
