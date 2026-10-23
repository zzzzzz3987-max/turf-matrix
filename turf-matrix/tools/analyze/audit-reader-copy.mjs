import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {buildReaderCopy,readerRunEvidence} from '../../src/lib/reader-copy.js';

const root=fileURLToPath(new URL('../../',import.meta.url));
const input=path.resolve(root,process.argv[2]??'tools/week-data.json');
const out=process.argv[3]?path.resolve(process.argv[3]):null;
const week=JSON.parse(fs.readFileSync(input,'utf8').replace(/^\uFEFF/u,''));
const before=JSON.stringify(week);
const rows=[];
for(const race of week.races)for(const horse of race.horses??[]) {
  const copy=buildReaderCopy(horse,race);
  const profiles=readerRunEvidence(horse,race);
  assert.doesNotMatch(JSON.stringify(copy),/データ|未検証|未取得|情報不足|初挑戦|実績なし/u,horse.name);
  assert.ok((copy.headline?.length??0)<=150,horse.name);
  assert.ok(copy.evidence.join('').length<=200,horse.name);
  assert.ok((copy.caution?.length??0)<=160,horse.name);
  for(const f of copy.factors)assert.equal(f.score,horse.analysis.factorsDetail[f.key].score);
  rows.push({raceId:race.id,race:race.name,number:horse.number,horse:horse.name,...copy,
    sources:profiles.map(p=>({date:p.run.date,course:p.run.course,raceNumber:p.run.raceNumber,
      finish:p.finish,first:p.first,last:p.last,last3F:p.run.last3F,margin:p.run.margin,
      shape:p.shape,againstFlow:p.against}))});
}
assert.equal(JSON.stringify(week),before,'Copy generation mutated the source payload');
if(out) {
  fs.mkdirSync(out,{recursive:true});
  fs.writeFileSync(path.join(out,'reader-copy-audit.json'),JSON.stringify(rows,null,2)+'\n');
  fs.writeFileSync(path.join(out,'reader-copy-audit.md'),rows.map(r=>`## ${r.race} ${r.number} ${r.horse}\n\n評価した点: ${r.headline??''}\n\n実績・根拠: ${r.evidence.join(' ')}\n\n注意点: ${r.caution??''}\n`).join('\n'));
}
console.log(JSON.stringify({input,races:week.races.length,horses:rows.length,
  withHeadline:rows.filter(r=>r.headline).length,withEvidence:rows.filter(r=>r.evidence.length).length,
  withCaution:rows.filter(r=>r.caution).length,sourceUnchanged:true,output:out},null,2));
