import {publicFactorExplanation} from './public-view-model.js';

const internalSentence = /データ|未検証|検証中|未取得|取得済|未対応|情報が不足|情報不足|中立(?:扱い|評価|と判断)|算出|補正|Confidence|Evidence|血統点は|総合評価|を重視|苦手という意味ではありません|参考扱い/iu;
export function readerText(text) {
  if (typeof text !== 'string') return null;
  const sentences = text.match(/[^。！？]+[。！？]?/gu) ?? [];
  const result = sentences.map(s=>s.trim()).filter(s=>s&&!internalSentence.test(s)).join('')
    .replace(/上がり性能/gu,'最後の600mの速さ')
    .replace(/上がり最速の材料は/gu,'最後の600mの最速時計は')
    .replace(/終い1F/gu,'最後の200m')
    .replace(/4F/gu,'800m')
    .replace(/ハイペース想定/gu,'速いペースを想定')
    .replace(/スローペース想定/gu,'遅いペースを想定');
  return result || null;
}

const finishOf=run=>run.confirmedFinishPosition??run.finishPosition;
const positiveNumber=value=>Number.isFinite(value)&&value>0;
const seconds=value=>value.toFixed(1).replace('.', '秒');
const raceDate=race=>race.id?.slice(0,10)??race.raceContext?.date??'';
const daysBetween=(a,b)=>(Date.parse(b)-Date.parse(a))/86400000;
const straightRace=race=>(race.track??race.course)==='新潟'&&race.surface==='芝'&&race.distance===1000;
const sameSurface=(a,b)=>a.surface&&b.surface&&a.surface===b.surface;
const validDate=value=>/^\d{4}-\d{2}-\d{2}$/u.test(value??'')&&Number.isFinite(Date.parse(value))
  &&new Date(value).toISOString().slice(0,10)===value;

function runName(run) {
  const date=`${run.date.slice(0,4)}年${Number(run.date.slice(5,7))}/${Number(run.date.slice(8,10))}`;
  const name=run.raceName?.replace(/[（(][^）)]*$/u,'')||`${run.course}${run.raceNumber?`${run.raceNumber}R`:''}`;
  return `${date}の${name}`;
}

function runText(run) {
  const finish=finishOf(run);
  if(!Number.isInteger(finish)||finish<1||(!run.course&&!run.raceName))return null;
  const condition=run.surface&&positiveNumber(run.distance)?`（${run.surface}${run.distance}m）`:'';
  return `${runName(run)}${condition}で${finish}着。`;
}

function paceCopy(factor) {
  const c=factor?.calculation;
  if (!c||factor.status!=='active') return null;
  const pace={ハイ:'速いペース',スロー:'遅いペース',ミドル:'平均的なペース',標準:'平均的なペース'}[c.expectedPace];
  const style={逃げ:'前に行く',先行:'前方で運ぶ',差し:'中団から追い上げる',追込:'後方から追い上げる'}[c.style];
  if (!pace||!style||!Number.isFinite(c.paceAdjustment)) return null;
  const assessment=c.paceAdjustment<0?'負担がかかりやすい組み合わせ。':c.paceAdjustment>0?'持ち味を生かしやすい組み合わせ。':null;
  return assessment?`今回は${pace}を想定。${style}タイプには${assessment}`:null;
}

function sameEvent(a,b) {
  return !!a.course&&!!b.course&&!!a.surface&&positiveNumber(a.distance)&&positiveNumber(b.distance)
    &&a.date===b.date&&a.course===b.course&&a.surface===b.surface&&a.distance===b.distance
    &&((a.raceNumber!=null&&b.raceNumber!=null&&a.raceNumber===b.raceNumber)
      ||(a.raceName&&a.raceName===b.raceName));
}

