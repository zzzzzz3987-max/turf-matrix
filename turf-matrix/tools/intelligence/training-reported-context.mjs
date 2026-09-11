import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const context = require("../../data/master/training-reported-context.json");
const nameKey = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, "");
const validDate = (value) => typeof value === "string"
  && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value))
  && new Date(value).toISOString().slice(0, 10) === value;

// Reports supplement the explanation; they never become a video review or score input.
export const reportedTrainingContext = (horse, records = context.records) => {
  const raceDate = horse.currentRace?.raceDate;
  const horseName = nameKey(horse.horseName ?? horse.name);
  if (!validDate(raceDate) || !horseName) return [];
  const sessionDates = new Set([
    ...(horse.training?.slope ?? []), ...(horse.training?.wood ?? []),
  ].map((session) => String(session.date ?? "").replace(/-/g, "")));
  return (records ?? []).filter((record) => record.status === "verified"
    && record.kind === "reported"
    && record.raceDate === raceDate
    && nameKey(record.horseName) === horseName
    && validDate(record.trainingDate)
    && record.trainingDate < raceDate
    && sessionDates.has(record.trainingDate.replace(/-/g, ""))
    && typeof record.summary === "string" && record.summary.trim()
    && record.sources?.length > 0
    && record.sources.every((source) => validDate(source.publishedDate)
      && source.publishedDate >= record.trainingDate
      && source.publishedDate < raceDate
      && typeof source.url === "string" && source.url.startsWith("https://")))
    .map(({ trainingDate, summary, sources }) => ({
      kind: "reported", trainingDate, summary,
      sources: sources.map(({ publisher, publishedDate, url, supports }) => ({ publisher, publishedDate, url, supports })),
    }));
};
