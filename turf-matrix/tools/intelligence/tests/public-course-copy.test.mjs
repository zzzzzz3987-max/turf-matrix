import test from 'node:test';
import assert from 'node:assert/strict';
import { publicFactorExplanation, buildHorseBrief } from '../../../src/lib/public-view-model.js';

const horse = (pastRuns, course = '京都', surface = '芝') => ({
  currentRace: { course, surface, distance: 1200 },
  pastRuns,
  analysis: { factorsDetail: { course: { key: 'course', score: 80, status: 'active' } } },
});
const explain = (h) => publicFactorExplanation(h.analysis.factorsDetail.course, { horse: h });

test('Kyoto results are never contradicted by an empty internal course group', () => {
  const h = horse([
    { course: '京都', surface: '芝', finishPosition: 3 },
    { course: '京都', surface: '芝', finishPosition: 4 },
    { course: '東京', surface: '芝', finishPosition: 1 },
  ]);
  assert.match(explain(h), /^京都芝2走で3着以内1回。/);
  assert.match(explain(h), /他場も含む芝では3走で3着以内2回/);
  assert.doesNotMatch(explain(h), /標準コース|実績なし|形状/);
  const brief = buildHorseBrief(h);
  assert.match(brief.headline, /京都芝2走で3着以内1回/);
  assert.doesNotMatch(brief.reason, /京都芝2走で3着以内1回/);
});

test('opposite-surface wins are not counted as direct target-surface wins', () => {
  const h = horse([
    { course: '京都', surface: 'ダート', finishPosition: 1 },
    { course: '東京', surface: '芝', finishPosition: 2 },
  ]);
  assert.match(explain(h), /^京都芝の出走実績はありません/);
  assert.match(explain(h), /他場も含む芝では1走で3着以内1回/);
  assert.match(explain(h), /芝・ダートを合わせた京都1走/);
  assert.doesNotMatch(explain(h), /京都芝1走で3着以内1回/);
});

test('dirt aliases and confirmed results have consistent denominators', () => {
  const h = horse([
    { course: '東京', surface: 'ダ', finishPosition: 1, confirmedFinishPosition: 4 },
    { course: '東京', surface: 'ダート', finishPosition: 3 },
    { course: '東京', surface: 'ダ', finishPosition: null },
    { course: '東京', surface: '芝', finishPosition: 1 },
  ], '東京', 'ダート');
  assert.match(explain(h), /^東京ダート3走（着順確認2走）で3着以内1回/);
  assert.doesNotMatch(explain(h), /3着以内2回/);
});

test('no placings, unknown finishes, and no history remain distinct', () => {
  const unplaced = horse([{ course: '京都', surface: '芝', finishPosition: 5 }]);
  assert.match(explain(unplaced), /京都芝1走で3着以内0回/);
  const unknown = horse([{ course: '京都', surface: '芝', finishPosition: null }]);
  assert.match(explain(unknown), /1走の着順は未確認/);
  assert.doesNotMatch(explain(unknown), /3着以内0回/);
  const empty = horse([]);
  assert.match(explain(empty), /コース適性を判断する過去成績が不足/);
});

test('target-surface scoring does not claim that opposite-surface runs were scored', () => {
  const h = horse([
    { course: '京都', surface: '芝', finishPosition: 2 },
    { course: '京都', surface: 'ダ', finishPosition: 1 },
  ]);
  h.analysis.factorsDetail.course.components = { sameCourse: { count: 1 } };
  assert.doesNotMatch(explain(h), /芝・ダートを合わせた/);
});

test('obstacle records are not described as flat turf results', () => {
  const h = horse([
    { course: '東京', surface: '芝', surfaceCode: '51', finishPosition: 2 },
    { course: '東京', surface: '芝', surfaceCode: '11', finishPosition: 1 },
  ], '東京', '障');
  assert.match(explain(h), /^東京障害1走で3着以内1回/);
  assert.doesNotMatch(explain(h), /同じ芝|芝では2走|障害2走/);
  assert.match(explain(h), /平地・障害を合わせた東京2走/);
});