export function directMeetings(horse,race) {
  const cutoff=raceDate(race);
  const meetings=[];
  for(const own of horse.pastRuns??[]) {
    const finish=own.confirmedFinishPosition??own.finishPosition;
    if(!validDate(own.date)||own.date>=cutoff||!Number.isInteger(finish)||finish<1)continue;
    for(const opponent of race.horses??[]) {
      if(opponent.id===horse.id||opponent.name===horse.name)continue;
      const other=(opponent.pastRuns??[]).find(r=>sameEvent(own,r));
      const otherFinish=other?.confirmedFinishPosition??other?.finishPosition;
      if(!other||!Number.isInteger(otherFinish)||otherFinish<1||otherFinish===finish)continue;
      const ahead=finish<otherFinish;
      const gap=positiveNumber(own.timeSeconds)&&positiveNumber(other.timeSeconds)
        ?Math.round(Math.abs(own.timeSeconds-other.timeSeconds)*10)/10:null;
      // Clock differences must agree with the finishing order; never convert seconds to lengths.
      if(positiveNumber(own.timeSeconds)&&positiveNumber(other.timeSeconds)
        &&((ahead&&own.timeSeconds>other.timeSeconds)||(!ahead&&own.timeSeconds<other.timeSeconds)))continue;
      const credentials=(opponent.pastRuns??[]).filter(r=>validDate(r.date)&&r.date<own.date&&/G[123]|Ｇ[１２３]/u.test(r.raceName??'')
        &&(r.confirmedFinishPosition??r.finishPosition)<=3&&(r.confirmedFinishPosition??r.finishPosition)>0)
        .sort((a,b)=>b.date.localeCompare(a.date))[0];
      const credential=credentials?`${credentials.raceName}で${credentials.confirmedFinishPosition??credentials.finishPosition}着の`:'';
      const event=own.raceName||`${own.course}${own.raceNumber}R`;
      const difference=gap>0?`${gap.toFixed(1)}秒差で`:'';
      const text=finish===1&&ahead&&gap>0
        ?`${event}では、${credential}${opponent.name}に${gap.toFixed(1)}秒差をつけて勝利。`
        :`${event}では、${credential}${opponent.name}（${otherFinish}着）に${difference}${ahead?'先着':'後着'}して${finish}着。`;
      meetings.push({date:own.date,course:own.course,raceNumber:own.raceNumber,finish,otherFinish,ahead,credential:!!credentials,text});
    }
  }
  return meetings.sort((a,b)=>b.date.localeCompare(a.date)||a.otherFinish-b.otherFinish);
}

// Read the horse's own runs only. Pace (sectional times) and outcome bias are separate evidence.
export function readerRunEvidence(horse,race) {
  const cutoff=raceDate(race);
  const history=horse.analysis?.factorsDetail?.pace?.historicalFlow?.runs??[];
  return (horse.pastRuns??[]).filter(r=>validDate(r.date)&&r.date<cutoff&&runText(r)
    &&(!positiveNumber(r.fieldSize)||finishOf(r)<=r.fieldSize))
    .sort((a,b)=>b.date.localeCompare(a.date)).map(run=>{
      const finish=finishOf(run);
      const field=Number.isInteger(run.fieldSize)&&run.fieldSize>=finish?run.fieldSize:null;
      const positions=(straightRace(run)?[]:run.passingOrder??[]).map(p=>Number.isInteger(p)&&p>0&&(!field||p<=field)?p:null);
      const first=positions.find(p=>p!==null)??null;
      const last=positions[3]??null;
      const flow=run.course&&Number.isInteger(run.raceNumber)&&run.raceNumber>0
        ?history.find(f=>f.date===run.date&&f.course===run.course&&f.raceNumber===run.raceNumber&&f.finishPosition===finish):null;
      const shape=flow?.shapeConfidence==='high'?flow.shape:null;
      const rear=field&&first!==null&&(first-1)/Math.max(1,field-1)>=.6;
      const front=first!==null&&(first<=2||(field&&(first-1)/Math.max(1,field-1)<=.25));
      const gained=last!==null?last-finish:0;
      const against=finish<=3&&((shape==='front_survival'&&rear&&gained>=2)||(shape==='front_collapse'&&front));
      const aided=finish<=3&&((shape==='front_survival'&&front)||(shape==='front_collapse'&&rear));
      const age=daysBetween(run.date,cutoff);
      const close=finish>1&&Number.isFinite(run.margin)&&run.margin>=0&&run.margin<=.5;
      const relevant=sameSurface(run,race);
      const distanceGap=positiveNumber(run.distance)&&positiveNumber(race.distance)?Math.abs(run.distance-race.distance):null;
      const grade=/G[123]|Ｇ[１２３]/u.test(run.raceName??'')&&finish<=5;
      const merit=(finish===1?40:finish===2?36:finish===3?32:finish<=5?24:Math.max(0,18-finish))
        +(close?(0.6-run.margin)*12:0)
        +(relevant?18:-20)+(distanceGap!==null?Math.max(0,12-distanceGap/50):0)
        +(run.course===race.track?6:0)+(against?18:0)+(grade?14:0)
        -(run.course?0:16)-Math.min(40,Math.max(0,age)/22);
      return {run,finish,field,first,last,rear,front,gained,flow,shape,against,aided,age,close,relevant,distanceGap,merit};
    });
}

