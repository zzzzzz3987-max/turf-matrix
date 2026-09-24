import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHorseBrief, buildIndexLeaderBrief } from '../../../src/lib/public-view-model.js';

test('brief uses one supported strength without exposing factor scores', () => {
  const horse = { analysis: { factorsDetail: {
    distance: { status: 'active', score: 81, summary: '同距離で好走しています。' },
    ability: { status: 'active', score: 74, summary: '近走の内容を評価。' },
  } } };
  const before = JSON.stringify(horse);
  const brief = buildHorseBrief(horse);
  assert.match(brief.headline, /推し材料は「今回距離への対応力」/);
  assert.equal(brief.reason, '同距離で好走しています。');
  assert.doesNotMatch(brief.headline, /81|74/);
  assert.equal(JSON.stringify(horse), before);
});

test('missing and weak factors never become a positive headline', () => {
  assert.match(buildHorseBrief({}).headline, /情報が不足/);
  const horse = { analysis: { factorsDetail: {
    distance: { status: 'missing', score: 90 }, ability: { status: 'active', score: 55 },
  } } };
  assert.match(buildHorseBrief(horse).headline, /慎重/);
  assert.equal(buildHorseBrief(horse).reason, null);
});

test('brief retains the qualification on a light final workout', () => {
  const horse = { analysis: { factorsDetail: { training: { status: 'active', score: 75 } },
    trainingEval: { grade: 'B', details: { count: 3, final: { score: 55 } } } } };
  assert.match(buildHorseBrief(horse).caution, /軽めの調整/);
  assert.match(buildHorseBrief(horse).caution, /状態不良とは判断しません/);
});

test('brief prioritizes the horse evidence over a distance definition', () => {
  const horse = { analysis: { factorsDetail: { distance: { status: 'active', score: 82,
    summary: '1800mは非根幹距離。前走1700mから100m延長。近い距離での走りから対応力を評価。' } } } };
  const brief = buildHorseBrief(horse);
  assert.doesNotMatch(brief.reason, /非根幹/);
  assert.match(brief.reason, /100m延長/);
  assert.match(brief.reason, /対応力/);
});

test('leader brief explains the strongest weighted advantage over index rank two', () => {
  const leader = {
    id: 'leader', number: 4, aiScore: 82,
    analysis: {
      indexContributions: [
        { key: 'ability', contribution: 20, weight: 0.25 },
        { key: 'form', contribution: 14, weight: 0.2 },
      ],
      factorsDetail: { ability: { summary: '近走内容から地力を高く評価。' } },
    },
  };
  const runnerUp = {
    id: 'runner-up', number: 2, aiScore: 78,
    analysis: { indexContributions: [
      { key: 'ability', contribution: 16, weight: 0.25 },
      { key: 'form', contribution: 15, weight: 0.2 },
    ] },
  };

  const brief = buildIndexLeaderBrief(leader, [runnerUp, leader]);
  assert.match(brief.headline, /指数1位の決め手は「相手関係まで見た地力」/);
  assert.match(brief.reason, /指数2位に4点差/);
  assert.match(brief.reason, /近走内容から地力を高く評価/);
});

test('index leader fallback uses the viewer-facing 推し材料 wording', () => {
  const leader = {
    id: 'leader', number: 4, aiScore: 82,
    analysis: {
      indexContributions: [{ key: 'ability', contribution: 20, weight: 0.25 }],
      factorsDetail: { ability: { summary: '近走内容から地力を高く評価。' } },
    },
  };
  assert.match(buildIndexLeaderBrief(leader, [leader]).headline, /指数1位の推し材料は/);
});

test('short hooks lead with a viewer-friendly reason and keep its evidence underneath', () => {
  const horse = { analysis: { factorsDetail: {
    training: { status: 'active', score: 79, summary: '最終追い切りで終いを伸ばしました。', evidence: ['最終 20260921 坂路 4F53.4-1F12.1'] },
    ability: { status: 'active', score: 74, summary: '近走の内容を評価。' },
  } } };
  const brief = buildHorseBrief(horse);
  assert.equal(brief.headline, '推し材料は「追い切りから見える仕上がり」');
  assert.match(brief.reason, /最終追い切りと一週前の内容/);
});

