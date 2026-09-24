import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { diagnoseCurrentMatrix } from './diagnose-current-matrix.mjs';
import { buildGoingAdjustment } from '../intelligence/going-adjustment.mjs';
import { buildLoadAnalysis } from '../intelligence/load-ai.mjs';
import { buildRaceValueMetrics } from '../intelligence/value-ai.mjs';
import { fetchLiveDataUpdate } from '../../src/data/live-data-refresh.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const runner = process.env.TM_AUDIT_RUNNER ?? 'C:/Users/R/AppData/Local/TurfMatrix/odds-runner/turf-matrix';
const read = (path) => JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
const sha = (value) => createHash('sha256').update(value).digest('hex');
const fetchDocument = async (url) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000), cache: 'no-store' });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const source = await response.text();
  return { data: JSON.parse(source), sha256: sha(source) };
};
const base = 'https://turf-matrix.vercel.app';
const manifest = await fetchDocument(`${base}/live/version.json`);
const week = await fetchDocument(new URL(manifest.data.weekDataUrl, base));
const signals = await fetchDocument(new URL(manifest.data.allRaceSignalsUrl, base));
const confirmManifest = await fetchDocument(`${base}/live/version.json`);
if (confirmManifest.data.version !== manifest.data.version) throw new Error('Live version changed during audit; retry');
const horses = week.data.races.flatMap((race) => race.horses ?? []);
const diagnosis = diagnoseCurrentMatrix(week.data);
const numericMissing = (value) => value == null || value === '';
const counts = (items) => items.reduce((out, key) => ({ ...out, [key]: (out[key] ?? 0) + 1 }), {});
const missingRuns = horses.flatMap((horse) => (horse.pastRuns ?? [])
  .filter((run) => numericMissing(run.margin) || numericMissing(run.finishPosition) || Number(run.finishPosition) <= 0)
  .map((run) => ({ horse: horse.name, date: run.date, margin: run.margin, finish: run.finishPosition, surface: run.surface })));
const driftPaths = [
  'tools/intelligence/index.mjs', 'tools/intelligence/form-ai.mjs', 'tools/intelligence/course-ai.mjs',
  'tools/intelligence/training-ai.mjs', 'tools/intelligence/going-adjustment.mjs', 'tools/intelligence/load-ai.mjs',
  'tools/intelligence/value-ai.mjs', 'src/lib/public-role-selection.js', 'src/data/live-data-refresh.js',
  'tools/public-battle-ticket-plan.mjs', 'tools/auto-odds-update.mjs',
];
const files = driftPaths.map((path) => {
  const local = resolve(root, path);
  const deployedRunner = resolve(runner, path);
  const localSha = existsSync(local) ? sha(readFileSync(local)) : null;
  const runnerSha = existsSync(deployedRunner) ? sha(readFileSync(deployedRunner)) : null;
  const normalizedSha = (file) => existsSync(file) ? sha(readFileSync(file, 'utf8').replace(/\r\n/g, '\n')) : null;
  const localTextSha = normalizedSha(local);
  const runnerTextSha = normalizedSha(deployedRunner);
  return { path, localSha, runnerSha, localTextSha, runnerTextSha, equal: localTextSha != null && localTextSha === runnerTextSha };
});
const tied = [1, 2, 3].map((number) => ({ number, tmIndex: 75, popularity: 3, odds: 4, oddsDetail: { status: 'active' } }));
const video = read(resolve(root, 'data/master/training-video-reviews.json'));
const mismatchedUpdate = await fetchLiveDataUpdate({
  currentVersion: 'audit-old',
  fetchImpl: async (url) => ({ ok: true, json: async () => url.includes('version.json')
    ? { version: 'audit-next', weekDataUrl: '/audit-week', allRaceSignalsUrl: '/audit-signals' }
    : url === '/audit-week' ? { meta: { date: '2026-09-22' }, races: [] }
      : { date: '2026-09-21', races: [] } }),
});
const probes = {
  mismatchedLivePayload: { accepted: mismatchedUpdate.changed, weekDate: mismatchedUpdate.weekData.meta.date,
    signalsDate: mismatchedUpdate.allRaceSignals.date, weekRaceCount: mismatchedUpdate.weekData.races.length },
  missingGoingInputs: buildGoingAdjustment({ currentRace: { surface: '芝', going: '重' }, pastRuns: [
    ...Array.from({ length: 3 }, () => ({ surface: '芝', trackCondition: '重', margin: null, finishPosition: null, fieldSize: 12 })),
    { surface: '芝', trackCondition: '良', margin: 2, finishPosition: 10, fieldSize: 12 },
  ] }),
  missingLoad: buildLoadAnalysis({ carriedWeight: null, currentRace: { carriedWeight: null }, pastRuns: [] }, { load: { medianEquivalentWeight: 57 } }),
  tiedValue: [...buildRaceValueMetrics(tied)].map(([horse, metrics]) => ({ number: horse.number, ...metrics })),
};
const report = {
  schemaVersion: 1, generatedAt: new Date().toISOString(),
  scope: 'Read-only production payload audit plus local-code probes. Runner hashes do not prove deployed frontend code identity. Synthetic probes do not establish affected live horses.',
  live: { manifest: manifest.data, weekSha256: week.sha256, signalsSha256: signals.sha256,
    meta: week.data.meta, signalDate: signals.data.date, signalRaceCount: signals.data.races?.length,
    diagnosis: diagnosis.summary, errors: diagnosis.errors,
    factorStatuses: Object.fromEntries(['ability', 'form', 'distance', 'course', 'training', 'blood', 'pace', 'trackBias', 'stable'].map((key) => [key, counts(horses.map((h) => h.analysis?.factorsDetail?.[key]?.status ?? 'absent'))])),
    missingCurrentWeights: horses.filter((h) => numericMissing(h.carriedWeight ?? h.currentRace?.carriedWeight)).map((h) => h.name),
    incompleteHistoricalResults: missingRuns,
    closingBenchmarks: counts(horses.flatMap((h) => (h.pastRuns ?? []).map((run) => run.closingBenchmark?.status ?? 'absent'))),
    videoReviewCount: horses.filter((h) => h.analysis?.factorsDetail?.training?.videoReview).length,
  },
  localVideoPolicy: video.policy, files, probes,
  diagnosisRows: diagnosis.rows,
};
const output = resolve(root, 'docs/analysis/full-audit-2026-09-23.json');
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ output, live: { ...report.live, meta: undefined, incompleteHistoricalResults: missingRuns.length }, drift: files.filter((f) => !f.equal).map((f) => f.path), probeAdjustments: { going: probes.missingGoingInputs.adjustment, load: probes.missingLoad.adjustment } }, null, 2));
