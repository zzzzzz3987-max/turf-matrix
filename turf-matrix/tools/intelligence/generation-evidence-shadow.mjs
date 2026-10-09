import { buildFormAnalysis, selectRecentFormRuns } from './form-ai.mjs';
import { calculateTmIndex } from './tm-index-engine.mjs';

export const GENERATION_SHADOW_VERSION = 'generation-evidence-shadow-v1';
export const GENERATION_SOURCE = 'https://jra-van.jp/dlb/sdv/sdk/JV-Data4901.pdf';
const courses = ['札幌', '函館', '福島', '新潟', '東京', '中山', '中京', '京都', '阪神', '小倉'];
const validDate = date => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)
  && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
const dateOf = run => run.date ?? run.raceDate;
const keyOf = run => {
  const code = run.courseCode ?? (courses.indexOf(run.course) >= 0
    ? String(courses.indexOf(run.course) + 1).padStart(2, '0') : null);
  const number = Number(run.raceNumber ?? run.raceNo ?? run.number);
  return validDate(dateOf(run)) && /^0[1-9]$|^10$/.test(code ?? '') && Number.isInteger(number) && number >= 1 && number <= 12
    ? `${dateOf(run)}|${code}|${number}` : null;
};

// Eligibility metadata is not inferred from the horse's age, race title or weight rule.
export function classifyRaceGeneration(code, date) {
  if (!validDate(date) || date < '2001-01-01') return 'unknown';
  return ({ '11': 'twoOnly', '12': 'threeOnly', '13': 'mixed', '14': 'olderOnly' })[String(code ?? '').trim()] ?? 'unknown';
}

export function createGenerationLookup(records) {
  const map = new Map();
  for (const record of records) {
    const key = keyOf(record);
    if (!key) continue;
    const prior = map.get(key);
    if (!prior) map.set(key, record);
    else if (prior.raceTypeCode !== record.raceTypeCode || prior.distance !== record.distance || prior.trackCode !== record.trackCode)
      map.set(key, { ambiguous: true });
  }
  return run => {
    const record = map.get(keyOf(run));
    if (!record || record.ambiguous) return { category: 'unknown', reason: record ? 'ambiguous metadata' : 'missing metadata' };
    const recordSurface = Number(record.trackCode) >= 10 && Number(record.trackCode) <= 22 ? '芝'
      : Number(record.trackCode) >= 23 && Number(record.trackCode) <= 29 ? 'ダ' : null;
    if (run.distance != null && Number(run.distance) !== Number(record.distance)
      || run.surface && recordSurface && !String(run.surface).startsWith(recordSurface))
      return { category: 'unknown', reason: 'condition mismatch' };
    const category = classifyRaceGeneration(record.raceTypeCode, dateOf(run));
    return { category, code: record.raceTypeCode ?? null, raceKey: record.raceKey ?? null,
      reason: category === 'unknown' ? 'unsupported eligibility code/date' : null };
  };
}

const stats = rows => ({ runs: rows.length, wins: rows.filter(r => r.finishPosition === 1).length,
  topThree: rows.filter(r => r.finishPosition <= 3).length,
  closeRuns: rows.filter(r => Number.isFinite(r.margin) && r.margin <= 0.5).length,
  meanMargin: rows.some(r => Number.isFinite(r.margin))
    ? +(rows.filter(r => Number.isFinite(r.margin)).reduce((sum, r) => sum + r.margin, 0) / rows.filter(r => Number.isFinite(r.margin)).length).toFixed(3) : null });

