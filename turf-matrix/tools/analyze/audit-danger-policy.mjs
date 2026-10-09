import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadFrozenPublicRoleDays } from './lib/public-role-archive.mjs';
import { summarizePublicRoleRecords } from './lib/public-role-performance.mjs';
import { assessPublicDangerCandidates, DANGER_ASSESSMENT_VERSION } from '../../src/lib/public-danger-assessment.js';
import { selectPublicDangerHorse, selectPublicMarketMismatchHorse } from '../../src/lib/public-role-selection.js';
const root=process.cwd();
const normalize=name=>String(name??'').normalize('NFKC').replace(/[\s*＊$＄]/g,'');
const oldRows=[],newRows=[],details=[];
for(const day of loadFrozenPublicRoleDays({root})) for(const race of day.snapshot.races){
  const result=day.results.races.find(r=>r.bundleId===race.bundleId);
  if(!result) continue;
  const record=horse=>{
    if(!horse) return null;
    const h=result.horses.find(h=>h.horseNumber===horse.number);
    if(!h||normalize(h.horseName)!==normalize(horse.name)) throw new Error(`Horse mismatch: ${race.bundleId}`);
    return {...h,date:day.date,raceId:race.bundleId,payoutAvailable:Number.isFinite(h.winPayout)&&Number.isFinite(h.placePayout)};
  };
  const old=selectPublicMarketMismatchHorse(race),current=selectPublicDangerHorse(race);
  const a=record(old),b=record(current);
  if(a) oldRows.push(a);if(b)newRows.push(b);
  if(old) {const c=assessPublicDangerCandidates(race).find(c=>c.horse===old);
    details.push({date:day.date,raceId:race.bundleId,name:old.name,finish:a.finishPosition,
      retained:current?.number===old.number,risks:c.risks,protections:c.protections,reasons:c.reasons});}
}
const recentPublished=[];
const runner='C:/Users/R/AppData/Local/TurfMatrix/odds-runner/turf-matrix';
for(const date of ['2026-10-03','2026-10-04']) {
  const report=JSON.parse(fs.readFileSync(path.join(root,`docs/reviews/${date}-results.json`),'utf8'));
  for(const row of report.rows.filter(r=>r.scope==='specialDetails'&&r.role==='danger')) {
    const week=JSON.parse(execFileSync('git',['show',`${row.commit}:turf-matrix/tools/week-data.json`],{cwd:runner,encoding:'utf8',maxBuffer:50000000}));
    const race=week.races.find(r=>r.id===row.raceId);
    const a=assessPublicDangerCandidates(race).find(c=>c.horse.number===row.number);
    if(!a||normalize(a.horse.name)!==normalize(row.name))throw new Error(`Recent identity mismatch: ${row.raceId}`);
    recentPublished.push({...row,newClassification:a.classification,risks:a.risks,protections:a.protections,reasons:a.reasons});
  }
}
const report={generatedAt:new Date().toISOString(),ruleVersion:DANGER_ASSESSMENT_VERSION,
  basis:'Retrospective current-rule comparison on 13:00 JST snapshots; not prospective efficacy proof.',
  dates:[...new Set(details.map(d=>d.date))],old:summarizePublicRoleRecords(oldRows),current:summarizePublicRoleRecords(newRows),
  recentPublished,details};
fs.writeFileSync(path.join(root,'docs/analysis/danger-policy-2026-10-07.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...report,details:undefined,recentPublished:recentPublished.map(r=>({race:r.raceId,name:r.name,finish:r.finishPosition,classification:r.newClassification,protections:r.protections,reasons:r.reasons}))},null,2));