function positionText(p) {
  if(p.last===null)return '';
  return p.field&&p.last===p.field?'最後方から':`4角${p.last}番手から`;
}

function performanceText(p) {
  const {run,finish}=p;
  const condition=run.surface&&positiveNumber(run.distance)?`（${run.surface}${run.distance}m）`:'';
  const bias=p.against?(p.shape==='front_survival'?'前残りの中、':'前に行った馬が崩れる中、'):'';
  const closing=positiveNumber(run.last3F)&&run.last3F>=25&&run.last3F<=65?`最後の600m${seconds(run.last3F)}で`:'';
  const margin=finish>1&&Number.isFinite(run.margin)&&run.margin>=0?run.margin===0?'勝ち馬と同タイムの':`${seconds(run.margin)}差の`:'';
  const position=finish===1&&p.first===1&&p.last===1?'先頭で運び、':positionText(p);
  return `${runName(run)}${condition}は、${bias}${position}${closing}${margin}${finish===1?'1着':`${finish}着`}。`;
}

function interpretation(p,profiles) {
  if(p.against)return p.shape==='front_survival'
    ?'前の馬が残る展開でも差を詰めた決め手を評価。'
    :'先行勢に厳しい流れでも上位に踏ん張った点を評価。';
  const pair=profiles.slice(0,2);
  if(pair.length===2&&pair.includes(p)&&pair.every(r=>r.finish<=3&&r.front))return '近2走とも前で運んで3着以内。先行して上位に残れる点を評価。';
  if(pair.length===2&&pair.includes(p)&&pair.every(r=>r.finish<=3&&r.gained>=3))return '近2走とも直線で複数頭分の着順を上げた。追い上げを続けている点を評価。';
  if(p.finish<=3&&/G[123]|Ｇ[１２３]/u.test(p.run.raceName??''))return '重賞で上位争いに加わった実績が評価材料。';
  if(p.finish===1&&p.first===1&&p.last===1)return '先手を取る形で勝ち切った点を評価。';
  if(p.finish<=3&&p.gained>=3)return '直線で複数頭を交わした追い上げが評価点。';
  if(p.finish===1&&p.last!==null&&p.last>=3)return '直線で前を交わして勝ち切った決め手を評価。';
  if(p.finish<=3&&p.front)return '前で流れに乗り、上位を確保できた点を評価。';
  if(p.finish<=3&&p.gained>0)return '直線で着順を上げ、上位争いに加わった。';
  if(p.finish<=3)return p.relevant&&Number.isFinite(p.distanceGap)&&p.distanceGap<=200?'今回に近い距離で上位に入った走りが評価材料。':'この条件で上位に入った走りが評価材料。';
  if(p.close)return '着順ほど勝ち馬との差は大きくない。';
  return null;
}

