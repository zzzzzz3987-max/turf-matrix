export const oddsFieldSizeIssue = ({ expectedSize, rows, raceDate, time, now = Date.now() }) => {
  if (!expectedSize || rows.length === expectedSize) return null;
  const message = `expected ${expectedSize} rows but got ${rows.length}`;
  const post = /^\d{2}:\d{2}$/.test(time ?? "")
    ? Date.parse(`${raceDate}T${time}:00+09:00`) : NaN;
  // A settled pool can omit runners; it must not block unrelated live races.
  const completedPool = rows.length > 0 && rows.length < expectedSize
    && rows.every(row => row.status === "closed")
    && Number.isFinite(post) && post <= now;
  return { severity: completedPool ? "warning" : "failure", message };
};
