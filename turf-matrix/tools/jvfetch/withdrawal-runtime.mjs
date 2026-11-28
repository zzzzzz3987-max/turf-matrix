import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { parseCsvRows, readTextSmart } from '../parsers/parser-contract.mjs';

const courses = { sapporo: '01', hakodate: '02', fukushima: '03', niigata: '04', tokyo: '05', nakayama: '06', chukyo: '07', kyoto: '08', hanshin: '09', kokura: '10' };
const courseNames = { '01': '\u672d\u5e4c', '02': '\u51fd\u9928', '03': '\u798f\u5cf6', '04': '\u65b0\u6f5f', '05': '\u6771\u4eac', '06': '\u4e2d\u5c71', '07': '\u4e2d\u4eac', '08': '\u4eac\u90fd', '09': '\u962a\u795e', '10': '\u5c0f\u5009' };
const nameKey = value => String(value ?? '').normalize('NFKC').replace(/[\s\u3000]/g, '');
const fail = message => { throw new Error(`Official withdrawals: ${message}`); };

export const buildWithdrawalRuntime = ({ config, snapshot, fields, now = Date.now(), snapshotSha256 = null }) => {
  const generated = Date.parse(snapshot.GeneratedAt);
  if (snapshot.SchemaVersion !== 1 || snapshot.Source !== 'JV-Link 0B14 AV' || snapshot.Complete !== true
    || snapshot.RaceDate !== config.raceDate || !Array.isArray(snapshot.Withdrawals)
    || !Number.isFinite(generated) || generated > now + 60000 || now - generated > 10 * 60000) fail('missing, incomplete, stale or wrong-day snapshot');
  if (!Array.isArray(config.bundles) || !config.bundles.length || new Set(config.bundles).size !== config.bundles.length
    || config.expectedRaceCount !== config.bundles.length) fail('invalid configured race list');
  const selected = new Map(fields.map(field => [field.bundleId, field]));
  if (selected.size !== config.bundles.length || config.bundles.some(bundle => !selected.has(bundle))) fail('incomplete source cards');
  const excluded = {};
  const evidence = [];
  const seen = new Set();
  for (const record of snapshot.Withdrawals) {
    const announcement = Date.parse(record.AnnouncedAt);
    const identity = /^(\d{8})-(0[1-9]|10)-(0[1-9]|[1-9]\d)-(0[1-9]|[1-9]\d)-(0[1-9]|1[0-2])$/.exec(record.RaceKey);
    if (record.RaceDate !== config.raceDate || !['1', '2'].includes(record.DataKubun)
      || !identity || identity[1] !== config.raceDate.replaceAll('-', '')
      || identity[2] !== record.CourseCode || Number(identity[5]) !== record.RaceNo
      || !Number.isInteger(record.HorseNumber) || record.HorseNumber < 1 || record.HorseNumber > 18
      || !Number.isInteger(record.RaceNo) || record.RaceNo < 1 || record.RaceNo > 12
      || !nameKey(record.HorseName) || /[?\ufffd]/u.test(record.HorseName)
      || !Number.isFinite(announcement) || announcement > generated + 60000) fail('invalid AV identity or announcement');
    const slot = `${record.RaceKey}/${record.HorseNumber}`;
    if (seen.has(slot)) fail('duplicate AV slot');
    seen.add(slot);
    const field = fields.find(item => item.courseCode === record.CourseCode && item.raceNo === record.RaceNo);
    if (!field) continue;
    if (record.RaceKey !== field.raceKey) fail('meeting identity mismatch');
    const entry = field.entries.find(item => item.number === record.HorseNumber);
    // Previously hand-filtered inputs may retain the independently confirmed identity in config.
    const previous = (config.officialWithdrawals ?? []).find(item => item.raceKey === record.RaceKey
      && item.horseNumber === record.HorseNumber && item.raceDate === config.raceDate);
    const expectedName = entry?.name ?? previous?.horseName;
    if (!expectedName || nameKey(expectedName) !== nameKey(record.HorseName)) fail('unknown slot or horse-name mismatch');
    (excluded[field.bundleId] ??= []).push(record.HorseNumber);
    evidence.push({ bundleId: field.bundleId, raceDate: config.raceDate, raceKey: record.RaceKey,
      horseNumber: record.HorseNumber, horseName: record.HorseName, dataKubun: record.DataKubun,
      announcedAt: record.AnnouncedAt, source: snapshot.Source, snapshotSha256 });
  }
  const expectedHorseNumbersByBundle = {};
  for (const field of fields) {
    const numbers = field.entries.map(entry => entry.number);
    if (new Set(numbers).size !== numbers.length || numbers.some(n => !Number.isInteger(n) || n < 1 || n > 18)) fail('invalid or duplicate card slots');
    const removed = excluded[field.bundleId] ?? [];
    removed.sort((a, b) => a - b);
    const original = [...new Set([...numbers, ...removed])].sort((a, b) => a - b);
    if (original.some((n, i) => n !== i + 1)) fail('unconfirmed missing runner; a revoked withdrawal may require refreshed source cards');
    const active = numbers.filter(n => !removed.includes(n)).sort((a, b) => a - b);
    if (!active.length) fail('no active runners');
    expectedHorseNumbersByBundle[field.bundleId] = active;
  }
  return { ...structuredClone(config), excludedHorseNumbersByBundle: excluded,
    officialWithdrawals: evidence, expectedHorseNumbersByBundle,
    withdrawalSnapshot: { source: snapshot.Source, generatedAt: snapshot.GeneratedAt, sha256: snapshotSha256 } };
};

