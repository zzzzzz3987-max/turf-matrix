import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {transformSync} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const source=readFileSync(new URL('../../../src/App.jsx',import.meta.url),'utf8');
const start=source.indexOf('const RolePerformancePanel =');
const end=source.indexOf('const ClassicRacePage =',start);
assert.ok(start>=0&&end>start);
const code=transformSync(`${source.slice(start,end)}\nmodule.exports = {RaceConclusionPanel,RolePerformancePanel};`,{loader:'jsx',format:'cjs'}).code;
const module={exports:{}};
const icon=()=>null;
runInNewContext(code,{
 module,React,Star:icon,ShieldAlert:icon,Trophy:icon,TrendingUp:icon,ChevronDown:icon,KeyRound:icon,
 Num:({children})=>React.createElement('span',null,children),HorseRiskTags:()=>null,RaceUpdatePanel:()=>null,
 rolePerformance:{raceDays:8,roles:{value:{sampleSize:63,topThreeRate:14.3},danger:{sampleSize:58,winRate:10.3}}},
});
const item=(id,name,score,number)=>({horse:{id,name,score,number},value:name,note:`${name} note`});
const conclusion=()=>({summary:'Summary',favorite:item('a','AxisRunner',80,1),challenger:item('b','ChallengerRunner',78,2),
 value:item('c','ValueRunner',74,3),danger:{status:'none',horse:null,value:'該当馬なし'},
 marketMismatch:{status:'none',horse:null,value:'該当馬なし'},key:{value:'標準ペース',note:'Key note'}});
const render=c=>renderToStaticMarkup(React.createElement(module.exports.RaceConclusionPanel,{conclusion:c,onSelectHorse:()=>{}}));

test('reader verdict shows named index leader, challenger and value selection',()=>{
 const html=render(conclusion());
 for(const [role,name] of [['favorite','AxisRunner'],['challenger','ChallengerRunner'],['value','ValueRunner']]){
  assert.match(html,new RegExp(`tm-verdict-${role}[\\s\\S]*?tm-verdict-horse-name">${name}`));
  assert.match(html,new RegExp(`aria-label="[^"]*${name}の分析を見る"`));
 }
 assert.match(html,/指数1位/u);assert.match(html,/相手候補/u);assert.match(html,/注目穴/u);
});

test('a tied leader is not described as a sole index leader',()=>{
 const c=conclusion();c.challenger.horse.score=80;
 assert.match(render(c),/指数1位タイ/u);
});

test('absent value selection stays explicit and is not an interactive horse',()=>{
 const c=conclusion();c.value={horse:null,value:'見当たらず',note:'No qualifying selection'};
 const html=render(c);
 assert.match(html,/<div class="tm-verdict tm-verdict-value/u);
 assert.match(html,/tm-verdict-horse-name">該当馬なし/u);
 assert.doesNotMatch(html,/aria-label="注目穴/u);
});

test('performance history is labeled separately and has no legacy light surface',()=>{
 const html=render(conclusion());
 assert.match(html,/注目穴・危険な人気馬の過去成績/u);
 assert.match(html,/成績と集計方法を見る/u);
 assert.match(html,/tm-role-performance/u);assert.match(html,/tm-conclusion-more/u);
 assert.doesNotMatch(html,/bg-\[#F8FBFC\]/u);
});

test('empty conclusion renders nothing',()=>{
 assert.equal(render(null),'');
});
