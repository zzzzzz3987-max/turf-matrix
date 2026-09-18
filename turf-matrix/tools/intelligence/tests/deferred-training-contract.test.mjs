import test from 'node:test';
import assert from 'node:assert/strict';
import { validateIntelligenceOutput } from '../output-contract.mjs';

test('only explicitly deferred short-turnaround training permits null factors', () => {
  const training = { indexEligible: false, status: 'partial', raceIntervalDays: 7 };
  const horse = { name: 'test', analysis: { factors: { training: null, trainingLap: null }, factorsDetail: { training } } };
  const errors = () => validateIntelligenceOutput({ races: [{ horses: [horse] }] }).errors
    .filter(error => /factors\.training/.test(error));
  assert.equal(errors().length, 0);
  training.indexEligible = true;
  assert.equal(errors().length, 2);
  training.indexEligible = false;
  training.raceIntervalDays = 10;
  assert.equal(errors().length, 2);
});
