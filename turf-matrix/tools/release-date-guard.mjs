const TOKYO_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export const tokyoCalendarDate = (date = new Date()) => {
  const parts = Object.fromEntries(
    TOKYO_DATE_FORMATTER.formatToParts(date).map(({ type, value }) => [type, value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
};

export const isCurrentOrFutureRaceDate = (raceDate, today = tokyoCalendarDate()) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(raceDate ?? ""))) return false;
  const parsed = new Date(`${raceDate}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === raceDate && raceDate >= today;
};
