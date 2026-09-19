export function resolveGoingForecast(race, condition, forecast) {
  if (condition?.status === 'active' && ['良', '稍重', '重', '不良'].includes(condition.going)) return null;
  if (forecast?.date !== race.raceDate || forecast?.track !== race.course) return null;
  if (!['芝', 'ダ', 'ダート'].includes(race.surface) || !['良', '稍重', '重', '不良'].includes(forecast.going)) return null;
  return { going: forecast.going, label: `${forecast.going}馬場想定・公式発表前` };
}
