import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildReaderCopy,directMeetings,readerRunEvidence,readerText} from '../../../src/lib/reader-copy.js';

const week=JSON.parse(fs.readFileSync(new URL('../../week-data.json',import.meta.url)));
const examples=JSON.parse(fs.readFileSync(new URL('./fixtures/reader-copy-examples.json',import.meta.url)));

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

const exampleRun=(overrides={})=>({date:'2026-09-01',course:'東京',raceNumber:3,surface:'芝',distance:1600,
 fieldSize:12,finishPosition:3,confirmedFinishPosition:3,passingOrder:[null,null,9,8],last3F:33.5,margin:.2,...overrides});
const exampleRace=(overrides={})=>({id:'2026-10-24-東京-11R',track:'東京',surface:'芝',distance:1600,fieldSize:12,horses:[],...overrides});
const exampleHorse=(run=exampleRun(),flow={})=>({id:'a',name:'A',number:2,pastRuns:[run],analysis:{factorsDetail:{pace:{
 status:'active',score:70,calculation:{style:'差し',expectedPace:'標準',paceAdjustment:0},contextFit:{frame:'inner'},
 historicalFlow:{runs:[{date:run.date,course:run.course,raceNumber:run.raceNumber,finishPosition:finishOf(run),
 shape:'neutral',shapeConfidence:'high',...flow}]}}}}});
const finishOf=run=>run.confirmedFinishPosition??run.finishPosition;

test('all established detailed runners have substantive copy within mobile reading limits',()=>{
 let count=0;
 for(const race of week.races)for(const horse of race.horses){
  const c=buildReaderCopy(horse,race);count++;
  if(!readerRunEvidence(horse,race).length){
   assert.equal(c.headline,null);assert.equal(c.caution,null);assert.deepEqual(c.evidence,[]);continue;
  }
  assert.ok(c.headline&&c.evidence.length&&c.caution,horse.name);
  assert.match(c.headline,/\d{4}年\d+\/\d+/u,horse.name);
  assert.ok(c.headline.length<=150,horse.name);
  assert.ok(c.evidence.join('').length<=200,horse.name);
  assert.ok(c.caution.length<=160,horse.name);
  assert.doesNotMatch(JSON.stringify(c),/気を抜|手応え|出遅れ|重馬場は苦に|世代上位|馬身|最速|底を見せ|能力最上位/u,horse.name);
 }
 assert.equal(count,week.races.reduce((total,race)=>total+race.horses.length,0));
});

test('Mariandele uses the earlier counter-bias run and the later win separately',()=>{
 const race=examples.races.find(r=>r.name==='アルテミスステークス');
 const horse=race.horses.find(h=>h.name==='マリアンデール');
 const c=buildReaderCopy(horse,race);
 assert.match(c.headline,/7\/25.*前残り.*最後方.*32秒3.*0秒1差.*3着/u);
 assert.match(c.evidence.join(''),/9\/21.*4角5番手.*34秒1.*1着/u);
 assert.match(c.caution,/後方.*差し遅れ.*内寄り.*進路/u);
 assert.doesNotMatch(c.headline,/能力.*1位|重賞級|道悪/u);
});

test('neutral or low-confidence outcomes never become counter-bias claims',()=>{
 for(const flow of [{shape:'neutral',assessment:'against_flow_strong',paceClass:'back_loaded'},
  {shape:'front_survival',shapeConfidence:'low'}]){
  const horse=exampleHorse(exampleRun(),flow);
  assert.equal(readerRunEvidence(horse,exampleRace())[0].against,false);
  assert.doesNotMatch(buildReaderCopy(horse,exampleRace()).headline,/前残り|崩れる中|展開でも/u);
 }
});

test('a well-supported front-survival race can substantiate a rear runner placing',()=>{
 const horse=exampleHorse(exampleRun(),{shape:'front_survival'});
 assert.equal(readerRunEvidence(horse,exampleRace())[0].against,true);
 assert.match(buildReaderCopy(horse,exampleRace()).headline,/前残り.*決め手/u);
});

test('historical outcome evidence must match the exact run and finishing order',()=>{
 for(const change of [{course:'阪神'},{raceNumber:4},{date:'2026-09-02'},{finishPosition:2}]){
  const horse=exampleHorse(exampleRun(),{shape:'front_survival',...change});
  assert.equal(readerRunEvidence(horse,exampleRace())[0].against,false);
 }
});

test('front runner holding on in a collapse is distinct from a flow-aided win',()=>{
 const run=exampleRun({finishPosition:1,confirmedFinishPosition:1,passingOrder:[1,1,1,1],margin:0});
 const against=exampleHorse(run,{shape:'front_collapse'});
 assert.match(buildReaderCopy(against,exampleRace()).headline,/先行勢に厳しい流れ/u);
 const aided=exampleHorse(run,{shape:'front_survival'});
 assert.doesNotMatch(buildReaderCopy(aided,exampleRace()).headline,/厳しい流れ|展開でも/u);
});