function trainingText(horse,cutoff) {
  const sessions=[...(horse.training?.slope??[]).map(s=>({...s,kind:'坂路',times:s})),
    ...(horse.training?.wood??[]).map(s=>({...s,kind:'ウッド',times:s.times??{}}))]
    .filter(s=>/^\d{8}$/u.test(s.date??'')&&validDate(`${s.date.slice(0,4)}-${s.date.slice(4,6)}-${s.date.slice(6,8)}`)
      &&s.date<cutoff.replaceAll('-','')&&positiveNumber(s.times['4F'])&&positiveNumber(s.times['1F']))
    .sort((a,b)=>b.date.localeCompare(a.date));
  const s=sessions[0];
  return s?`${Number(s.date.slice(4,6))}/${Number(s.date.slice(6,8))}の${s.kind}は800m${seconds(s.times['4F'])}、最後の200m${seconds(s.times['1F'])}。`:null;
}

function currentConditionText(p,race) {
  if(!positiveNumber(race.distance)||!positiveNumber(p.run.distance)||!race.surface)return null;
  if(!sameSurface(p.run,race))return `評価材料の${p.run.surface}${p.run.distance}mから、今回は${race.surface}${race.distance}mに替わる。`;
  const delta=race.distance-p.run.distance;
  if(delta)return `今回はこの走りから${Math.abs(delta)}m${delta>0?'延長':'短縮'}の${race.surface}${race.distance}m。`;
  return `今回は${p.run.course===race.track?'同じ':'同じ距離の'}${race.track}${race.surface}${race.distance}m。`;
}