export const withdrawalRuntimeFromFiles = ({ root, config, source = join(root, 'data/target/race-withdrawals.latest.json'), now = Date.now() }) => {
  const bytes = readFileSync(source);
  const read = path => JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
  const summary = read(join(root, 'tools/jvlink/output/week-race-summary.json'));
  const fields = config.bundles.map(bundleId => {
    const match = /^(\d{4}-\d{2}-\d{2})-([a-z]+)-(\d{2})R$/.exec(bundleId);
    if (!match || match[1] !== config.raceDate || !courses[match[2]]) fail('invalid bundle identity');
    const courseCode = courses[match[2]];
    const raceNo = Number(match[3]);
    const races = summary.races.filter(race => race.raceDate === config.raceDate && race.courseCode === courseCode && Number(race.raceNo) === raceNo);
    if (races.length !== 1) fail('missing or ambiguous official meeting');
    const paths = ['tools/csv/input/races', 'data/target/races'].map(dir => join(root, dir, bundleId, 'current-race-detail.csv'));
    const path = paths.find(item => existsSync(item));
    if (!path) fail(`missing current card: ${bundleId}`);
    const rows = parseCsvRows(readTextSmart(path).text);
    if (rows.some(row => row[0] !== config.raceDate.slice(2).replaceAll('-', '') || row[1] !== courseNames[courseCode] || Number(row[2]) !== raceNo)) fail('wrong-day, wrong-venue or wrong-race card');
    return { bundleId, courseCode, raceNo, raceKey: races[0].raceKey,
      entries: rows.map(row => ({ number: Number(row[3]), name: row[7] })) };
  });
  return buildWithdrawalRuntime({ config, fields, snapshot: JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')),
    now, snapshotSha256: createHash('sha256').update(bytes).digest('hex') });
};

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const { values } = parseArgs({ options: { config: { type: 'string' }, out: { type: 'string' } } });
  const configPath = values.config ?? process.env.TURF_MATRIX_RACE_CONFIG
    ?? (existsSync(join(root, 'tools/jvlink/output/race-batch-runtime.json')) ? 'tools/jvlink/output/race-batch-runtime.json' : 'tools/race-batch-config.json');
  const destination = resolve(root, values.out ?? 'tools/pad-runtime/withdrawal-acquisition-runtime.json');
  const within = relative(join(root, 'tools/pad-runtime'), destination);
  if (!within || within.startsWith('..') || isAbsolute(within)) fail('runtime output must stay in pad-runtime');
  const config = JSON.parse(readFileSync(resolve(root, configPath), 'utf8').replace(/^\uFEFF/, ''));
  const runtime = withdrawalRuntimeFromFiles({ root, config });
  writeFileSync(destination, JSON.stringify(runtime, null, 2) + '\n');
  console.log(JSON.stringify({ raceDate: runtime.raceDate, races: runtime.bundles.length,
    withdrawals: runtime.officialWithdrawals.length, out: destination }));
}