export function buildGenerationEvidenceShadow(horse, { asOf, lookup, context = {} }) {
  if (!validDate(asOf)) throw new Error('A valid asOf date is required');
  const seen = new Set();
  const excluded = [];
  const evidence = [];
  for (const run of horse.pastRuns ?? []) {
    const date = dateOf(run);
    const key = keyOf(run);
    const reason = !validDate(date) ? 'invalid date' : date >= asOf ? 'not strictly pre-race'
      : !Number.isInteger(run.finishPosition) || run.finishPosition <= 0 || run.abnormalityCode && run.abnormalityCode !== '0'
        ? 'invalid result' : key && seen.has(key) ? 'duplicate' : null;
    if (reason) { excluded.push({ date, reason }); continue; }
    if (key) seen.add(key);
    evidence.push({ date, course: run.course, raceNumber: run.raceNumber ?? run.raceNo,
      raceName: run.raceName, distance: run.distance, surface: run.surface,
      finishPosition: run.finishPosition, margin: run.margin ?? null, ...lookup(run) });
  }
  const groups = Object.fromEntries(['twoOnly', 'threeOnly', 'mixed', 'olderOnly', 'unknown']
    .map(category => [category, stats(evidence.filter(r => r.category === category))]));
  const targetDistance = horse.currentRace?.distance ?? context.distance;
  const targetSurface = horse.currentRace?.surface ?? context.surface;
  const nearbyOpen = evidence.filter(r => ['mixed', 'olderOnly'].includes(r.category)
    && r.surface === targetSurface && Number.isFinite(r.distance) && Number.isFinite(targetDistance)
    && Math.abs(r.distance - targetDistance) <= 200);
  const form = buildFormAnalysis(horse);
  const calculation = form.calculation;
  const selectedRuns = selectRecentFormRuns(horse);
  const sourcePositions = {};
  const rows = calculation.runs.map(row => {
    const index = sourcePositions[row.source] ?? 0;
    sourcePositions[row.source] = index + 1;
    const run = selectedRuns[row.source][index];
    const category = validDate(dateOf(run)) && dateOf(run) < asOf ? lookup(run).category : 'unknown';
    // Only the existing label bonus is ablated; all observed performance components remain.
    const withheldBonus = ['twoOnly', 'threeOnly'].includes(category) ? row.classAdjustment : 0;
    return { date: row.date, source: row.source, text: row.text, category,
      classAdjustment: row.classAdjustment, weight: row.recentWeight, withheldBonus };
  });
  const lossFor = source => {
    const selected = rows.filter(r => r.source === source);
    return selected.length ? selected.reduce((sum, r) => sum + r.withheldBonus * r.weight, 0) / selected.length : 0;
  };
  const loss = lossFor('central') * calculation.centralShare + lossFor('local') * calculation.localShare;
  const formWithoutGenerationLabel = Math.max(35, Math.min(96, Math.round(calculation.beforeClamp - loss)));
  const scores = Object.fromEntries((horse.analysis?.indexContributions ?? []).map(row => [row.key, row.score]));
  const indexFor = values => {
    const raw = calculateTmIndex(values, context);
    const count = horse.pastRuns?.length ?? 0;
    const experience = Math.round(65 + (raw - 65) * (count === 0 ? 0.3 : count === 1 ? 0.5 : count === 2 ? 0.7 : 1));
    return Math.max(45, Math.min(92, experience + (horse.analysis?.goingAdjustment ?? 0)
      + (horse.analysis?.loadAdjustment ?? 0) + (horse.analysis?.trackBiasAdjustment ?? 0)));
  };
  const replayValid = excluded.length === 0 && Number.isFinite(scores.form) && scores.form === form.score
    && calculateTmIndex(scores, context) === horse.analysis?.rawTmIndex && indexFor(scores) === horse.tmIndex;
  const diagnosticIndex = replayValid ? indexFor({ ...scores, form: formWithoutGenerationLabel }) : null;
  return { policy: GENERATION_SHADOW_VERSION, source: GENERATION_SOURCE, indexConnected: false, asOf,
    groups, nearbyOpen: stats(nearbyOpen), evidence, excluded,
    sensitivity: { scope: 'form-label-bonus-only; ability class effects unchanged', replayValid,
      metadataComplete: rows.every(row => row.category !== 'unknown'),
      baselineIndex: horse.tmIndex ?? null, baselineForm: form.score, formWithoutGenerationLabel,
      weightedLabelPointsWithheld: +loss.toFixed(3), diagnosticIndex, rows,
      unavailableReason: replayValid ? null : 'frozen baseline cannot be replayed or inputs excluded' } };
}
