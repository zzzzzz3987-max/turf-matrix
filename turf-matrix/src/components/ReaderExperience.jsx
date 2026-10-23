import React,{useEffect,useState,useRef} from 'react';
import {RotateCcw,ChevronRight,ChevronLeft,ChevronDown,Check,X,ArrowLeft} from 'lucide-react';
import {buildReaderCopy} from '../lib/reader-copy.js';
const frameColors=['white','black','red','blue','yellow','green','orange','pink'];
function Badge({horse,race}){const size=race.fieldSize,base=Math.floor(size/8),extra=size%8;let end=0,frame=0;for(let f=0;f<8;f++){end+=base+(f>=8-extra?1:0);if(horse.number<=end){frame=f;break}}if(size<=8)frame=Math.max(0,Math.min(7,horse.number-1));return <span className={'badge '+frameColors[frame]}>{horse.number}</span>}
function AnimatedScore({value,run}){const [score,setScore]=useState(value);useEffect(()=>{const mq=matchMedia('(prefers-reduced-motion: reduce)');if(mq.matches){setScore(value);return}let id;const start=performance.now();setScore(0);const tick=now=>{const p=Math.min(1,(now-start)/700);setScore(Math.round(value*(1-Math.pow(1-p,3))));if(p<1)id=requestAnimationFrame(tick)};id=requestAnimationFrame(tick);return()=>cancelAnimationFrame(id)},[value,run]);return <span aria-label={`指数 ${value}`} className="score">{score}</span>}
const factorLabels={ability:'能力',form:'近走',distance:'距離適性',course:'コース適性',training:'調教',pace:'展開',blood:'血統'};
export function prepareReaderRace(race) {
 if(!race)return null;
 return {...race,horses:[...(race.horses??[])].sort((a,b)=>(b.aiScore??b.tmIndex??-1)-(a.aiScore??a.tmIndex??-1)||(a.number??999)-(b.number??999)).map(h=>{
  const copy=buildReaderCopy(h,race);
  return {...h,tmIndex:h.aiScore??h.tmIndex??null,brief:copy,factors:copy.factors};
 })};
}

const oddsText = value=>Number.isFinite(value)?`${value.toFixed(1)}倍`:'—';

