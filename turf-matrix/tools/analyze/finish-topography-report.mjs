import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildFinishTopographyShadow } from '../intelligence/finish-topography-shadow.mjs';

const [input, asOf, output] = process.argv.slice(2);
if (!input || !asOf || !output || !output.endsWith('.json')) throw new Error('Usage: node finish-topography-report.mjs INPUT AS_OF OUTPUT.json');
if (resolve(input) === resolve(output)) throw new Error('Input cannot be overwritten');
const candidate = JSON.parse(readFileSync(input, 'utf8').replace(/^\uFEFF/, ''));
const report = { policy: 'finish-topography-shadow-v1', asOf, indexChanged: false,
  sourceFile: resolve(input), races: candidate.races.map(race => ({ name: race.name, id: race.id,
    horses: race.horses.map(horse => ({ name: horse.name, age: horse.age, existingIndex: horse.tmIndex,
      ...buildFinishTopographyShadow({ currentRace: horse.currentRace ?? {
        course: race.track, surface: race.surface, distance: race.distance }, pastRuns: horse.pastRuns }, { asOf }) })),
  })) };
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
const lines = ['# 直線勾配の実績比較', '', `評価基準日：${asOf}。本番指数への加点なし。`, '',
  '同じ芝・今回距離±200mの確定着順を比較。比較条件が揃わない馬は判断保留。',
  '相手の強さ・斤量・展開・世代限定条件は揃っていないため、平坦巧者の断定には使わない。', ''];
for (const race of report.races) {
  lines.push(`## ${race.name}`, '', '| 馬名 | 直線平坦の3着内/出走 | 坂ありの3着内/出走 | 同会場・同距離の3着内/出走 | 条件重複比較 |',
    '|---|---:|---:|---:|---|');
  for (const h of race.horses) lines.push(`| ${h.name} | ${h.flat.topThree}/${h.flat.runs} | ${h.uphill.topThree}/${h.uphill.runs} | ${h.directCondition.topThree}/${h.directCondition.runs} | ${h.matched.comparable ? '記述比較のみ' : 'データ不足'} |`);
  const offt = race.horses.find(h => h.name === 'オフトレイル');
  if (offt) {
    lines.push('', '## オフトレイル', '', offt.summary, '',
      `直線平坦の平均着差：${offt.flat.meanMargin ?? '未取得'}秒（${offt.flat.marginRuns}走）。坂あり：${offt.uphill.meanMargin ?? '未取得'}秒（${offt.uphill.marginRuns}走）。`, '',
      '距離・格・馬場が重なる比較に使える実績：平坦' + offt.matched.flat.runs + '走／坂あり' + offt.matched.uphill.runs + '走。', '',
      '| 日付 | 会場 | 距離 | レース | 着順 | 着差 | 直線 |', '|---|---|---:|---|---:|---:|---|');
    for (const r of offt.evidence) lines.push(`| ${r.date} | ${r.course} | ${r.distance} | ${r.race ?? '未取得'} | ${r.finishPosition} | ${r.margin ?? '未取得'} | ${r.finishStraight === 'flat' ? '平坦' : '坂あり'} |`);
  }
}
lines.push('', '## コース分類の出典', '');
const sources = [...new Set(report.races.flatMap(r => r.horses.flatMap(h => h.evidence.map(e => e.source))))];
for (const url of sources) lines.push(`- [JRAコース紹介](${url})`);
writeFileSync(output.replace(/\.json$/, '.md'), lines.join('\n') + '\n');
console.log(JSON.stringify({ output, horses: report.races.reduce((n, r) => n + r.horses.length, 0),
  offt: report.races.flatMap(r => r.horses).find(h => h.name === 'オフトレイル') }, null, 2));
