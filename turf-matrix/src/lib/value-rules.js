export const VALUE_SIGNAL_MIN_EV = 1.15;
export const HIGH_EV_REFERENCE_THRESHOLD = 3.0;

export const isHighEvReference = (ev) =>
  Number.isFinite(ev) && ev >= HIGH_EV_REFERENCE_THRESHOLD;

export const isValueSignalEv = (ev) =>
  Number.isFinite(ev) && ev >= VALUE_SIGNAL_MIN_EV && ev < HIGH_EV_REFERENCE_THRESHOLD;

export const valueDisplayLabel = (ev) =>
  isHighEvReference(ev) ? "高オッズ妙味(参考)" : null;
