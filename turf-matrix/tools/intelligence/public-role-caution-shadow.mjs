import { selectPublicDangerHorse, selectPublicValueHorse, selectPublicValueEvidenceHorse } from '../../src/lib/public-role-selection.js';

export const CAUTION_MODEL_VERSION = 'public-role-caution-v1';

export const assertUpcomingPublicRoleRaces = ({ date, races, now }) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') || !Array.isArray(races) || !races.length || !Number.isFinite(new Date(now).getTime())) {
    throw new Error('Race date, races or freeze time missing');
  }
  const day = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== date) throw new Error('Invalid race date');
  for (const race of races) {
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(race.time ?? '') || !race.bundleId?.startsWith(`${date}-`) ||
      !(new Date(now) < new Date(`${date}T${race.time}:00+09:00`))) throw new Error('Every race must have an upcoming start time');
  }
};
const finite = Number.isFinite;
const detail = (horse, key) => horse?.analysis?.factorsDetail?.[key];
const evaluated = (factor) => ['active', 'partial'].includes(factor?.status);
const score = (horse, key) => {
  const factor = detail(horse, key);
  return evaluated(factor) && finite(factor.score) ? factor.score : null;
};

// Existing evidence-v4/public warning boundaries, fixed before prospective use.
// Market disagreement and training alone do not establish an adverse race condition.
export const assessPublicRoleCaution = (horse) => {
  const below = (key, boundary) => score(horse, key) !== null && score(horse, key) < boundary;
  const above = (key, boundary) => score(horse, key) !== null && score(horse, key) >= boundary;
  const performanceRisks = ['ability', 'form'].filter(key => below(key, 64));
  const conditionRisks = [];
  if (below('distance', 60)) conditionRisks.push('distance');
  if (below('course', 65)) conditionRisks.push('course');
  if (below('pace', 65)) conditionRisks.push('pace');
  const load = detail(horse, 'load');
  if (evaluated(load) && finite(load.tolerance?.adjustment) && load.tolerance.adjustment < 0) conditionRisks.push('load');
  const bias = detail(horse, 'trackBias');
  if (evaluated(bias) && finite(bias.adjustment) && bias.adjustment < 0) conditionRisks.push('trackBias');
  const performanceSupports = [['ability', 72], ['form', 68]].filter(([key, boundary]) => above(key, boundary)).map(([key]) => key);
  const conditionSupports = ['distance', 'course'].filter(key => above(key, 70));
  return { performanceRisks, conditionRisks, performanceSupports, conditionSupports };
};

export const selectPublicRoleCautionShadow = (race) => {
  const productionValue = selectPublicValueHorse(race);
  const productionDanger = selectPublicDangerHorse(race);
  const valueCandidate = selectPublicValueEvidenceHorse(race);
  const value = assessPublicRoleCaution(valueCandidate);
  const danger = assessPublicRoleCaution(productionDanger);
  return {
    productionValue,
    productionDanger,
    cautionValue: valueCandidate && value.performanceSupports.length && value.conditionSupports.length &&
      !value.performanceRisks.length && !value.conditionRisks.length ? valueCandidate : null,
    cautionDanger: productionDanger && danger.performanceRisks.length && danger.conditionRisks.length ? productionDanger : null,
    evidence: { value, danger },
  };
};