function cautionText(horse,race,profiles,primary) {
  const latest=profiles[0];
  if(!latest)return null;
  const raw=horse.analysis?.factorsDetail?.pace;
  const scenario=race.raceContext?.paceScenario;
  const style=raw?.calculation?.style??scenario?.runners?.find(r=>r.horseName===horse.name)?.style;
  const pace=scenario?.expectedPace??raw?.calculation?.expectedPace;
  const counts=scenario?.counts??{};
  const crowded=(counts.逃げ??0)>=3||(counts.逃げ??0)+(counts.先行??0)>=Math.max(4,(race.fieldSize??race.horses?.length??0)*.45);
  const recent=profiles.slice(0,3);
  const rear=recent.filter(p=>p.rear).length>=2||(recent.length===1&&latest.rear);
  const front=style==='逃げ'||style==='先行'||(latest.front&&!rear);
  const frontAnchor=recent.find(p=>p.front);
  const frontIntro=latest.front&&latest.last!==null?`前走は4角${latest.last}番手。`
    :frontAnchor&&frontAnchor.last!==null?`${runName(frontAnchor.run)}では4角${frontAnchor.last}番手。`:'';
  const inner=raw?.contextFit?.frame==='inner';
  const outer=raw?.contextFit?.frame==='outer';
  const delta=sameSurface(latest.run,race)&&positiveNumber(latest.run.distance)&&positiveNumber(race.distance)?race.distance-latest.run.distance:0;

  if(primary&&!sameSurface(primary.run,race)&&primary.run.surface&&race.surface) {
    return `評価材料は${primary.run.surface}${primary.run.distance}mの走り。今回は${race.surface}${race.distance}mに替わるため、同じ位置取りや脚の使い方が通用するかが焦点。`;
  }
  if(straightRace(race)) {
    const same=profiles.filter(p=>p.run.course==='新潟'&&p.run.surface==='芝'&&p.run.distance===1000).slice(0,3);
    if(same.length>=2&&same.some(p=>p.finish<=3)&&same.some(p=>p.finish>=10))return `直線1000mでの直近${same.length}走は${same.map(p=>`${p.finish}着`).join('・')}。好走時の時計だけでなく、序盤の追走から力を出せるかが鍵。`;
    if(latest.run.distance>1000)return `前走の${latest.run.distance}mから1000mへ短縮。コーナーで位置を挽回できないため、序盤の追走で置かれると持ち味を出し切りにくい。`;
    if(!straightRace(latest.run))return `前走の${latest.run.surface}${latest.run.distance}mから、今回は直線芝1000m。コーナーで息を入れる場面がなく、短い距離で加速を途切れさせないことが鍵。`;
    if(latest.finish>=8)return `前走の直線1000mは${latest.finish}着${Number.isFinite(latest.run.margin)?`・${seconds(latest.run.margin)}差`:''}。最後の600mの時計だけでは届いておらず、序盤で離され過ぎないことが必要。`;
    return `前走の直線1000mは${latest.finish}着。今回は${horse.number}番から、進路を切り替えるロスを抑え、短い距離で加速を途切れさせないことが鍵。`;
  }
  if(delta>=400)return `前走から${delta}m延長の${race.distance}m。${front?(crowded?'前に行く馬も多く、競り合いで脚を使うと終盤の余力を失いやすい。':'前半から脚を使い過ぎず、最後まで余力を残せるかが鍵。'):'距離が延びる分、道中で脚を使い過ぎると最後の粘りが問われる。'}`;
  if(primary?.aided&&((primary.front&&front)||(primary.rear&&rear)))return `評価した${runName(primary.run)}は、${primary.shape==='front_survival'?'前に行った馬が残る':'後方の馬が浮上する'}展開。今回は${front?(crowded?'前に行く馬が多く、楽に運べないと粘りが問われる。':'早めに競りかけられたときに、同じ粘りを出せるかが鍵。'):'前が楽に運ぶと、同じ追い上げでも差し届かない可能性がある。'}`;
  const layoff=daysBetween(latest.run.date,raceDate(race));
  if(layoff>=120)return `前走から${Math.round(layoff)}日ぶりの実戦。${front?'序盤から競り合うと負担が大きく、無理なく流れに乗れるかが鍵。':'序盤で位置を下げ過ぎると、直線だけで差を詰める競馬になりやすい。'}`;
  if(rear||style==='追込')return `${rear&&recent.length>=2?'近走は後方からの競馬が続く。':latest.last!==null?`前走は4角${latest.last}番手。`:''}${pace==='スロー'?'今回は遅い流れが想定され、':'前が楽に運ぶ展開では、'}差し遅れるリスクがある。${inner?'内寄りの枠だけに、直線で進路を確保して末脚を生かせるかが鍵。':delta<0?`${Math.abs(delta)}m短縮で、追走から置かれ過ぎないことも必要。`:'勝負どころまでに前との差を詰められるかが鍵。'}`;
  if(front)return `${frontIntro}${crowded||pace==='ハイ'?'今回は前に行く馬が多く、競り合いが長引くと最後の粘りが問われる。':outer?'外寄りの枠から前を取りに行くと、序盤で脚を使いやすい。':'早めに後続に並ばれる展開では、終盤の粘りが問われる。'}${delta<0?`${Math.abs(delta)}m短縮で、前走より速い追走への対応も鍵。`:''}`;
  return `${latest.last!==null?`前走は4角${latest.last}番手。`:''}${delta<0?`今回は${Math.abs(delta)}m短縮で、前走と同じ位置を取れるとは限らない。`:pace==='スロー'?'今回は遅い流れが想定され、前との差を残すと差し遅れやすい。':'前が楽に運ぶ展開では、仕掛けが遅れると届かない可能性がある。'}${inner?'内寄りの枠から、直線で進路を確保できるかが鍵。':'勝負どころで置かれずに加速へ移れるかが鍵。'}`;
}

