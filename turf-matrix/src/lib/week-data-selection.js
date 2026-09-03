const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const hasPreviewData = (candidate) =>
  candidate?.productionWeekDataUpdated === false &&
  candidate?.intelligenceLayerConnected !== false &&
  Array.isArray(candidate?.races) &&
  candidate.races.length > 0;

const dataDate = (payload) => {
  const value = String(payload?.meta?.date ?? "").trim();
  return ISO_DATE_PATTERN.test(value) ? value : null;
};

const shouldUseCandidatePreview = ({ requestedMode, candidate, official }) => {
  if (requestedMode === "official") return false;
  if (!hasPreviewData(candidate)) return false;
  if (requestedMode === "candidate" || requestedMode === "batch") return true;
  if (requestedMode && requestedMode !== "auto") return false;

  const candidateDate = dataDate(candidate);
  const officialDate = dataDate(official);
  return Boolean(candidateDate && (!officialDate || candidateDate > officialDate));
};

export { shouldUseCandidatePreview };