test('losing positions after the last corner is not described as gaining positions',()=>{
 const horse=exampleHorse(exampleRun({passingOrder:[null,null,5,2]}));
 assert.doesNotMatch(buildReaderCopy(horse,exampleRace()).headline,/着順を上げ|追い上げ|前を交わ/u);
});

test('straight 1000m never borrows corner positions or corner-race style claims',()=>{
 const run=exampleRun({course:'新潟',distance:1000,passingOrder:[1,1,1,1],finishPosition:1,confirmedFinishPosition:1,margin:0});
 const horse=exampleHorse(run);
 const race=exampleRace({id:'2026-10-24-新潟-9R',track:'新潟',distance:1000});
 const c=buildReaderCopy(horse,race);
 assert.doesNotMatch(c.headline+c.caution,/4角|先頭で|逃げ切|内寄り|後方からの競馬/u);
});

test('a surface switch is explicit rather than sold as proven suitability',()=>{
 const horse=exampleHorse(exampleRun({surface:'ダ',distance:1400}));
 const c=buildReaderCopy(horse,exampleRace());
 assert.match(c.caution,/ダ1400m.*芝1600mに替わる/u);
 assert.doesNotMatch(c.headline,/今回に近い/u);
});

test('crowded early runners and a 400m extension produce a specific caution',()=>{
 const horse=exampleHorse(exampleRun({surface:'ダ',distance:1000,passingOrder:[null,null,2,1],finishPosition:1,confirmedFinishPosition:1}));
 horse.analysis.factorsDetail.pace.calculation.style='先行';
 const race=exampleRace({surface:'ダ',distance:1400,raceContext:{paceScenario:{expectedPace:'ハイ',counts:{逃げ:6,先行:2}}}});
 assert.match(buildReaderCopy(horse,race).caution,/400m延長.*前に行く馬も多く.*競り合い/u);
});

test('future runs, future training sessions and invalid placings cannot support the copy',()=>{
 const horse=exampleHorse();
 horse.pastRuns.push(exampleRun({date:'2026-10-24',raceName:'未来の勝利',finishPosition:1,confirmedFinishPosition:1}),
  exampleRun({date:'2026-10-25',raceName:'翌日の勝利'}),exampleRun({date:'2026-08-01',confirmedFinishPosition:20}));
 horse.analysis.factorsDetail.training={status:'active',score:75};
 horse.training={slope:[{date:'20261023','4F':53.2,'1F':12.3},{date:'20261024','4F':49,'1F':10}]};
 const c=buildReaderCopy(horse,exampleRace());
 assert.equal(readerRunEvidence(horse,exampleRace()).length,1);
 assert.doesNotMatch(JSON.stringify(c),/未来|翌日|49秒0|20着/u);
 assert.match(c.factors.find(f=>f.key==='training').explanation,/10\/23.*53秒2/u);
});

test('unknown venue identities cannot be merged into a direct meeting',()=>{
 const race=makeField();for(const h of race.horses)h.pastRuns[0].course=null;
 assert.equal(directMeetings(race.horses[0],race).length,0);
});

test('a missing run produces no invented headline or warning',()=>{
 const c=buildReaderCopy({name:'A',pastRuns:[]},exampleRace());
 assert.equal(c.headline,null);assert.equal(c.caution,null);assert.deepEqual(c.evidence,[]);
});

test('impossible dates and incomplete historical race identities cannot substantiate a bias',()=>{
 const horse=exampleHorse(exampleRun({raceNumber:null}),{shape:'front_survival'});
 horse.pastRuns.push(exampleRun({date:'2026-02-30'}));
 const profiles=readerRunEvidence(horse,exampleRace());
 assert.equal(profiles.length,1);assert.equal(profiles[0].against,false);
});

test('zero or negative clocks cannot create an opponent gap',()=>{
 for(const time of [0,-1]){
  const race=makeField();race.horses[0].pastRuns[0].timeSeconds=time;
  const text=directMeetings(race.horses[0],race)[0].text;
  assert.match(text,/先着/u);assert.doesNotMatch(text,/秒差/u);
 }
});

test('a recent rear run does not become the evidence for a front-running caution',()=>{
 const race=examples.races.find(r=>r.name==='カシオペアステークス');
 const horse=race.horses.find(h=>h.name==='ナムラエイハブ');
 const c=buildReaderCopy(horse,race);
 assert.doesNotMatch(c.caution,/前走は4角17番手.*後続に並ばれる/u);
 assert.match(c.caution,/小倉記念.*4角3番手/u);
});