export function buildReaderCopy(horse,race) {
  const raw=horse.analysis?.factorsDetail??{};
  const all=readerRunEvidence(horse,race);
  const recent=all.filter(p=>p.age<=730);
  const profiles=recent.length?recent:all.slice(0,3);
  const primary=[...profiles].sort((a,b)=>b.merit-a.merit||b.run.date.localeCompare(a.run.date))[0];
  const latest=all[0];
  const meetings=directMeetings(horse,race).filter(m=>daysBetween(m.date,raceDate(race))<=730&&m.finish<=5&&(m.otherFinish<=5||m.credential));
  const conclusion=primary&&interpretation(primary,all);
  const headline=primary?`${performanceText(primary)}${conclusion??''}`:null;
  const evidence=[];
  if(primary) {
    const second=latest!==primary?latest:profiles.find(p=>p!==primary&&p.age<=400&&sameSurface(p.run,race)&&p.finish<=3);
    if(second)evidence.push(performanceText(second));
    const meeting=meetings.find(m=>m.credential||(!second&&(m.date!==primary.run.date||m.otherFinish<=3)));
    if(meeting)evidence.push(`${meeting.date.slice(0,4)}年${Number(meeting.date.slice(5,7))}/${Number(meeting.date.slice(8,10))}の${meeting.text}`);
    if(!evidence.length) {
      const flow=primary.flow;
      if(primary.run.distance>=1200&&positiveNumber(flow?.first3F)&&positiveNumber(flow?.last3F))evidence.push(`レース全体は最初の600m${seconds(flow.first3F)}、最後の600m${seconds(flow.last3F)}。${flow.first3F-flow.last3F>=2?'終盤に速くなる流れだった。':flow.last3F-flow.first3F>=2?'終盤ほど時計がかかる流れだった。':''}`);
      else if(primary.last!==null&&primary.first!==null&&Math.abs(primary.first-primary.last)>=3)evidence.push(`道中は${primary.first}番手から4角${primary.last}番手へ位置を変え、${primary.finish}着。`);
      const condition=currentConditionText(primary,race);
      if(condition)evidence.push(condition);
    }
  }
  const runs=profiles.map(p=>p.run);
  const factors=['ability','form','distance','course','training','pace','blood'].map(key=>{
    const f=raw[key];
    if (!f||f.status!=='active'||!Number.isFinite(f.score))return null;
    let explanation=readerText(publicFactorExplanation({...f,key},{horse:horse})??f.summary);
    if(key==='form') explanation=all.slice(0,2).map(performanceText).join('')||null;
    if(key==='ability') explanation=meetings.find(m=>m.credential)?.text??headline;
    if(key==='pace') explanation=paceCopy(f)??cautionText(horse,race,all,primary);
    if(key==='training')explanation=trainingText(horse,raceDate(race));
    if(key==='course') {
      const course=profiles.filter(p=>p.run.course===race.track&&sameSurface(p.run,race)&&Number.isFinite(p.distanceGap)&&p.distanceGap<=200).sort((a,b)=>b.merit-a.merit)[0];
      explanation=course?performanceText(course):null;
    }
    if(key==='blood') {
      const profile=f.sireProfile;
      explanation=profile?.status==='curated'&&profile.traits?.length&&f.identity?.sire
        ?`父は${f.identity.sire}。血統上の特徴は${profile.traits.join('・')}。` : null;
    }
    if(key==='distance') {
      const near=runs.filter(r=>r.surface===race.surface&&Number.isFinite(r.distance)&&Math.abs(r.distance-race.distance)<=200);
      const previous=runs[0];
      const change=previous?.surface===race.surface&&Number.isFinite(previous.distance)&&Number.isFinite(race.distance)?race.distance-previous.distance:null;
      const changeText=change===null?'':change===0?`今回は前走と同じ${race.distance}m。`:`今回は前走より${Math.abs(change)}m${change>0?'長い':'短い'}${race.distance}m。`;
      explanation=near.length?`${changeText}${near.slice(0,2).map(runText).join('')}`:null;
    }
    return explanation?{key,score:f.score,explanation}:null;
  }).filter(Boolean);
  return {headline,evidence:[...new Set(evidence)].slice(0,2),caution:cautionText(horse,race,all,primary),factors};
}
