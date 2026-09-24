import test from "node:test";
import assert from "node:assert/strict";
import { fetchLiveDataUpdate, startLiveDataRefresh } from "../../../src/data/live-data-refresh.js";

const response = (body, ok = true, status = 200) => ({
  ok,
  status,
  json: async () => body,
});
const weekPayload = (date = "2026-09-06", id = "race-1") => ({
  meta: { date },
  races: [{ id, horses: [{ id: "horse-1" }], fieldSize: 1 }],
});
const signalsPayload = (date = "2026-09-06", id = "race-1") => ({
  date,
  raceCount: 1,
  races: [{ id }],
});

test("a hanging manifest or JSON body times out and aborts the request", async () => {
  for (const hangBody of [false, true]) {
    let signal;
    const fetchImpl = async (_, options) => {
      signal = options.signal;
      if (!hangBody) return new Promise(() => {});
      return { ok: true, json: () => new Promise(() => {}) };
    };
    await assert.rejects(fetchLiveDataUpdate({ currentVersion: "old", fetchImpl, timeoutMs: 5 }), /timed out/);
    assert.equal(signal.aborted, true);
  }
});

test("a failed payload does not produce a partial update", async () => {
  const fetchImpl = async (url) => {
    if (url.startsWith("/live/version")) return response({ version: "new", weekDataUrl: "/week", allRaceSignalsUrl: "/signals" });
    if (url === "/week") return response(weekPayload());
    return response(null, false, 503);
  };
  await assert.rejects(fetchLiveDataUpdate({ currentVersion: "old", fetchImpl }), /503/);
});

test("polling recovers after timeout and retries when applying the update fails", async () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  let tick;
  let stop;
  let hang = true;
  let failApply = true;
  const errors = [];
  let updates = 0;
  let notifyError;
  let notifyUpdate;
  globalThis.window = {
    setInterval: (callback) => { tick = callback; return 1; },
    clearInterval: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  globalThis.document = { hidden: false, addEventListener: () => {}, removeEventListener: () => {} };
  const fetchImpl = async (url) => {
    if (hang) return new Promise(() => {});
    if (url.startsWith("/live/version")) return response({ version: "new", weekDataUrl: "/week", allRaceSignalsUrl: "/signals" });
    return response(url.endsWith("/week") ? weekPayload() : signalsPayload());
  };
  try {
    const firstError = new Promise((resolve) => { notifyError = resolve; });
    stop = startLiveDataRefresh({
      initialVersion: "old", fetchImpl, timeoutMs: 5,
      onError: (error) => { errors.push(error.message); notifyError(); },
      onUpdate: () => {
        if (failApply) throw new Error("apply failed");
        updates += 1;
        notifyUpdate();
      },
    });
    await firstError;
    assert.match(errors[0], /timed out/);
    hang = false;
    const secondError = new Promise((resolve) => { notifyError = resolve; });
    tick();
    await secondError;
    assert.equal(errors[1], "apply failed");
    failApply = false;
    const applied = new Promise((resolve) => { notifyUpdate = resolve; });
    tick();
    await applied;
    assert.equal(updates, 1);
  } finally {
    stop?.();
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
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
    if (url === manifest.weekDataUrl) return response(weekPayload());
    if (url === manifest.allRaceSignalsUrl) return response(signalsPayload());
    return response(null, false, 404);
  };

  const result = await fetchLiveDataUpdate({ currentVersion: "old", fetchImpl, cacheKey: 456 });

  assert.equal(result.changed, true);
  assert.equal(result.version, "new");
  assert.equal(result.weekData.meta.date, "2026-09-06");
  assert.equal(result.allRaceSignals.date, "2026-09-06");
  assert.equal(requests.length, 3);
});

test("live data rejects dates, race IDs, and engine versions that do not agree", async () => {
  const manifest = { version: "new", weekDataUrl: "/week", allRaceSignalsUrl: "/signals" };
  const fetchFor = (week, signals) => async (url) => {
    if (url.startsWith("/live/version")) return response(manifest);
    return response(url === "/week" ? week : signals);
  };

  await assert.rejects(
    fetchLiveDataUpdate({ currentVersion: "old", fetchImpl: fetchFor(weekPayload(), signalsPayload("2026-09-05")) }),
    /date mismatch/,
  );
  await assert.rejects(
    fetchLiveDataUpdate({ currentVersion: "old", fetchImpl: fetchFor(weekPayload(), signalsPayload("2026-09-06", "other-race")) }),
    /race IDs do not match/,
  );
  await assert.rejects(
    fetchLiveDataUpdate({ currentVersion: "old", fetchImpl: fetchFor(
      { ...weekPayload(), meta: { date: "2026-09-06", engineFingerprint: { sha256: "week" } } },
      { ...signalsPayload(), engineFingerprint: { sha256: "signals" } },
    ) }),
    /analysis versions do not match/,
  );
});
