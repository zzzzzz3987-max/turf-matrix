export const dateKey = (value) => String(value ?? "").replace(/\D/g, "").slice(0, 8);

export const resolveEvaluationCutoff = (source) => dateKey(
  source?.meta?.date
  ?? source?.meta?.raceDate
  ?? source?.raceDate
  ?? source?.races?.[0]?.date
  ?? source?.races?.[0]?.raceDate
  ?? source?.races?.[0]?.race?.raceDate
  ?? source?.races?.[0]?.raceContext?.date
  ?? source?.races?.[0]?.horses?.[0]?.currentRace?.raceDate
);

export const isObservationBeforeCutoff = (observationDate, cutoff) => {
  const observationKey = dateKey(observationDate);
  const cutoffKey = dateKey(cutoff);
  return Boolean(observationKey && cutoffKey && observationKey < cutoffKey);
};
