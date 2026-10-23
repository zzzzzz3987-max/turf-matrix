import {buildHorseBrief,publicFactorExplanation} from './public-view-model.js';

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

function runText(run) {
  const finish=run.confirmedFinishPosition??run.finishPosition;
  if (!Number.isInteger(finish)||finish<1||!run.course) return null;
  const name=run.raceName||`${run.course}${run.raceNumber?`${run.raceNumber}R`:''}`;
  const condition=run.surface&&Number.isFinite(run.distance)?`（${run.surface}${run.distance}m）`:'';
  return `${name}${condition}で${finish}着。`;
}

function paceCopy(factor) {
  const c=factor?.calculation;
  if (!c||factor.status!=='active') return null;
  const pace={ハイ:'速いペース',スロー:'遅いペース',ミドル:'平均的なペース'}[c.expectedPace];
  const style={逃げ:'前に行く',先行:'前方で運ぶ',差し:'中団から追い上げる',追込:'後方から追い上げる'}[c.style];
  if (!pace||!style||!Number.isFinite(c.paceAdjustment)) return null;
  const assessment=c.paceAdjustment<0?'負担がかかりやすい組み合わせ。':c.paceAdjustment>0?'持ち味を生かしやすい組み合わせ。':null;
  return assessment?`今回は${pace}を想定。${style}タイプには${assessment}`:null;
}

function sameEvent(a,b) {
  return a.date===b.date&&a.course===b.course&&a.surface===b.surface&&a.distance===b.distance
    &&((a.raceNumber!=null&&b.raceNumber!=null&&a.raceNumber===b.raceNumber)
      ||(a.raceName&&a.raceName===b.raceName));
}

export function directMeetings(horse,race) {
  const cutoff=race.id.slice(0,10);
  const meetings=[];
  for(const own of horse.pastRuns??[]) {
    const finish=own.confirmedFinishPosition??own.finishPosition;
    if(!own.date||own.date>=cutoff||!Number.isInteger(finish)||finish<1)continue;
    for(const opponent of race.horses??[]) {
      if(opponent.id===horse.id||opponent.name===horse.name)continue;
      const other=(opponent.pastRuns??[]).find(r=>sameEvent(own,r));
      const otherFinish=other?.confirmedFinishPosition??other?.finishPosition;
      if(!other||!Number.isInteger(otherFinish)||otherFinish<1||otherFinish===finish)continue;
      const ahead=finish<otherFinish;
      const gap=Number.isFinite(own.timeSeconds)&&Number.isFinite(other.timeSeconds)
        ?Math.round(Math.abs(own.timeSeconds-other.timeSeconds)*10)/10:null;
      // Clock differences must agree with the finishing order; never convert seconds to lengths.
      if(Number.isFinite(own.timeSeconds)&&Number.isFinite(other.timeSeconds)
        &&((ahead&&own.timeSeconds>other.timeSeconds)||(!ahead&&own.timeSeconds<other.timeSeconds)))continue;
      const credentials=(opponent.pastRuns??[]).filter(r=>r.date<own.date&&/G[123]|Ｇ[１２３]/u.test(r.raceName??'')
        &&(r.confirmedFinishPosition??r.finishPosition)<=3&&(r.confirmedFinishPosition??r.finishPosition)>0)
        .sort((a,b)=>b.date.localeCompare(a.date))[0];
      const credential=credentials?`${credentials.raceName}で${credentials.confirmedFinishPosition??credentials.finishPosition}着の`:'';
      const event=own.raceName||`${own.course}${own.raceNumber}R`;
      const difference=gap>0?`${gap.toFixed(1)}秒差で`:'';
      const text=finish===1&&ahead&&gap>0
        ?`${event}では、${credential}${opponent.name}に${gap.toFixed(1)}秒差をつけて勝利。`
        :`${event}では、${credential}${opponent.name}（${otherFinish}着）に${difference}${ahead?'先着':'後着'}して${finish}着。`;
      meetings.push({date:own.date,finish,otherFinish,ahead,text});
    }
  }
  return meetings.sort((a,b)=>b.date.localeCompare(a.date)||a.otherFinish-b.otherFinish);
}

export function buildReaderCopy(horse,race) {
  const brief=buildHorseBrief(horse);
  const raw=horse.analysis?.factorsDetail??{};
  const runs=(horse.pastRuns??[]).filter(r=>r.date&&r.date<race.id.slice(0,10)&&runText(r))
    .sort((a,b)=>b.date.localeCompare(a.date)).slice(0,5);
  const formRows=runs.map(runText).filter(Boolean);
  const wins=runs.filter(r=>(r.confirmedFinishPosition??r.finishPosition)===1).length;
  const placed=runs.filter(r=>{const p=r.confirmedFinishPosition??r.finishPosition;return Number.isInteger(p)&&p>0&&p<=3}).length;
  const positive=Object.entries(raw).filter(([key,f])=>['ability','form','distance','course','training','pace'].includes(key)&&f.status==='active'&&Number.isFinite(f.score)&&f.score>=70)
    .sort((a,b)=>b[1].score-a[1].score);
  const primary=positive[0]?.[0];
  let headline={ability:wins>=2?`直近${runs.length}走で${wins}勝。勝ち切った実績を評価。`:placed>=2?`直近${runs.length}走で${placed}回、3着以内。`:null,
    form:formRows[0]??null,training:'追い切りの時計を評価。',distance:'今回に近い距離での走りを評価。',course:'今回に近いコース条件での実績を評価。',pace:paceCopy(raw.pace)}[primary];
  const meetings=directMeetings(horse,race);
  const abilityScores=(race.horses??[]).map(h=>h.analysis?.factorsDetail?.ability).filter(f=>f?.status==='active'&&Number.isFinite(f.score)).map(f=>f.score);
  const topAbility=raw.ability?.status==='active'&&raw.ability.score>=70&&abilityScores.length>1&&raw.ability.score===Math.max(...abilityScores);
  const tied=abilityScores.filter(s=>s===raw.ability?.score).length>1;
  if(topAbility&&meetings.some(m=>m.ahead)) {
    headline=`${raw.pace?.calculation?.paceAdjustment<0?'展開には注意が必要だが、':''}能力評価は今回のメンバーで${tied?'同率':''}1位。直接対決の実績も評価。`;
  }
  const factors=['ability','form','distance','course','training','pace','blood'].map(key=>{
    const f=raw[key];
    if (!f||f.status!=='active'||!Number.isFinite(f.score))return null;
    let explanation=readerText(publicFactorExplanation({...f,key},{horse:horse})??f.summary);
    if(key==='form') explanation=formRows.slice(0,2).join('')||null;
    if(key==='ability'&&formRows.length) explanation=meetings[0]?.text??`${formRows[0]}${placed>=2?`直近${runs.length}走のうち${placed}走で3着以内。`:''}`;
    if(key==='pace') explanation=paceCopy(f);
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
  let caution=raw.pace?.calculation?.paceAdjustment<0?paceCopy(raw.pace):null;
  if(!caution&&/調教|追い切り/u.test(brief.caution??''))caution=readerText(brief.caution);
  // A bare pedigree pairing or a neutral statement is not a warning.
  const evidence=meetings.length?[meetings[0].text,formRows.find(t=>!t.startsWith((horse.pastRuns??[]).find(r=>r.date===meetings[0].date)?.raceName??'\0'))].filter(Boolean)
    :primary==='ability'||primary==='form'?formRows.slice(0,2):[factors.find(f=>f.key===primary)?.explanation].filter(Boolean);
  return {headline:headline&&evidence.length?headline:null,evidence:[...new Set(evidence)],caution,factors};
}
