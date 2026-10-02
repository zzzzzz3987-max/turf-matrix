import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreCourse, buildCoursePerformanceProfile, buildCourseAnalysis } from '../course-ai.mjs';
import { publicFactorExplanation } from '../../../src/lib/public-view-model.js';

const run = { date: '2026-09-01', course: '京都', surface: '芝', distance: 1200, fieldSize: 16, finishPosition: 2, margin: 0.1 };
const horse = (pastRuns) => ({ currentRace: { raceDate: '2026-10-03', course: '京都', surface: '芝', distance: 1200 }, pastRuns });

test('course points cannot be raised by unrelated venue, surface or distance winners', () => {
  const base = horse([run]);
  const added = horse([run, { ...run, course: '東京', finishPosition: 1 },
    { ...run, surface: 'ダ', finishPosition: 1 }, { ...run, distance: 1800, finishPosition: 1 }]);
  assert.equal(scoreCourse(base), scoreCourse(added));
  assert.equal(buildCoursePerformanceProfile(added).sampleCount, 1);
});

test('unproven course stays neutral and is not presented as a strength', () => {
  const h = horse([{ ...run, course: '東京', finishPosition: 1 }]);
  const profile = buildCoursePerformanceProfile(h);
  assert.equal(profile.score, 65);
  assert.equal(profile.status, 'missing');
  const course = buildCourseAnalysis(h, {});
  assert.equal(course.status, 'missing');
  assert.match(course.summary, /実績データが不足/);
  assert.match(course.summary, /苦手という意味ではありません/);
});

test('performance, not experience alone, determines course points', () => {
  const poor = [1, 2, 3].map(n => ({ ...run, date: `2026-09-0${n}`, finishPosition: 15, margin: 3 }));
  assert.ok(scoreCourse(horse(poor)) < 65);
  const good = poor.map(r => ({ ...r, finishPosition: 1, margin: 0 }));
  assert.ok(scoreCourse(horse(good)) > scoreCourse(horse([good[0]])));
  assert.ok(scoreCourse(horse([good[0]])) < 80);
});

test('near-distance boundary, future runs, confirmed finish and duplicates are handled', () => {
  const h = horse([run, { ...run }, { ...run, date: '2026-09-02', distance: 1400 },
    { ...run, date: '2026-09-03', distance: 1401 }, { ...run, date: '2026-10-03' },
    { ...run, date: '2026-09-04', confirmedFinishPosition: 0 },
    { ...run, date: '2026-09-05', confirmedFinishPosition: 8 }]);
  const profile = buildCoursePerformanceProfile(h);
  assert.equal(profile.sampleCount, 3);
  assert.equal(profile.topThreeCount, 2);
  assert.deepEqual(profile.runs.map(r=>r.weight), [1, 0.75, 1]);
  assert.equal(profile.runs[2].run.finishPosition, 8);
});

test('public course explanation cites only the records actually scored', () => {
  const h = horse([run, { ...run, course: '東京', finishPosition: 1 }, { ...run, distance: 1800 }]);
  const course = buildCourseAnalysis(h, {});
  h.analysis = { course };
  const text = publicFactorExplanation({ key: 'course', performanceProfile: course.performanceProfile }, { horse: h });
  assert.match(text, /^京都芝1200m前後で1走し、3着以内1回/);
  assert.match(text, /1走だけ/);
  assert.doesNotMatch(text, /他場も含む|芝全体|標準コース/);
});

test('obstacle codes do not count as flat turf evidence', () => {
  assert.equal(scoreCourse(horse([{ ...run, surfaceCode: '51' }])), 65);
});
