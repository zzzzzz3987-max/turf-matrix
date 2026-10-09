import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFinishTopographyShadow, resolveFinishTopography } from '../finish-topography-shadow.mjs';

const target = { course: '京都', surface: '芝', distance: 1400 };
const run = (course, date, extra = {}) => ({ course, date, surface: '芝', distance: 1400,
  raceName: 'テストG2', finishPosition: 2, fieldSize: 16, margin: 0.2, trackCondition: '良', ...extra });
const analyze = runs => buildFinishTopographyShadow({ currentRace: target, pastRuns: runs }, { asOf: '2026-10-07' });

test('Kyoto finish is flat while the third-corner hill stays separate', () => {
  const shape = resolveFinishTopography(target);
  assert.equal(shape.finishStraight, 'flat');
  assert.equal(shape.enRouteRelief, 'third-corner-hill');
  assert.equal(resolveFinishTopography({ ...target, course: '東京' }).finishStraight, 'uphill');
});
test('dirt, foreign, unverified and straight 1000 routes are unsupported', () => {
  for (const race of [{ ...target, surface: 'ダ' }, { ...target, course: '函館' },
    { ...target, course: '海外' }, { ...target, course: '新潟', distance: 1000 }]) assert.equal(resolveFinishTopography(race), null);
});
test('same venue and exact distance evidence is retained separately', () => {
  const result = analyze([run('京都', '2026-01-01'), run('東京', '2026-02-01'), run('京都', '2026-03-01', { distance: 1600 })]);
  assert.equal(result.flat.runs, 2);
  assert.equal(result.uphill.runs, 1);
  assert.equal(result.directCondition.runs, 1);
  assert.equal(result.indexAdjustment, 0);
  assert.equal(result.scoreConnected, false);
});
test('future, same-day, undated, duplicate, surface and invalid runs are rejected', () => {
  const good = run('京都', '2026-01-01');
  const result = analyze([good, structuredClone(good), run('京都', '2026-10-07'), run('東京', '2026-10-08'),
    run('京都', null), run('京都', '2026-02-30'), run('東京', '2026-02-01', { surface: 'ダ' }),
    run('京都', '2026-03-01', { finishPosition: 0 }), run('京都', '2026-04-01', { abnormalityCode: '1' })]);
  assert.equal(result.flat.runs, 1);
  assert.equal(result.excluded.duplicate, 1);
  assert.equal(result.excluded['not-before-asOf'], 2);
  assert.equal(result.excluded.undated, 2);
});
test('different distances or grades do not fabricate a matched comparison', () => {
  const flat = [1, 2, 3].map(n => run('京都', `2026-01-0${n}`));
  const uphill = [1, 2, 3].map(n => run('東京', `2026-02-0${n}`, { distance: 1600 }));
  assert.equal(analyze([...flat, ...uphill]).status, 'limited');
  assert.equal(analyze([...flat, ...uphill.map(r => ({ ...r, distance: 1400, raceName: 'テストG1' }))]).matched.comparable, false);
});
test('three observations per overlapping side allow only descriptive comparison', () => {
  const runs = [1, 2, 3].flatMap(n => [run('京都', `2026-01-0${n}`), run('東京', `2026-02-0${n}`)]);
  const before = structuredClone(runs);
  const result = analyze(runs);
  assert.equal(result.status, 'descriptive-comparison');
  assert.equal(result.matched.flat.runs, 3);
  assert.equal(result.shadow, true);
  assert.deepEqual(runs, before);
  assert.match(result.summary, /断定できません/);
});
test('unknown going and grade never create a matched stratum', () => {
  const rows = [1, 2, 3].flatMap(n => [run('京都', `2026-01-0${n}`, { trackCondition: null }),
    run('東京', `2026-02-0${n}`, { trackCondition: null })]);
  assert.equal(analyze(rows).matched.comparable, false);
});
test('missing margins are not converted to zero and negative margins are omitted', () => {
  const result = analyze([run('京都', '2026-01-01', { margin: null }), run('京都', '2026-02-01', { margin: -0.2 }),
    run('京都', '2026-03-01', { margin: 0.3 })]);
  assert.equal(result.flat.marginRuns, 1);
  assert.equal(result.flat.meanMargin, 0.3);
});
test('cutoff and distance window are mandatory valid constraints', () => {
  assert.throws(() => buildFinishTopographyShadow({ currentRace: target }), /asOf/);
  assert.throws(() => buildFinishTopographyShadow({ currentRace: target }, { asOf: '2026-02-30' }), /asOf/);
  assert.throws(() => buildFinishTopographyShadow({ currentRace: target }, { asOf: '2026-10-07', distanceWindow: 999 }), /window/);
});