export function ReaderHome({meta,races,signals,onOpenRace,children}) {
 const [tab,setTab]=useState('special'),[track,setTrack]=useState('全場');
 const featured=races.find(r=>r.id===meta?.featuredRaceId)||races.find(r=>r.featuredRace)||races[0];
 const horse=featured?.horses?.[0];
 const ranking=races.flatMap(r=>r.horses.filter(h=>Number.isFinite(h.tmIndex)).map(h=>({race:r,horse:h})))
  .sort((a,b)=>b.horse.tmIndex-a.horse.tmIndex||Number(b.race.number===11)-Number(a.race.number===11)||a.horse.number-b.horse.number||a.horse.name.localeCompare(b.horse.name,'ja')).slice(0,5);
 const combined=[...(signals?.races??[])];
 for(const r of races){const index=combined.findIndex(x=>x.id===r.id);const value={...r,indexTop:r.horses[0],detailAvailable:true};if(index>=0)combined[index]=value;else combined.push(value)}
 const tracks=['全場',...new Set(combined.map(r=>r.track))];
 const visible=combined.filter(r=>(track==='全場'||r.track===track)&&(tab==='all'||races.some(x=>x.id===r.id)))
  .sort((a,b)=>(a.time??'99:99').localeCompare(b.time??'99:99')||a.track.localeCompare(b.track)||a.number-b.number);
 return <main className="tm-modern">
 <div className="date"><span>{meta?.dateLabel??meta?.date}</span><span className="saved">オッズ更新 {meta?.oddsUpdatedAt?new Date(meta.oddsUpdatedAt).toLocaleTimeString('ja-JP',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit'}):'—'}</span></div>
 {featured&&<section className="featured"><div className="eyebrow">注目のレース</div><div className="race-heading"><h1>{featured.name}</h1>{featured.grade&&<span className="grade">{featured.grade}</span>}<span className="venue">{featured.track}{featured.number}R</span></div><p className="conditions">{featured.surface}{featured.distance}m ・ {featured.fieldSize}頭 ・ 発走 {featured.time}</p>
 {horse&&<><div className="leader"><small className="eyebrow">指数総合1位{featured.horses.filter(h=>h.tmIndex===horse.tmIndex).length>1?'タイ':''}</small><div className="leader-name"><Badge horse={horse} race={featured}/><h2>{horse.name}</h2></div><div className="metrics"><div><small>TM INDEX</small>{Number.isFinite(horse.tmIndex)?<><AnimatedScore value={horse.tmIndex}/><span className="index-underline" aria-hidden="true"/></>:<span className="score">—</span>}</div><div><small>単勝</small><div className="odds">{oddsText(horse.odds)}{horse.popularity&&<small>{horse.popularity}人気</small>}</div></div></div></div>
 <div className="comparison"><small>上位比較</small>{featured.horses.slice(1,3).map(h=><div className="contender" key={h.id}><Badge horse={h} race={featured}/><strong>{h.name}</strong><b>{h.tmIndex??'—'}</b><span>{oddsText(h.odds)}{h.popularity&&<small>{h.popularity}人気</small>}</span></div>)}</div></>}
 <div className="feature-actions"><span/><button onClick={()=>onOpenRace(featured.id)}>分析を見る<ChevronRight size={18}/></button></div></section>}
 <div className="tabs" role="tablist" aria-label="レース種別"><button role="tab" aria-selected={tab==='special'} onClick={()=>setTab('special')}>特別</button><button role="tab" aria-selected={tab==='all'} onClick={()=>setTab('all')}>全レース</button></div>
 <div className="track-filters" role="group" aria-label="競馬場で絞り込み">{tracks.map(t=><button key={t} aria-pressed={track===t} onClick={()=>setTrack(t)}>{t}</button>)}</div>
 <div className="list-meta"><span>発走時刻順</span><span aria-live="polite">{visible.length}レース</span></div>
 <div className={`race-list ${tab==='all'?'compact':''}`}>{visible.map(r=>{
  const h=r.indexTop;const Tag=r.detailAvailable?'button':'div';
  return <Tag className="race-row" key={r.id} {...(r.detailAvailable?{onClick:()=>onOpenRace(r.id)}:{})}><span className="post">{r.time}<small>{r.track}{r.number}R</small></span><span className="row-main">{(tab==='special'||r.category!=='race')&&<strong>{r.name}</strong>}<span>{h&&<Badge horse={h} race={r}/>}<span>{h?.name??'—'}</span></span></span><span className="row-score"><small>指数1位{r.leaderStatus==='tied'?'タイ':''}</small>{h?.tmIndex??'—'}</span>{r.detailAvailable?<ChevronRight size={18}/>:<span/>}</Tag>;
 })}</div>
 <section className="daily-ranking"><h2>本日の注目馬</h2>{ranking.map(({race:r,horse:h})=><button className="race-row" key={`${r.id}-${h.id}`} onClick={()=>onOpenRace(r.id,h.id)}><span className="post">{r.time}<small>{r.track}{r.number}R</small></span><span className="row-main"><span><Badge horse={h} race={r}/>{h.name}</span></span><span className="row-score"><small>TM INDEX</small>{h.tmIndex}</span><ChevronRight size={18}/></button>)}</section>
 {children}
 </main>;
}

export function ReaderRace({race,initialHorseId,onBack,children,renderExtra}) {
 return <main className="tm-modern">
 <button className="back" onClick={onBack}><ArrowLeft size={18}/>レース一覧</button>
 <div className="race-heading"><h1>{race.name}</h1><span className="venue">{race.track}{race.number}R</span>{race.grade&&<span className="grade">{race.grade}</span>}</div>
 <p className="conditions">{race.surface}{race.distance}m ・ {race.goingLabel||race.going} ・ {race.fieldSize}頭 ・ 発走 {race.time}</p>
 {race.horses.length>0&&<HorseAnalysis race={race} initialHorseId={initialHorseId} renderExtra={renderExtra}/>}
 {children}
 </main>;
}
export function HorseAnalysis({race,initialHorseId,renderExtra}){
 const [number,setNumber]=useState(race.horses.find(h=>h.id===initialHorseId)?.number??race.horses[0].number);
 useEffect(()=>{const selected=race.horses.find(h=>h.id===initialHorseId);if(selected)setNumber(selected.number)},[initialHorseId,race.id]);
 const [pickerOpen,setPickerOpen]=useState(false);
 const picker=useRef(null);
 useEffect(()=>{
  if(!pickerOpen)return;
  const oldOverflow=document.body.style.overflow;
  document.body.style.overflow='hidden';
  picker.current.showModal();
  picker.current.querySelector('[aria-pressed="true"]')?.focus();
  return()=>{document.body.style.overflow=oldOverflow;if(picker.current?.open)picker.current.close()};
 },[pickerOpen]);
 useEffect(()=>{document.querySelector('.analysis-section')?.scrollIntoView({block:'start'})},[race.id]);
 const horse=race.horses.find(h=>h.number===number)||race.horses[0];
 const horseIndex=race.horses.indexOf(horse);
 const choose=n=>{setNumber(n);setPickerOpen(false)};
 return <section className="analysis-section">
 <h2>各馬の分析</h2>
 <div className="horse-switcher" role="group" aria-label="分析する馬">
 <button className="switch-arrow" aria-label="指数順で前の馬" title="指数順で前の馬" disabled={horseIndex===0} onClick={()=>setNumber(race.horses[horseIndex-1].number)}><ChevronLeft size={21}/></button>
 <button className="horse-picker-trigger" aria-haspopup="dialog" aria-expanded={pickerOpen} onClick={()=>setPickerOpen(true)}><Badge horse={horse} race={race}/><span><strong>{horse.name}</strong><small>指数順 {horseIndex+1} / {race.horses.length}頭</small></span><b>{horse.tmIndex}</b><ChevronDown size={17}/></button>
 <button className="switch-arrow" aria-label="指数順で次の馬" title="指数順で次の馬" disabled={horseIndex===race.horses.length-1} onClick={()=>setNumber(race.horses[horseIndex+1].number)}><ChevronRight size={21}/></button>
 </div>
 <dialog ref={picker} className="horse-picker-sheet" aria-labelledby="horse-picker-title" onClose={()=>setPickerOpen(false)} onClick={e=>{if(e.target===picker.current){const box=e.currentTarget.getBoundingClientRect();if(e.clientX<box.left||e.clientX>box.right||e.clientY<box.top||e.clientY>box.bottom)setPickerOpen(false)}}}>
 <div className="picker-heading"><div><h2 id="horse-picker-title">分析する馬を選択</h2><small>{race.track}{race.number}R · {race.name} · 指数順</small></div><button aria-label="馬の選択を閉じる" title="閉じる" onClick={()=>setPickerOpen(false)}><X size={22}/></button></div>
 <div className="picker-horses">{race.horses.map((x,i)=><button className="picker-horse" key={x.number} aria-pressed={x.number===horse.number} onClick={()=>choose(x.number)}><small>{i+1}</small><Badge horse={x} race={race}/><span>{x.name}</span><strong>{x.tmIndex}</strong>{x.number===horse.number?<Check size={18}/>:<span className="check-space"/>}</button>)}</div>
 </dialog>
 <div className="analysis-horse"><Badge horse={horse} race={race}/><h3>{horse.name}</h3><strong>{horse.tmIndex??'—'}<small>TM INDEX</small></strong></div>
 <p className="horse-meta">{[horse.sexAge,horse.jockey,Number.isFinite(horse.odds)?`単勝 ${oddsText(horse.odds)}`:null].filter(Boolean).join(' ／ ')}</p>
 {horse.brief.headline&&<section className="analysis-copy"><h3>評価した点</h3><p className="reason-headline">{horse.brief.headline}</p>{horse.brief.evidence.some(t=>t!==horse.brief.headline)&&<><h4>実績・根拠</h4>{horse.brief.evidence.filter(t=>t!==horse.brief.headline).map(t=><p key={t}>{t}</p>)}</>}</section>}
 {horse.brief.caution&&<section className="analysis-copy caution"><h3>注意点</h3><p>{horse.brief.caution}</p></section>}
 {horse.factors.length>0&&<section className="factor-section"><h3>項目別評価</h3>{horse.factors.map(f=><details key={`${horse.number}-${f.key}`} className="factor-detail"><summary><span>{factorLabels[f.key]}</span><meter min="0" max="100" value={f.score} aria-label={`${factorLabels[f.key]}の評価`}/><strong>{Math.round(f.score)}</strong><ChevronRight size={16}/></summary><p>{f.explanation}</p></details>)}</section>}
 <details className="field-details"><summary>出走馬の指数一覧 <ChevronRight size={18}/></summary>{race.horses.map(x=><button className="field-horse" key={x.number} aria-pressed={x.number===horse.number} onClick={()=>setNumber(x.number)}><Badge horse={x} race={race}/><span>{x.name}</span><strong>{x.tmIndex}</strong></button>)}</details>
 {renderExtra&&<details key={horse.id} className="expert-details"><summary>血統・調教・相手関係の詳細 <ChevronDown size={18}/></summary>{renderExtra(horse)}</details>}
 </section>
}
