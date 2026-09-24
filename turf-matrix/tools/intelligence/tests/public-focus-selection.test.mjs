import test from 'node:test';
import assert from 'node:assert/strict';
import { selectPublicFocusHorses, selectPublicValueHorse } from '../../../src/lib/public-role-selection.js';

const horse = (number, score, marketGap = null) => ({
  id: String(number),
  number,
  name: `horse-${number}`,
  aiScore: score,
  popularity: number,
  analysis: {
    factorsDetail: {
      value: { eligible: marketGap != null, marketGap, ev: marketGap == null ? null : 1.1 },
    },
  },
});

test('focus horses select one axis, three opponents and one distinct value horse', () => {
  const race = { horses: [
    horse(1, 90), horse(2, 88), horse(3, 85, 4), horse(4, 83, 2), horse(5, 82, 3), horse(6, 80, 1),
  ] };

  const focus = selectPublicFocusHorses(race);
  assert.deepEqual(focus.axis.map(({ number }) => number), [1]);
  assert.deepEqual(focus.opponents.map(({ number }) => number), [2, 3, 4]);
  assert.deepEqual(focus.value.map(({ number }) => number), [5]);
  assert.equal(new Set([...focus.axis, ...focus.opponents, ...focus.value].map(({ number }) => number)).size, 5);
  assert.equal(selectPublicValueHorse(race).number, 3);
});

test('focus keeps only evaluated opponents when the field has fewer horses', () => {
  const race = { horses: [horse(1, 90), horse(2, 88), horse(3, 85, 1)] };
  const focus = selectPublicFocusHorses(race);
  assert.deepEqual(focus.axis.map(({ number }) => number), [1]);
  assert.deepEqual(focus.opponents.map(({ number }) => number), [2, 3]);
});