test('distance brief adds nearby-distance placing evidence when available', () => {
  const horse = {
    currentRace: { distance: 1800, surface: 'ダ' },
    pastRuns: [
      { distance: 1700, surface: 'ダ', finishPosition: 1 },
      { distance: 1700, surface: 'ダ', finishPosition: 2 },
      { distance: 1800, surface: 'ダ', finishPosition: 3 },
      { distance: 1800, surface: '芝', finishPosition: 1 },
    ],
    analysis: { factorsDetail: { distance: { status: 'active', score: 82,
      summary: '1800mは非根幹距離。前走1700mから100m延長。終盤の位置変化と近い距離での走りから対応力を評価。',
      evidence: ['1800m前後の経験 3走'] } } },
  };
  const brief = buildHorseBrief(horse);
  assert.equal(brief.headline, '推し材料は「1800mで3着、1700mで連対2回」');
  assert.match(brief.reason, /1800m前後を3走経験/);
  assert.doesNotMatch(brief.reason, /1700mで連対2回/);
  assert.doesNotMatch(brief.reason, /芝/);
});

test('course brief leads with the horse\'s own record at today\'s venue and surface', () => {
  const horse = {
    currentRace: { course: '中山', surface: 'ダ', distance: 1800 },
    pastRuns: [
      { course: '中山', surface: 'ダ', finishPosition: 2 },
      { course: '中山', surface: 'ダ', finishPosition: 3 },
      { course: '中山', surface: 'ダ', finishPosition: 7 },
      { course: '中山', surface: '芝', finishPosition: 1 },
      { course: '東京', surface: 'ダ', finishPosition: 1 },
    ],
    analysis: { factorsDetail: {
      course: { status: 'active', score: 82, summary: '今回の舞台への経験を評価。' },
      distance: { status: 'active', score: 75, summary: '今回距離への対応力を評価。' },
    } },
  };

  const brief = buildHorseBrief(horse);
  assert.equal(brief.headline, '推し材料は「中山ダート3走で3着以内2回」');
  assert.match(brief.reason, /坂コース/);
  assert.doesNotMatch(brief.reason, /中山での直接実績/);
  assert.doesNotMatch(brief.headline, /距離適性|コース適性/);
});

test('course brief avoids presenting an unproven same-course record as a positive hook', () => {
  const horse = {
    currentRace: { course: '中山', surface: 'ダ', distance: 1800 },
    pastRuns: [{ course: '中山', surface: 'ダ', finishPosition: 8 }],
    analysis: { factorsDetail: { course: { status: 'active', score: 81, summary: 'コース形状を評価。' } } },
  };
  assert.equal(buildHorseBrief(horse).headline, '推し材料は「今回の舞台で生きる経験」');
});

test('course brief falls back to positive same-surface results without a same-venue placing', () => {
  const horse = {
    currentRace: { course: '中山', surface: 'ダ', distance: 1800 },
    pastRuns: [
      { course: '東京', surface: 'ダ', finishPosition: 2 },
      { course: '阪神', surface: 'ダ', finishPosition: 3 },
      { course: '中山', surface: '芝', finishPosition: 1 },
    ],
    analysis: { factorsDetail: { course: { status: 'active', score: 81, summary: '今回条件への適性を評価。' } } },
  };
  const brief = buildHorseBrief(horse);
  assert.equal(brief.headline, '推し材料は「同じダート2走で3着以内2回」');
  assert.doesNotMatch(brief.reason, /同じダート2走で3着以内2回/);
});

test('index leader headline uses a concrete course record when that is the deciding factor', () => {
  const leader = {
    id: 'leader', number: 4, aiScore: 82,
    currentRace: { course: '中山', surface: 'ダ', distance: 1800 },
    pastRuns: [
      { course: '中山', surface: 'ダ', finishPosition: 1 },
      { course: '中山', surface: 'ダ', finishPosition: 3 },
    ],
    analysis: {
      indexContributions: [{ key: 'course', contribution: 20, weight: 0.3 }],
      factorsDetail: { course: { status: 'active', score: 82, summary: '同コース適性を評価。' } },
    },
  };
  const runnerUp = {
    id: 'runner-up', number: 2, aiScore: 78,
    analysis: { indexContributions: [{ key: 'course', contribution: 18, weight: 0.3 }] },
  };

  const brief = buildIndexLeaderBrief(leader, [leader, runnerUp]);
  assert.match(brief.headline, /指数1位の決め手は「中山ダート2走で3着以内2回」/);
  assert.doesNotMatch(brief.reason, /中山での直接実績/);
});

test('tied leaders are not described as having a score lead', () => {
  const first = { id: 'first', number: 1, aiScore: 80, analysis: { indexContributions: [{ key: 'ability', contribution: 20, weight: 0.3 }] } };
  const second = { id: 'second', number: 2, aiScore: 80, analysis: { indexContributions: [{ key: 'ability', contribution: 19, weight: 0.3 }] } };

  const brief = buildIndexLeaderBrief(first, [first, second]);
  assert.match(brief.reason, /指数2位と同点/);
  assert.doesNotMatch(brief.reason, /\d+点差/);
});
