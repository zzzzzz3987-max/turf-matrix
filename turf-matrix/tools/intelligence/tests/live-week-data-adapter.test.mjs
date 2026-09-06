import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";

test("live production payload uses the same TM INDEX adapter as initial loading", async () => {
  const server = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });

  try {
    const { adaptWeekDataPayload } = await server.ssrLoadModule("/src/data/week-data-loader.js");
    const payload = {
      mode: "production",
      meta: { date: "2026-09-06", featuredRaceId: "race-1" },
      races: [{
        id: "race-1",
        track: "札幌",
        number: 10,
        name: "テスト特別",
        surface: "芝",
        distance: 1800,
        fieldSize: 1,
        horses: [{
          id: "horse-1",
          number: 8,
          name: "ワザモノ",
          tmIndex: 76,
          odds: 10.7,
          popularity: 5,
          currentRace: { horseId: "horse-1", raceDate: "2026-09-06" },
          analysis: { factorsDetail: {} },
        }],
      }],
    };

    const adapted = adaptWeekDataPayload(payload, { previewMode: false, officialWeekData: payload });
    assert.equal(adapted.races[0].horses[0].aiScore, 76);
    assert.equal(adapted.races[0].horses[0].odds, 10.7);
    assert.equal(adapted.races[0].horses[0].popularity, 5);
  } finally {
    await server.close();
  }
});
