import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { buildRacePublicConclusion } from '../../src/lib/public-view-model.js';
import { summarizePublicRoleRecords } from './lib/public-role-performance.mjs';
const runner = 'C:/Users/R/AppData/Local/TurfMatrix/odds-runner/turf-matrix';
const results = JSON.parse(fs.readFileSync('data/target/results.latest.json','utf8').replace(/^\uFEFF/,''));
if(results.RaceDate !== '2026-09-19') throw Error('Wrong result date');
const state = JSON.parse(fs.readFileSync(`${runner}/tools/pad-runtime/odds-auto-update-state.json`));
const rows=[];
for(const result of results.Races){
  const id=`2026-09-19-${result.Race.CourseName}-${result.Race.RaceNo}R`;
  const frozen=state.processed[id];
  if(!frozen || frozen.completedAt >= `2026-09-19T${'23:59:59'}Z`) throw Error('Missing snapshot');
  const snap=JSON.parse(execFileSync('git',['show',`${frozen.commit}:turf-matrix/tools/week-data.json`],{cwd:runner,encoding:'utf8',maxBuffer:40000000}));
  const race=snap.races.find(r=>r.id===id);
  if(new Date(frozen.completedAt)>=new Date(`2026-09-19T${race.time}:00+09:00`)) throw Error('Post-race snapshot');
  const conclusion=buildRacePublicConclusion({...race,horses:race.horses.map(h=>({...h,aiScore:h.tmIndex}))});
  const top=Math.max(...race.horses.map(h=>h.tmIndex));
  for(const role of ['leader','value','danger']){
    const selected=role==='leader'?race.horses.filter(h=>h.tmIndex===top):[conclusion?.[role]?.horse].filter(Boolean);
    for(const horse of selected){
      const h=result.Horses.find(h=>h.HorseNumber===horse.number);
      if(!h || h.HorseName.trim()!==horse.name.trim()) throw Error('Horse mismatch');
      if(!result.IsFinal || !result.HasPayouts) throw Error('Unsettled');
      const payout=type=>result.Payouts.find(p=>p.Type===type&&p.HorseNumber===horse.number)?.Payout??0;
      rows.push({role,race:race.name,raceId:id,commit:frozen.commit,name:horse.name,number:horse.number,odds:horse.odds,finishPosition:h.FinishPosition,abnormalityCode:h.AbnormalityCode,payoutAvailable:true,winPayout:payout('win'),placePayout:payout('place')});
    }
  }
}
const summary=Object.fromEntries(['leader','value','danger'].map(role=>[role,summarizePublicRoleRecords(rows.filter(r=>r.role===role))]));
const report={date:results.RaceDate,basis:'last-published-pre-race-snapshot; all tied leaders; 100 yen per horse per bet type',raceCount:results.Races.length,summary,rows};
fs.writeFileSync('docs/reviews/2026-09-19-results.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
