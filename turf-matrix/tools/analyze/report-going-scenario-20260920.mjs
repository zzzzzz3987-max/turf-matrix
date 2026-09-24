import fs from 'node:fs';
import assert from 'node:assert/strict';
import { normalizeSurface } from '../intelligence/going-adjustment.mjs';

const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
const base = read('tools/week-data.going-baseline.json');
const scenario = read('tools/week-data.going-heavy.json');
assert.equal(scenario.meta.goingScenario.official, false);
assert.equal(scenario.meta.previewMode, true);
const races = scenario.races.filter(r => r.track === '中山');
assert.equal(races.length, 12);
const rows = [];
const lines = ['# 2026-09-20 中山全12レース・重馬場想定', '',
  '予報を踏まえた比較分析です。公式馬場情報・公開指数は変更していません。芝とダートは同一馬の同一種別内で比較。現行係数を維持し、道悪未経験や血統根拠不足だけでは減点しません。', '',
  '重・不良と稍重は別集計。血統は既存の評価を再計算しますが、一般的なパワー型という説明だけで道悪加点はしません。騎手コメントは参考情報で、今回追加点には接続していません。', ''];
for (const race of scenario.races) {
  const original = base.races.find(r => r.id === race.id);
  assert(original);
  if (race.track !== '中山') {
    assert.deepEqual(race, original);
    continue;
  }
  assert.equal(race.going, '重');
  const ranked = [...race.horses].sort((a,b) => b.tmIndex-a.tmIndex || a.number-b.number);
  const before = [...original.horses].sort((a,b) => b.tmIndex-a.tmIndex || a.number-b.number);
  lines.push(`## 中山${race.number}R ${race.name} / ${race.surface}${race.distance}m`, '',
    `首位候補：${before.filter(h=>h.tmIndex===before[0].tmIndex).map(h=>h.name).join('・')} → ${ranked.filter(h=>h.tmIndex===ranked[0].tmIndex).map(h=>h.name).join('・')}`, '',
    '| 馬番・馬名 | 通常→重想定 | 馬場補正 | 重・不良 | 稍重 |', '|---|---:|---:|---|---|');
  for (const h of ranked) {
    const b = original.horses.find(x=>x.id===h.id);
    assert(b);
    assert.equal(h.analysis.factors.ability, b.analysis.factors.ability);
    assert.equal(h.odds, b.odds);
    const wet = h.pastRuns.filter(r=>normalizeSurface(r.surface)===normalizeSurface(race.surface) && /重|不良/.test(r.trackCondition ?? '') && Number.isInteger(r.finishPosition) && r.finishPosition>0);
    const heavy = wet.filter(r=>!String(r.trackCondition).includes('稍'));
    const yielding = wet.filter(r=>String(r.trackCondition).includes('稍'));
    const record = runs => runs.length ? `${runs.length}走・${runs.filter(r=>r.finishPosition<=3).length}回3着以内` : '取得範囲に実績なし';
    const delta = h.tmIndex-b.tmIndex;
    const blood = h.analysis.pedigree;
    rows.push({race:race.name,raceNo:race.number,surface:race.surface,number:h.number,name:h.name,baseline:b.tmIndex,heavy:h.tmIndex,delta,going:h.analysis.goingAnalysis,heavyRuns:heavy,yieldingRuns:yielding,blood:{identity:blood.identity,sireTraits:blood.sireProfile?.traits,damSireTraits:blood.broodmareSireProfile?.traits,sireProfileStatus:blood.sireProfile?.status,damSireProfileStatus:blood.broodmareSireProfile?.status}});
    lines.push(`| ${h.number} ${h.name} | ${b.tmIndex}→${h.tmIndex} (${delta>=0?'+':''}${delta}) | ${h.analysis.goingAdjustment} | ${record(heavy)} | ${record(yielding)} |`);
  }
  lines.push('', '### 各馬の根拠', '');
  for(const h of rows.filter(x=>x.raceNo===race.number)) {
    lines.push(`**${h.number} ${h.name}**`, h.going.summary,
      `血統：${h.blood.identity?.pairLabel ?? '情報不足'}。父の特性：${h.blood.sireTraits?.join('・') || '個別根拠不足'}。母父の特性：${h.blood.damSireTraits?.join('・') || '個別根拠不足'}。これらの特性だけでは道悪巧者と断定しません。`);
    for(const r of [...h.heavyRuns,...h.yieldingRuns].sort((a,b)=>b.date.localeCompare(a.date))) {
      lines.push(`- ${r.date} ${r.course} ${r.raceName ?? `${r.raceNumber}R`} ${r.surface}${r.distance}m ${r.trackCondition}：${r.finishPosition}/${r.fieldSize}着、着差${r.margin ?? '不明'}秒、${r.popularity ?? '不明'}番人気`);
    }
    lines.push('');
  }
}
lines.push('## 騎手コメントの補足', '', 'レガレイラ：2025年宝塚記念11着後、戸崎騎手が緩い馬場と休み明けに言及。馬場単独の敗因とは断定せず、稍重での敗戦に結び付く注意材料として保持。重馬場実績に混ぜず、点数への二重減点も行わない。', '出典：https://umanity.jp/racedata/race_newsdet.php?nid=11849019', '');
fs.mkdirSync('docs/analysis',{recursive:true});
fs.writeFileSync('docs/analysis/nakayama-heavy-2026-09-20.md',lines.join('\n'));
fs.writeFileSync('docs/analysis/nakayama-heavy-2026-09-20.json',JSON.stringify({date:base.meta.date,official:false,races:races.length,horses:rows.length,rows},null,2)+'\n');
console.log(JSON.stringify({races:races.length,horses:rows.length,up:rows.filter(r=>r.delta>0).length,down:rows.filter(r=>r.delta<0).length,leaders:races.map(r=>({race:r.number,names:r.horses.filter(h=>h.tmIndex===Math.max(...r.horses.map(x=>x.tmIndex))).map(h=>`${h.name} ${h.tmIndex}`)})),graded:rows.filter(r=>r.raceNo===11).map(r=>({name:r.name,before:r.baseline,heavy:r.heavy,delta:r.delta}))},null,2));
