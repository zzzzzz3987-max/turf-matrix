import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveGoingForecast } from '../going-forecast.mjs';
const race = { raceDate: '2026-09-20', course: '中山', surface: '芝' };
const forecast = { date: '2026-09-20', track: '中山', going: '重' };
test('forecast is explicitly labeled and applies only to the intended date and track', () => {
  assert.match(resolveGoingForecast(race, null, forecast).label, /公式発表前/);
  assert.equal(resolveGoingForecast({...race,course:'阪神'}, null, forecast), null);
  assert.equal(resolveGoingForecast({...race,raceDate:'2026-09-21'}, null, forecast), null);
  assert.equal(resolveGoingForecast({...race,surface:'障'}, null, forecast), null);
});
test('official going always supersedes the forecast, including good going', () => {
  for (const going of ['良','稍重','重','不良']) assert.equal(resolveGoingForecast(race,{status:'active',going},forecast),null);
});
