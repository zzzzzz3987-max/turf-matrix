import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { loadFrozenPublicRoleDays } from './lib/public-role-archive.mjs';
import { createGenerationLookup, buildGenerationEvidenceShadow, GENERATION_SOURCE } from '../intelligence/generation-evidence-shadow.mjs';

const [candidatePath, metadataPath, asOf, output] = process.argv.slice(2);
if (!candidatePath || !metadataPath || !asOf || !output?.endsWith('.json'))
  throw new Error('Usage: node generation-evidence-report.mjs CANDIDATE METADATA AS_OF OUTPUT.json');
if ([candidatePath, metadataPath].some(p => resolve(p) === resolve(output))) throw new Error('Cannot overwrite input');
const read = p => JSON.parse(readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
const metadata = read(metadataPath);
const lookup = createGenerationLookup(metadata.pastRaces);
const candidate = read(candidatePath);
const assess = (horse, race, date) => ({ name: horse.name, number: horse.number, age: horse.age,
  ...buildGenerationEvidenceShadow(horse, { asOf: date, lookup, context: race }) });
const races = candidate.races.map(race => ({ name: race.name, id: race.id,
  horses: race.horses.map(horse => assess(horse, race, asOf)) }));
const historical = [];
const coverage = [];
const skipped = [];
const normalize = name => String(name ?? '').normalize('NFKC').replace(/[\s*＊$＄]/g, '');
for (const day of loadFrozenPublicRoleDays({ root: process.cwd() })) {
  if (day.date >= asOf) continue;
  const committedAt = execFileSync('git', ['show', '-s', '--format=%cI', day.commit], { encoding: 'utf8' }).trim();
  for (const race of day.snapshot.races.filter(r => r.category === 'grade')) {
    const skip = reason => skipped.push({ date: day.date, race: race.name, reason });
    const eligibility = lookup({ date: day.date, course: race.track, raceNumber: race.number,
      distance: race.distance, surface: race.surface });
    if (!['mixed', 'olderOnly'].includes(eligibility.category)) { skip('target eligibility unknown or age-limited'); continue; }
    const post = Date.parse(`${day.date}T${race.time}:00+09:00`);
    if (!Number.isFinite(post) || Date.parse(committedAt) >= post || day.results.date !== day.date) { skip('not verified pre-race snapshot/results'); continue; }
    const result = day.results.races.find(r => r.bundleId === race.bundleId);
    const horses = race.horses.map(h => {
      const assessed = assess(h, race, day.date);
      const settled = result?.horses.find(r => Number(r.horseNumber) === h.number && normalize(r.horseName) === normalize(h.name));
      return { ...assessed, finish: settled?.finishPosition, winPayout: settled?.winPayout, placePayout: settled?.placePayout };
    });
    const highest = Math.max(...horses.map(h => h.sensitivity.baselineIndex ?? -Infinity));
    coverage.push({ date: day.date, race: race.name, bundleId: race.bundleId, commit: day.commit, committedAt,
      horses: horses.length, replayableHorses: horses.filter(h => h.sensitivity.replayValid).length,
      eligibilityCompleteHorses: horses.filter(h => h.sensitivity.metadataComplete).length,
      unknownFormRuns: horses.reduce((n, h) => n + h.sensitivity.rows.filter(r => r.category === 'unknown').length, 0),
      baselineLeaders: horses.filter(h => h.sensitivity.baselineIndex === highest).map(h => ({ name: h.name,
        age: h.age, index: highest, finish: h.finish, winPayout: h.winPayout, placePayout: h.placePayout,
        nearbyOpen: h.nearbyOpen, groups: h.groups, eligibilityComplete: h.sensitivity.metadataComplete })) });
    if (!horses.length || horses.some(h => !h.sensitivity.replayValid || !Number.isFinite(h.finish)
      || !Number.isFinite(h.winPayout) || !Number.isFinite(h.placePayout)
      || h.sensitivity.rows.some(r => r.category === 'unknown'))) { skip('incomplete eligibility, baseline replay or settlement'); continue; }
    const leaders = key => {
      const max = Math.max(...horses.map(h => h.sensitivity[key]));
      return horses.filter(h => h.sensitivity[key] === max);
    };
    historical.push({ date: day.date, race: race.name, bundleId: race.bundleId, commit: day.commit, committedAt,
      eligibility: eligibility.category, baselineLeaders: leaders('baselineIndex').map(h => h.name),
      diagnosticLeaders: leaders('diagnosticIndex').map(h => h.name), horses });
  }
}
// Equal stake per tied top horse, rather than arbitrary horse-number tie breaking.
const summarize = key => {
  const selections = historical.flatMap(r => r.horses.filter(h => r[key].includes(h.name)));
  return { races: historical.length, selections: selections.length, wins: selections.filter(h => h.finish === 1).length,
    topThree: selections.filter(h => h.finish <= 3).length,
    winROI: selections.length ? +(selections.reduce((s, h) => s + h.winPayout, 0) / selections.length).toFixed(1) : null,
    placeROI: selections.length ? +(selections.reduce((s, h) => s + h.placePayout, 0) / selections.length).toFixed(1) : null };
};
const report = { policy: 'generation-evidence-shadow-v1', asOf, indexChanged: false, source: GENERATION_SOURCE,
  inputs: [candidatePath, metadataPath].map(p => ({ path: resolve(p), sha256: createHash('sha256').update(readFileSync(p)).digest('hex') })),
  metadataAcquiredAt: metadata.generatedAt, races, historical, coverage, skipped,
  retrospective: { scope: 'exploratory, not holdout; form label bonus only, ability class effect unchanged',
    baseline: summarize('baselineLeaders'), diagnostic: summarize('diagnosticLeaders'),
    changedLeaders: historical.filter(r => JSON.stringify(r.baselineLeaders) !== JSON.stringify(r.diagnosticLeaders)).length } };
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
const lines = ['# 世代限定・古馬混合の実績分離', '', `基準日：${asOf}。本番指数・係数・公開データは未変更。`, '',
  '着順や着差を残し、近走評価の世代限定戦の格加点だけを外す感度分析。能力評価内の格加点は残っており、相手の強さを補正した新指数ではない。',
  '競走種別コード11＝2歳限定、12＝3歳限定、13＝3歳以上、14＝4歳以上。コード不明はデータ不足。馬齢・レース名から推測しない。',
  '3歳以上という出走条件だけで、実際に強い古馬と対戦したと断定しない。相手個体の能力・斤量・展開は別途検証が必要。', '',
  `公式仕様：[JV-Data 4.9.0.1 RA項目25／コード表2005](${GENERATION_SOURCE})`, ''];
for (const race of races) {
  lines.push(`## ${race.name} 全${race.horses.length}頭`, '', '| 馬名 | 2歳限定3着内/走 | 3歳限定3着内/走 | 3歳以上3着内/走 | 4歳以上3着内/走 | 不明走 | 現行指数 | 格加点を外した参考値 |', '|---|---:|---:|---:|---:|---:|---:|---:|');
  for (const h of race.horses) lines.push(`| ${h.name} | ${h.groups.twoOnly.topThree}/${h.groups.twoOnly.runs} | ${h.groups.threeOnly.topThree}/${h.groups.threeOnly.runs} | ${h.groups.mixed.topThree}/${h.groups.mixed.runs} | ${h.groups.olderOnly.topThree}/${h.groups.olderOnly.runs} | ${h.groups.unknown.runs} | ${h.sensitivity.baselineIndex} | ${h.sensitivity.diagnosticIndex == null ? '再現不可' : `${h.sensitivity.diagnosticIndex}${h.sensitivity.metadataComplete ? '' : '（条件欠損あり）'}`} |`);
  for (const name of ['ダイヤモンドノット', 'オフトレイル']) {
    const h = race.horses.find(h => h.name === name);
    if (!h) continue;
    lines.push('', `### ${name}`, '', `近走点：${h.sensitivity.baselineForm} → ${h.sensitivity.formWithoutGenerationLabel}。現行指数${h.sensitivity.baselineIndex} → 感度分析${h.sensitivity.diagnosticIndex ?? '再現不可'}。`,
      `同じ馬場種別・今回距離±200mの年齢開放条件：${h.nearbyOpen.runs}走、${h.nearbyOpen.topThree}回3着内。`, '', '| 日付 | レース | 条件区分 | 着順 | 着差秒 |', '|---|---|---|---:|---:|');
    const labels = { twoOnly: '2歳限定', threeOnly: '3歳限定', mixed: '3歳以上', olderOnly: '4歳以上', unknown: 'データ不足' };
    for (const r of h.evidence.slice(0, 5)) lines.push(`| ${r.date} | ${r.raceName} | ${labels[r.category]} | ${r.finishPosition} | ${r.margin ?? '未取得'} |`);
  }
}
lines.push('', '## 過去混合重賞の探索検証', '',
  `対象${historical.length}レース、除外${skipped.length}レース。全頭の近走条件・指数再現・確定払戻が揃うレースのみ。同点1位は全頭を等額購入。`, '',
  '| 条件 | 選択頭数 | 1着 | 3着内 | 単勝回収率 | 複勝回収率 |', '|---|---:|---:|---:|---:|---:|');
for (const [label, data] of [['現行', report.retrospective.baseline], ['格加点を外す感度分析', report.retrospective.diagnostic]])
  lines.push(`| ${label} | ${data.selections} | ${data.wins} | ${data.topThree} | ${data.winROI ?? '算出不可'}% | ${data.placeROI ?? '算出不可'}% |`);
lines.push('', `1位の構成が変わったレース：${report.retrospective.changedLeaders}。`, '',
  'データは今回取得した条件メタデータを過去の公開前スナップショットに結合。過去走の成績は当時保存されたものだけを使用。結果を見た後の探索検証であり、改善や世代の強弱を証明したものではない。', '',
  '採用判断：本番への接続は保留。実際の対戦相手・斤量・距離・馬場を揃えた比較と、今後の未使用レースでの検証を先に行う。', '',
  '### 保存データの検証範囲', '',
  `出走条件を一次データで確認できた年齢開放重賞：${coverage.length}レース。以下は当時の指数1位と確定結果の確認であり、新ルールの検証成績ではない。`, '',
  '| 日付 | 重賞 | 全頭 | 近走条件が揃う頭数 | 指数再現できる頭数 | 当時指数1位と着順 |', '|---|---|---:|---:|---:|---|');
for (const row of coverage) lines.push(`| ${row.date} | ${row.race} | ${row.horses} | ${row.eligibilityCompleteHorses} | ${row.replayableHorses} | ${row.baselineLeaders.map(h => `${h.name}（${h.age}歳）${h.finish ?? '結果欠損'}着`).join('／')} |`);
lines.push('', '全頭条件が揃わないレースから一部の馬だけを抜いて回収率を出すと選別の偏りが生じるため、比較回収率は算出しない。海外・地方・未収録レースの条件と旧指数の再現可能性を補完してから検証する。', '', '### 除外理由', '');
for (const row of skipped) lines.push(`- ${row.date} ${row.race}: ${row.reason}`);
writeFileSync(output.replace(/\.json$/, '.md'), lines.join('\n') + '\n');
console.log(JSON.stringify({ output, retrospective: report.retrospective, skipped: skipped.length, coverage: coverage.length,
  comparison: races.flatMap(r => r.horses).filter(h => ['ダイヤモンドノット', 'オフトレイル'].includes(h.name))
    .map(h => ({ name: h.name, groups: h.groups, nearbyOpen: h.nearbyOpen, sensitivity: { ...h.sensitivity, rows: undefined } })) }, null, 2));
