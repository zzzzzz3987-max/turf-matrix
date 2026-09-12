import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CAUTION_MODEL_VERSION, selectPublicRoleCautionShadow, assertUpcomingPublicRoleRaces } from '../intelligence/public-role-caution-shadow.mjs';
import { loadFrozenPublicRoleDays } from './lib/public-role-archive.mjs';
import { summarizePublicRoleRecords } from './lib/public-role-performance.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dir = join(root, 'data/shadow', CAUTION_MODEL_VERSION);
const read = path => JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
const hash = value => createHash('sha256').update(value).digest('hex');
const args = process.argv.slice(2);
const compact = horse => horse ? { number: horse.number, name: horse.name, score: horse.aiScore ?? horse.tmIndex } : null;
const predictions = snapshot => snapshot.races.map(race => {
  const selected = selectPublicRoleCautionShadow(race);
  return { bundleId: race.bundleId, time: race.time, name: race.name,
    ...Object.fromEntries(['productionValue', 'productionDanger', 'cautionValue', 'cautionDanger'].map(key => [key, compact(selected[key])])), evidence: selected.evidence };
});
const modelSha256 = hash(Buffer.concat([
  readFileSync(join(root, 'tools/intelligence/public-role-caution-shadow.mjs')),
  readFileSync(join(root, 'src/lib/public-role-selection.js')),
]));
const persist = (path, data) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
};

if (args.includes('--freeze')) {
  const inputAt = args.indexOf('--input');
  if (inputAt < 0 || !args[inputAt + 1]) throw new Error('--freeze requires --input with the unpublished race snapshot');
  const input = resolve(root, args[inputAt + 1]);
  const snapshot = read(input);
  const date = snapshot.meta?.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') || !snapshot.races?.length) throw new Error('Race date or races missing');
  if (existsSync(join(root, `data/archive/${date}-results.json`))) throw new Error('Results already exist; prospective freeze refused');
  const frozenAt = new Date().toISOString();
  assertUpcomingPublicRoleRaces({ date, races: snapshot.races, now: frozenAt });
  const payload = { modelVersion: CAUTION_MODEL_VERSION, modelSha256, date, inputSha256: hash(readFileSync(input)), predictions: predictions(snapshot) };
  const output = join(dir, `${date}-pre-race.json`);
  const predictionSha256 = hash(JSON.stringify(payload));
  if (existsSync(output)) {
    if (read(output).predictionSha256 !== predictionSha256) throw new Error('Frozen predictions differ; refusing overwrite');
  } else persist(output, { status: 'frozen-pre-race-shadow', frozenAt, productionConnected: false, predictionSha256, payload });
  console.log(JSON.stringify({ output, predictionSha256, productionConnected: false }));
} else {
  const prospective = args.includes('--evaluate');
  const days = [];
  if (prospective) {
    for (const name of existsSync(dir) ? readdirSync(dir).filter(name => name.endsWith('-pre-race.json')) : []) {
      const artifact = read(join(dir, name));
      const p = artifact.payload;
      assertUpcomingPublicRoleRaces({ date: p.date, races: p.predictions, now: artifact.frozenAt });
      if (artifact.status !== 'frozen-pre-race-shadow' || artifact.productionConnected !== false ||
        p.modelVersion !== CAUTION_MODEL_VERSION || p.modelSha256 !== modelSha256 ||
        hash(JSON.stringify(p)) !== artifact.predictionSha256 ||
        p.predictions.some(r => !(new Date(artifact.frozenAt) < new Date(`${p.date}T${r.time}:00+09:00`)))) throw new Error(`Invalid prospective artifact: ${name}`);
      const resultPath = join(root, `data/archive/${p.date}-results.json`);
      if (existsSync(resultPath)) days.push({ date: p.date, predictions: p.predictions, results: read(resultPath) });
    }
  } else {
    for (const day of loadFrozenPublicRoleDays({ root })) days.push({ date: day.date, predictions: predictions(day.snapshot), results: day.results });
  }
  const keys = ['productionValue', 'cautionValue', 'productionDanger', 'cautionDanger'];
  const buckets = Object.fromEntries(keys.map(key => [key, []]));
  const paired = Object.fromEntries(keys.map(key => [key, []]));
  const changes = { Value: 0, Danger: 0 };
  const details = [];
  const normalize = name => String(name ?? '').normalize('NFKC').replace(/\s/g, '');
  for (const day of days) for (const p of day.predictions) {
    const race = day.results.races.find(r => r.bundleId === p.bundleId);
    if (!race) continue;
    const rows = {};
    for (const key of keys) {
      const h = p[key];
      const result = h && race.horses.find(r => r.horseNumber === h.number && normalize(r.horseName) === normalize(h.name));
      if (h && !result) throw new Error(`Result identity mismatch: ${day.date} ${p.bundleId} ${h.name}`);
      rows[key] = result ? { ...result, date: day.date, raceId: p.bundleId, payoutAvailable: Number.isFinite(result.winPayout) && Number.isFinite(result.placePayout) } : null;
      if (rows[key]) buckets[key].push(rows[key]);
    }
    for (const role of ['Value', 'Danger']) {
      const a = `production${role}`, b = `caution${role}`;
      if (rows[a] && rows[b]) { paired[a].push(rows[a]); paired[b].push(rows[b]); }
      if ((p[a]?.number ?? null) !== (p[b]?.number ?? null)) changes[role]++;
    }
    details.push({ date: day.date, ...p, finishes: Object.fromEntries(keys.map(key => [key, rows[key]?.finishPosition ?? null])) });
  }
  const stats = Object.fromEntries(keys.map(key => [key, summarizePublicRoleRecords(buckets[key])]));
  const pairedStats = Object.fromEntries(keys.map(key => [key, summarizePublicRoleRecords(paired[key])]));
  const gates = {};
  for (const role of ['Value', 'Danger']) {
    const a = `production${role}`, b = `caution${role}`;
    gates[role] = {
      prospectiveOnly: prospective,
      enoughProspectiveSamples: prospective && stats[b].sampleSize >= 30,
      enoughChangedSelections: changes[role] >= 5,
      usableCoverage: stats[a].sampleSize > 0 && stats[b].sampleSize / stats[a].sampleSize >= 0.3,
      outcomeImproved: stats[b].sampleSize > 0 && stats[a].sampleSize > 0 && (role === 'Value'
        ? stats[b].topThreeRate > stats[a].topThreeRate
        : stats[b].missedTopThreeRate > stats[a].missedTopThreeRate),
      secondaryMaintained: stats[b].sampleSize > 0 && stats[a].sampleSize > 0 && (role === 'Value'
        ? stats[b].placeReturnRate >= stats[a].placeReturnRate
        : stats[b].winRate <= stats[a].winRate),
    };
  }
  const report = { modelVersion: CAUTION_MODEL_VERSION, modelSha256, retrospectiveDiagnosticOnly: !prospective,
    productionConnected: false, dates: days.map(d => d.date), comparedRaces: details.length, changes, stats, pairedStats, gates,
    adoptionCandidate: Object.fromEntries(Object.entries(gates).map(([key, gate]) => [key, Object.values(gate).every(Boolean)])), details };
  const output = join(root, 'docs/analysis', `${CAUTION_MODEL_VERSION}-${prospective ? 'prospective' : 'diagnostic'}.json`);
  persist(output, report);
  console.log(JSON.stringify({ ...report, details: undefined, output }, null, 2));
}
