import test from "node:test";
import assert from "node:assert/strict";
import { fetchLiveDataUpdate } from "../../../src/data/live-data-refresh.js";

const response = (body, ok = true, status = 200) => ({
  ok,
  status,
  json: async () => body,
});

test("live data refresh only reads the manifest when the version is unchanged", async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    return response({ version: "same" });
  };

  const result = await fetchLiveDataUpdate({ currentVersion: "same", fetchImpl, cacheKey: 123 });

  assert.deepEqual(result, { changed: false, version: "same" });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "/live/version.json?t=123");
  assert.equal(requests[0].options.cache, "no-store");
});

test("live data refresh loads both payloads after the version changes", async () => {
  const requests = [];
  const manifest = {
    version: "new",
    weekDataUrl: "/live/week-data.json?v=new",
    allRaceSignalsUrl: "/live/all-race-signals.json?v=new",
  };
  const fetchImpl = async (url) => {
    requests.push(url);
    if (url.startsWith("/live/version.json")) return response(manifest);
    if (url === manifest.weekDataUrl) return response({ meta: { date: "2026-09-06" }, races: [] });
    if (url === manifest.allRaceSignalsUrl) return response({ date: "2026-09-06", races: [] });
    return response(null, false, 404);
  };

  const result = await fetchLiveDataUpdate({ currentVersion: "old", fetchImpl, cacheKey: 456 });

  assert.equal(result.changed, true);
  assert.equal(result.version, "new");
  assert.equal(result.weekData.meta.date, "2026-09-06");
  assert.equal(result.allRaceSignals.date, "2026-09-06");
  assert.equal(requests.length, 3);
});
