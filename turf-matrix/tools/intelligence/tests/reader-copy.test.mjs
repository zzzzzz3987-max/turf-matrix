import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildReaderCopy,directMeetings,readerText} from '../../../src/lib/reader-copy.js';

const week=JSON.parse(fs.readFileSync(new URL('../../week-data.json',import.meta.url)));

test('reader copy never changes original horses, scores or odds',()=>{
 const before=JSON.stringify(week);
 for(const race of week.races)for(const horse of race.horses){
  const copy=buildReaderCopy(horse,race);
  assert.doesNotMatch(JSON.stringify(copy),/データ|未検証|未取得|情報不足|初挑戦|実績なし/u);
  for(const factor of copy.factors){
   assert.equal(factor.score,horse.analysis.factorsDetail[factor.key].score);
   assert.ok(factor.explanation);
  }
 }
 assert.equal(JSON.stringify(week),before);
});

test('reader copy omits internal-only sentences without manufacturing experience',()=>{
 assert.equal(readerText('京都の実績データが不足しています。苦手という意味ではありません。'),null);
 assert.equal(readerText('坂路4F53.2秒・終い1F12.4秒。未検証です。'),'坂路800m53.2秒・最後の200m12.4秒。');
});

const makeRun=(finish,time)=>({date:'2026-09-13',course:'阪神',raceNumber:11,raceName:'ローズS G2',surface:'芝',distance:1800,finishPosition:finish,timeSeconds:time});
const makeField=()=>({id:'2026-10-18-京都-11R',horses:[{id:'a',name:'A',pastRuns:[makeRun(1,104.5)]},{id:'b',name:'B',pastRuns:[makeRun(2,105)]}]});

test('direct meeting uses actual clock difference, never estimated horse lengths',()=>{
 const race=makeField();
 assert.match(directMeetings(race.horses[0],race)[0].text,/Bに0\.5秒差をつけて勝利/u);
 assert.doesNotMatch(JSON.stringify(directMeetings(race.horses[0],race)),/馬身|世代上位/u);
});

test('opponent credentials distinguish earlier results without repeating the placing',()=>{
 const race=makeField();
 race.horses[1].pastRuns.push({...makeRun(2,120),date:'2026-04-26',course:'東京',raceName:'フローラS G2',distance:2000});
 const text=directMeetings(race.horses[0],race)[0].text;
 assert.equal(text,'ローズS G2では、フローラS G2で2着のBに0.5秒差をつけて勝利。');
 assert.equal((text.match(/2着/gu)??[]).length,1);
});

test('different events, future results and inconsistent clocks cannot support claims',()=>{
 for(const change of [r=>r.date='2026-09-14',r=>r.course='東京',r=>r.surface='ダート',r=>r.timeSeconds=100]){
  const race=makeField();change(race.horses[1].pastRuns[0]);
  assert.equal(directMeetings(race.horses[0],race).length,0);
 }
 const race=makeField();race.id='2026-09-13-京都-11R';
 assert.equal(directMeetings(race.horses[0],race).length,0);
});

test('missing clocks retain finishing order without inventing a gap',()=>{
 const race=makeField();delete race.horses[1].pastRuns[0].timeSeconds;
 const meeting=directMeetings(race.horses[0],race)[0];
 assert.match(meeting.text,/先着/u);assert.doesNotMatch(meeting.text,/秒差|馬身/u);
});
