import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRacePublicConclusion } from '../../../src/lib/public-view-model.js';
const race = factors => ({ oddsStatus: 'active', horses: [85,83,81,75].map((score,i) => ({
  id: String(i+1), number:i+1, name:`horse-${i+1}`, tmIndex:score, popularity:i===3?1:i+2, odds:2,
  analysis:{factorsDetail:i===3?factors:{}} })) });
const f = score => ({status:'active',score});
test('mismatch gets a neutral label rather than fabricated danger evidence', () => {
  const c=buildRacePublicConclusion(race({}));
  assert.equal(c.danger.status,'none');
  assert.equal(c.marketMismatch.horse.number,4);
  assert.match(c.marketMismatch.note,/負ける予測ではありません/);
});
test('danger explains the actual independent evidence and does not duplicate mismatch', () => {
  const c=buildRacePublicConclusion(race({form:f(50),distance:f(50)}));
  assert.equal(c.danger.horse.number,4);
  assert.match(c.danger.note,/近走内容に不安/);
  assert.match(c.danger.note,/今回距離への適性に不安/);
  assert.equal(c.marketMismatch.horse,null);
});
test('strong ability protects the runner without changing the index', () => {
  const r=race({ability:f(75),form:f(50),distance:f(50)}), before=JSON.stringify(r);
  assert.equal(buildRacePublicConclusion(r).danger.status,'none');
  assert.equal(JSON.stringify(r),before);
});
test('incomplete market defers both classifications', () => {
  const r=race({form:f(50),distance:f(50)});r.horses[0].odds=null;
  const c=buildRacePublicConclusion(r);
  assert.equal(c.danger.status,'pending');assert.equal(c.marketMismatch.status,'none');
});
