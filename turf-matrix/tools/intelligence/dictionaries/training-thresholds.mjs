const TRAINING_THRESHOLDS = {
  slope: {
    miho: { "4F": 49.9, "3F": 35.9, "2F": 23.9, "1F": 12.8 },
    ritto: { "4F": 52.9, "3F": 38.9, "2F": 25.9, "1F": 13.4 },
  },
  wood: {
    default: { "4F": 50.0, "3F": 36.8, "2F": 24.4, "1F": 12.0 },
  },
};

const stableKey = (stableSide) => (String(stableSide ?? "").includes("栗") ? "ritto" : "miho");

const trainingThreshold = (type, stableSide) => {
  if (type === "slope") return TRAINING_THRESHOLDS.slope[stableKey(stableSide)];
  return TRAINING_THRESHOLDS.wood.default;
};

export { TRAINING_THRESHOLDS, trainingThreshold };
