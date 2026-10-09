import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyRaceGeneration, createGenerationLookup, buildGenerationEvidenceShadow } from '../generation-evidence-shadow.mjs';
import { scoreRecentForm } from '../form-ai.mjs';
import { calculateTmIndex } from '../tm-index-engine.mjs';

const metadata = (code = '12') => ({ raceDate: '2026-05-10', courseCode: '05', raceNo: 11,
  raceTypeCode: code, distance: 1600, trackCode: '11', raceKey: 'verified' });
const run = { date: '2026-05-10', course: '東京', raceNumber: 11, distance: 1600, surface: '芝',
  raceName: 'NHKマイルG1', finishPosition: 5, fieldSize: 18, margin: 0.5, last3F: 34.8 };
const fixture = (runs = [run]) => {
  const horse = { pastRuns: runs, currentRace: { surface: '芝', distance: 1400 } };
  const scores = { ability: 76, form: scoreRecentForm(horse), distance: 80, course: 70, training: 61, blood: 63, pace: 70 };
  const context = { category: 'grade', surface: '芝' };
  const raw = calculateTmIndex(scores, context);
  const count = runs.length;
  horse.tmIndex = Math.round(65 + (raw - 65) * (count === 0 ? 0.3 : count === 1 ? 0.5 : count === 2 ? 0.7 : 1));
  horse.analysis = { rawTmIndex: raw, indexContributions: Object.entries(scores).map(([key, score]) => ({ key, score })) };
  return { horse, context };
};
const build = (horse, context, records = [metadata()]) => buildGenerationEvidenceShadow(horse,
  { asOf: '2026-10-12', context, lookup: createGenerationLookup(records) });

test('official eligibility codes and historical age convention', () => {
  assert.deepEqual(['11', '12', '13', '14', '18', '00', null].map(c => classifyRaceGeneration(c, '2026-05-10')),
    ['twoOnly', 'threeOnly', 'mixed', 'olderOnly', 'unknown', 'unknown', 'unknown']);
  assert.equal(classifyRaceGeneration('11', '2000-12-31'), 'unknown');
  assert.equal(classifyRaceGeneration('13', '2026-02-30'), 'unknown');
});
test('never infers eligibility from age, grade, title or weight rule', () => {
  assert.equal(createGenerationLookup([])({ ...run, age: 3, weightRuleCode: '3' }).category, 'unknown');
});
test('identity, surface, distance and ambiguous metadata fail closed', () => {
  const lookup = createGenerationLookup([metadata()]);
  for (const change of [{ raceNumber: 10 }, { surface: 'ダ' }, { distance: 1400 }, { course: '京都' }])
    assert.equal(lookup({ ...run, ...change }).category, 'unknown');
  assert.equal(createGenerationLookup([metadata(), metadata('13')])(run).category, 'unknown');
  assert.equal(createGenerationLookup([metadata(), metadata()])(run).category, 'threeOnly');
});
test('separates evidence and withholds only label bonus without mutation', () => {
  const { horse, context } = fixture();
  const before = JSON.stringify(horse);
  const result = build(horse, context);
  assert.equal(result.groups.threeOnly.runs, 1);
  assert.equal(result.nearbyOpen.runs, 0);
  assert.equal(result.sensitivity.weightedLabelPointsWithheld, 10);
  assert.equal(result.sensitivity.replayValid, true);
  assert.ok(result.sensitivity.diagnosticIndex <= horse.tmIndex);
  assert.equal(JSON.stringify(horse), before);
  assert.equal(result.indexConnected, false);
});
test('mixed and unknown label bonuses stay intact', () => {
  const { horse, context } = fixture();
  for (const records of [[metadata('13')], []]) {
    const result = build(horse, context, records);
    assert.equal(result.sensitivity.weightedLabelPointsWithheld, 0);
    assert.equal(result.sensitivity.diagnosticIndex, horse.tmIndex);
  }
});
test('same-day, future, malformed, abnormal and duplicates block index sensitivity', () => {
  for (const invalid of [{ ...run, date: '2026-10-12' }, { ...run, date: '2026-10-13' },
    { ...run, date: '2026-02-30' }, { ...run, abnormalityCode: '1' }, { ...run, finishPosition: 0 }]) {
    const { horse, context } = fixture([invalid]);
    const result = build(horse, context);
    assert.equal(result.evidence.length, 0);
    assert.equal(result.sensitivity.diagnosticIndex, null);
  }
  const { horse, context } = fixture([run, run]);
  assert.equal(build(horse, context).evidence.length, 1);
  assert.equal(build(horse, context).sensitivity.diagnosticIndex, null);
});
test('saved factor/index replay mismatch is not silently re-scored', () => {
  const { horse, context } = fixture();
  horse.tmIndex += 1;
  assert.equal(build(horse, context).sensitivity.diagnosticIndex, null);
});
