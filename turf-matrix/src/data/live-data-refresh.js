export const LIVE_DATA_REFRESH_INTERVAL_MS = 15_000;
export const LIVE_DATA_REQUEST_TIMEOUT_MS = 10_000;

const validDate = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

const validateLivePayloads = (weekData, allRaceSignals) => {
  const weekDate = weekData?.meta?.date ?? weekData?.date;
  const signalDate = allRaceSignals?.date ?? allRaceSignals?.meta?.date;
  const weekRaces = weekData?.races;
  const signalRaces = allRaceSignals?.races;
  if (!validDate(weekDate) || !validDate(signalDate) || weekDate !== signalDate) {
    throw new Error("Live data date mismatch or missing date");
  }
  if (!Array.isArray(weekRaces) || !weekRaces.length || !Array.isArray(signalRaces) || !signalRaces.length) {
    throw new Error("Live data race lists are missing or empty");
  }

  const uniqueIds = (races, label) => {
    const ids = races.map((race) => race?.id ?? race?.raceId);
    if (ids.some((id) => typeof id !== "string" || !id.trim()) || new Set(ids).size !== ids.length) {
      throw new Error(`Live ${label} race IDs are invalid or duplicated`);
    }
    return new Set(ids);
  };
  const weekIds = uniqueIds(weekRaces, "week-data");
  const signalIds = uniqueIds(signalRaces, "all-race-signals");
  if ([...weekIds].some((id) => !signalIds.has(id))) {
    throw new Error("Live payload race IDs do not match");
  }
  if (allRaceSignals.raceCount != null && allRaceSignals.raceCount !== signalRaces.length) {
    throw new Error("Live all-race-signals count does not match its race list");
  }

  const weekFingerprint = weekData.meta?.engineFingerprint?.sha256;
  const signalFingerprint = allRaceSignals.engineFingerprint?.sha256;
  if (weekFingerprint && signalFingerprint && weekFingerprint !== signalFingerprint) {
    throw new Error("Live payload analysis versions do not match");
  }
};

const fetchJson = async (fetchImpl, url, timeoutMs) => {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      (async () => {
        const response = await fetchImpl(url, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error(`Live data request failed (${response.status})`);
        return response.json();
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error("Live data request timed out"));
          controller.abort();
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

export const fetchLiveDataUpdate = async ({
  currentVersion,
  fetchImpl = fetch,
  cacheKey = Date.now(),
  timeoutMs = LIVE_DATA_REQUEST_TIMEOUT_MS,
}) => {
  const manifest = await fetchJson(fetchImpl, `/live/version.json?t=${cacheKey}`, timeoutMs);
  if (!manifest?.version || manifest.version === currentVersion) {
    return { changed: false, version: manifest?.version ?? currentVersion };
  }

  const [weekData, allRaceSignals] = await Promise.all([
    fetchJson(fetchImpl, manifest.weekDataUrl, timeoutMs),
    fetchJson(fetchImpl, manifest.allRaceSignalsUrl, timeoutMs),
  ]);
  validateLivePayloads(weekData, allRaceSignals);

  return {
    changed: true,
    version: manifest.version,
    weekData,
    allRaceSignals,
  };
};

export { validateLivePayloads };

export const startLiveDataRefresh = ({
  initialVersion,
  onUpdate,
  onError = () => {},
  intervalMs = LIVE_DATA_REFRESH_INTERVAL_MS,
  fetchImpl = fetch,
  timeoutMs = LIVE_DATA_REQUEST_TIMEOUT_MS,
}) => {
  let currentVersion = initialVersion;
  let stopped = false;
  let inFlight = false;

  const poll = async () => {
    if (stopped || inFlight || (typeof document !== "undefined" && document.hidden)) return;
    inFlight = true;
    try {
      const update = await fetchLiveDataUpdate({ currentVersion, fetchImpl, timeoutMs });
      if (stopped) return;
      if (update.changed) await onUpdate(update);
      currentVersion = update.version ?? currentVersion;
    } catch (error) {
      if (!stopped) onError(error);
    } finally {
      inFlight = false;
    }
  };

  const handleVisibilityChange = () => {
    if (!document.hidden) void poll();
  };
  const handleFocus = () => void poll();
  const handleOnline = () => void poll();

  const intervalId = window.setInterval(() => void poll(), intervalMs);
  document.addEventListener("visibilitychange", handleVisibilityChange);
  window.addEventListener("focus", handleFocus);
  window.addEventListener("online", handleOnline);
  void poll();

  return () => {
    stopped = true;
    window.clearInterval(intervalId);
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    window.removeEventListener("focus", handleFocus);
    window.removeEventListener("online", handleOnline);
  };
};
