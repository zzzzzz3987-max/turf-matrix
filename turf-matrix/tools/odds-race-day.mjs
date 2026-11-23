import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dataDate = data => data?.meta?.date ?? data?.races?.[0]?.id?.slice(0, 10) ?? null;

export const getOddsRaceDayEligibility = ({ published, candidate, allRaceSignals, now = new Date() }) => {
  const instant = new Date(now);
  if (!Number.isFinite(instant.getTime())) throw new Error('Invalid race-day check time');
  const today = new Date(instant.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const publishedDate = dataDate(published);
  const candidateDate = dataDate(candidate);
  const useCandidate = candidateDate && (!publishedDate || candidateDate >= publishedDate);
  const data = useCandidate ? candidate : published;
  const raceDate = dataDate(data);
  const source = useCandidate ? 'candidate' : 'published';
  if (raceDate !== today) return { eligible: false, today, raceDate, source, reason: 'no-current-race-day' };
  if (allRaceSignals?.date !== today) throw new Error('Current race day has missing or stale all-race signals');
  const races = allRaceSignals.races;
  if (!Array.isArray(races) || !races.length || allRaceSignals.raceCount !== races.length) {
    throw new Error('Current race day has an incomplete all-race schedule');
  }
  const ids = new Set();
  for (const race of races) {
    if (!race.id?.startsWith(`${today}-`) || ids.has(race.id)
      || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(race.time ?? '')
      || !Number.isInteger(race.fieldSize) || race.fieldSize < 1 || race.fieldSize > 18) {
      throw new Error('Current race day has an invalid or duplicate race');
    }
    ids.add(race.id);
  }
  if (!Array.isArray(data.races) || !data.races.length || data.races.some(race => !ids.has(race.id))) {
    throw new Error('Current detailed schedule does not match the all-race schedule');
  }
  return { eligible: true, today, raceDate, source, raceCount: races.length, reason: 'current-race-day-ready' };
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const root = process.argv.slice(2).find(arg => arg.startsWith('--input-root='))?.slice('--input-root='.length);
    if (!root) throw new Error('--input-root is required');
    const read = name => {
      const path = join(root, 'tools', name);
      return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')) : null;
    };
    console.log(JSON.stringify(getOddsRaceDayEligibility({
      published: read('week-data.json'), candidate: read('week-data.batch-candidate.json'),
      allRaceSignals: read('all-race-signals.json'),
    })));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
