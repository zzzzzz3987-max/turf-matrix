export const LIVE_DATA_REFRESH_INTERVAL_MS = 15_000;

const fetchJson = async (fetchImpl, url) => {
  const response = await fetchImpl(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Live data request failed (${response.status})`);
  return response.json();
};

export const fetchLiveDataUpdate = async ({
  currentVersion,
  fetchImpl = fetch,
  cacheKey = Date.now(),
}) => {
  const manifest = await fetchJson(fetchImpl, `/live/version.json?t=${cacheKey}`);
  if (!manifest?.version || manifest.version === currentVersion) {
    return { changed: false, version: manifest?.version ?? currentVersion };
  }

  const [weekData, allRaceSignals] = await Promise.all([
    fetchJson(fetchImpl, manifest.weekDataUrl),
    fetchJson(fetchImpl, manifest.allRaceSignalsUrl),
  ]);

  return {
    changed: true,
    version: manifest.version,
    weekData,
    allRaceSignals,
  };
};

export const startLiveDataRefresh = ({
  initialVersion,
  onUpdate,
  onError = () => {},
  intervalMs = LIVE_DATA_REFRESH_INTERVAL_MS,
  fetchImpl = fetch,
}) => {
  let currentVersion = initialVersion;
  let stopped = false;
  let inFlight = false;

  const poll = async () => {
    if (stopped || inFlight || (typeof document !== "undefined" && document.hidden)) return;
    inFlight = true;
    try {
      const update = await fetchLiveDataUpdate({ currentVersion, fetchImpl });
      if (stopped) return;
      currentVersion = update.version ?? currentVersion;
      if (update.changed) onUpdate(update);
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
