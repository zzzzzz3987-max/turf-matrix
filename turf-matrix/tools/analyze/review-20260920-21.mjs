import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { summarizePublicRoleRecords } from './lib/public-role-performance.mjs';

const root = process.cwd();
const runner = 'C:/Users/R/AppData/Local/TurfMatrix/odds-runner/turf-matrix';
const fourDays = process.argv.includes('--four-days');
const dates = fourDays ? ['2026-09-19', '2026-09-20', '2026-09-21', '2026-09-22'] : ['2026-09-20', '2026-09-21'];
const outputPrefix = fourDays ? '2026-09-19-22' : '2026-09-20-21';
const read = p => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
const git = args => execFileSync('git', args, { cwd: runner, encoding: 'utf8', maxBuffer: 50000000 });
const sha = s => createHash('sha256').update(s).digest('hex');
const show = (commit, file) => git(['show', `${commit}:turf-matrix/${file}`]);
const historicalModule = async (commit, file) => import(`data:text/javascript;base64,${Buffer.from(show(commit, file)).toString('base64')}`);
const normalize = s => String(s ?? '').normalize('NFKC').replace(/[\s*＊$＄]/g, '');
const completion = new Map();
for (const line of fs.readFileSync(path.join(runner, 'tools/pad-runtime/odds-auto-update.log'), 'utf8').split('\n')) {
  const m = line.match(/^(\S+).*Automatic odds update completed (\{.*\})/);
  if (m) completion.set(JSON.parse(m[2]).commit, m[1]);
}
const morning = read(path.join(runner, 'tools/pad-runtime/codex-first-race-odds-20260921.json'));
completion.set(morning.commit, morning.publicVerifiedAt);
const history = git(['log', '--format=%H %cI', '--since=2026-09-17T00:00:00+09:00', '--', 'tools/week-data.json', 'tools/all-race-signals.json'])
  .trim().split('\n').map(line => line.split(' '));
const snapshots = [];
for (const [commit, committedAt] of history) {
  const signalsText = show(commit, 'tools/all-race-signals.json');
  const signals = JSON.parse(signalsText);
  if (!dates.includes(signals.date)) continue;
  const weekText = show(commit, 'tools/week-data.json');
  const week = JSON.parse(weekText);
  assert.equal(week.meta.date, signals.date);
  snapshots.push({ commit, availableAt: completion.get(commit) ?? committedAt,
    timeBasis: completion.has(commit) ? 'completion-log-or-public-verification' : 'publication-commit-time',
    signals, week, signalSha256: sha(signalsText), weekSha256: sha(weekText),
    selector: await historicalModule(commit, 'src/lib/public-role-selection.js') });
}
snapshots.sort((a, b) => new Date(a.availableAt) - new Date(b.availableAt));
const rows = [], battles = [], changes = [], sources = [];
const record = (horse, result, context) => {
  const h = result.Horses.find(h => h.HorseNumber === horse.number);
  assert.ok(h, `Missing horse ${context.raceId}/${horse.number}`);
  assert.equal(normalize(h.HorseName), normalize(horse.name), `Name mismatch ${context.raceId}`);
  assert.equal(result.IsFinal, true);
  assert.equal(result.HasPayouts, true);
  const payout = type => result.Payouts.find(p => p.Type === type && p.HorseNumber === horse.number)?.Payout ?? 0;
  return { ...context, number: horse.number, name: horse.name, tmIndex: horse.tmIndex ?? horse.aiScore,
    odds: horse.odds, popularity: horse.popularity, finalPopularity: h.FinalPopularity,
    finishPosition: h.FinishPosition, abnormalityCode: h.AbnormalityCode,
    payoutAvailable: true, winPayout: payout('win'), placePayout: payout('place') };
};
for (const date of dates) {
  const results = read(path.join(root, `data/archive/${date}-all-race-results.json`));
  assert.equal(results.RaceDate, date);
  assert.equal(results.Races.length, ['2026-09-19', '2026-09-20'].includes(date) ? 24 : 12);
  assert.equal(new Set(results.Races.map(r => r.Race.JvKey)).size, results.Races.length);
  for (const result of results.Races) {
    assert.equal(result.IsFinal, true);
    assert.equal(result.HasPayouts, true);
    assert.equal(new Set(result.Horses.map(h => h.HorseNumber)).size, result.Horses.length);
    const id = `${date}-${result.Race.CourseName}-${result.Race.RaceNo}R`;
    const candidates = snapshots.filter(s => s.signals.date === date).map(s => ({ s, race: s.signals.races.find(r => r.id === id) }))
      .filter(({ s, race }) => race && new Date(s.availableAt) < new Date(`${date}T${race.time}:00+09:00`));
    assert.ok(candidates.length, `No pre-race snapshot ${id}`);
    const { s, race } = candidates.at(-1);
    const context = { date, raceId: id, race: race.name, time: race.time, commit: s.commit, availableAt: s.availableAt };
    sources.push({ ...context, timeBasis: s.timeBasis, signalSha256: s.signalSha256, weekSha256: s.weekSha256 });
    if (race.indexTop) rows.push(record(race.indexTop, result, { ...context, scope: 'allRaceSignals', role: 'leader' }));
    if (race.valueWatch) rows.push(record(race.valueWatch, result, { ...context, scope: 'allRaceSignals', role: 'value' }));
    const detail = s.week.races.find(r => r.id === id);
    if (detail) {
      const score = h => h.aiScore ?? h.tmIndex;
      const max = Math.max(...detail.horses.map(score));
      for (const h of detail.horses.filter(h => score(h) === max)) rows.push(record(h, result, { ...context, scope: 'specialDetails', role: 'leader' }));
      const selected = s.selector.selectPublicRoleHorses(detail);
      for (const role of ['value', 'danger']) if (selected[role]) rows.push(record(selected[role], result, { ...context, scope: 'specialDetails', role }));
      const morningCandidates = candidates.filter(({ s }) => new Date(s.availableAt) <= new Date(`${date}T10:00:00+09:00`));
      const morningSnapshot = morningCandidates.at(-1);
      if (morningSnapshot) {
        const mr = morningSnapshot.s.week.races.find(r => r.id === id);
        const danger = mr && morningSnapshot.s.selector.selectPublicDangerHorse(mr);
        if (danger) rows.push(record(danger, result, { ...context, commit: morningSnapshot.s.commit,
          availableAt: morningSnapshot.s.availableAt, scope: 'morningSpecialDetails', role: 'danger' }));
      }
      let previous;
      for (const c of candidates) {
        const r = c.s.week.races.find(r => r.id === id);
        const h = r && c.s.selector.selectPublicDangerHorse(r);
        const key = h?.number ?? null;
        if (previous !== key) changes.push({ date, raceId: id, availableAt: c.s.availableAt, commit: c.s.commit,
          selection: h ? record(h, result, { role: 'danger' }) : null });
        previous = key;
      }
    }
    if (s.signals.battleRaceId === id) {
      let plan = race.publicTicketPlan;
      if (!plan) {
        const old = await historicalModule(s.commit, 'tools/battle-ticket-selection.mjs');
        const p = old.buildBaselineBattleTicketPlan(race);
        plan = { ...p, tickets: p.tickets.map(t => ({ type: t.type, numbers: t.horses.map(h => h.number), units: t.units })) };
      }
      const tickets = plan.tickets.map(t => {
        const horses = t.numbers.map(number => result.Horses.find(h => h.HorseNumber === number));
        assert.ok(horses.every(Boolean));
        const refunded = horses.some(h => ['1', '2', '3'].includes(h.AbnormalityCode));
        const numbers = [...t.numbers].sort((a, b) => a - b).join('-');
        const payout = result.Payouts.find(p => p.Type === t.type && [...(p.HorseNumbers ?? [p.HorseNumber])].sort((a, b) => a - b).join('-') === numbers);
        const trioHit = t.type === 'trio' && horses.every(h => h.FinishPosition > 0 && h.FinishPosition <= 3);
        assert.ok(!trioHit || payout, `Winning trio payout unavailable: ${id}/${numbers}`);
        return { ...t, stake: 100 * t.units, payout: refunded ? 100 * t.units : (payout?.Payout ?? 0) * t.units, refunded };
      });
      battles.push({ ...context, axis: record(race.indexTop, result, {}), ruleVersion: plan.ruleVersion,
        tickets, stake: tickets.reduce((n, t) => n + t.stake, 0), payout: tickets.reduce((n, t) => n + t.payout, 0) });
    }
  }
}
const scopes = ['specialDetails', 'allRaceSignals', 'morningSpecialDetails'];
const summary = dates.concat('combined').flatMap(date => scopes.map(scope => ({ date, scope,
  roles: Object.fromEntries(['leader', 'value', 'danger'].map(role => [role,
    summarizePublicRoleRecords(rows.filter(r => (date === 'combined' || r.date === date) && r.scope === scope && r.role === role))])) })));
const report = { generatedAt: new Date().toISOString(), dates, raceCount: sources.length,
  basis: 'Latest available pre-start publication snapshot per race; original selector from that commit. No current development rules.',
  notes: ['Special-detail leaders include all tied top scores; all-race signals count only the displayed indexTop.',
    'Danger selections are displayed in special-race details, not the all-race signal rows.',
    'Morning danger is a separate fixed-time comparison and is not added to final selection totals.',
    'Manual publications without completion logs use commit time; exact CDN visibility time is not reconstructed.',
    'Trio payouts are not in the current result feed. All losing trio tickets are settled by confirmed order; a winning trio without payout would stop this script.'],
  summary, battles, dangerHistory: changes, rows, sources };
const output = path.join(root, `docs/reviews/${outputPrefix}-results.json`);
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
if (fourDays) {
  const roleLabels = { leader: '指数1位', value: '注目穴', danger: '危険な人気馬' };
  const lines = ['# TURF MATRIX 9/19〜9/22 集計明細', '',
    '72レース。各馬・各券種100円。特別レース詳細は同点1位を全頭、全レース一覧は表示された1頭を集計。両者は重複するため合算しません。', '',
    '| 日付 | 対象 | 区分 | 頭数 | 勝利 | 3着以内 | 単勝回収率 | 複勝回収率 |',
    '|---|---|---|---:|---:|---:|---:|---:|'];
  for (const s of summary.filter(s => s.scope !== 'morningSpecialDetails')) {
    for (const [role, v] of Object.entries(s.roles)) {
      if (!v.sampleSize) continue;
      lines.push(`| ${s.date} | ${s.scope} | ${roleLabels[role]} | ${v.sampleSize} | ${v.wins} | ${v.topThree} | ${v.winReturnRate}% | ${v.placeReturnRate}% |`);
    }
  }
  lines.push('', '## 全選出明細', '', '| 日付 | レース | 対象 | 区分 | 馬名 | 保存オッズ | 着順 | 単勝払戻 | 複勝払戻 |', '|---|---|---|---|---|---:|---:|---:|---:|');
  for (const r of rows.filter(r => r.scope !== 'morningSpecialDetails')) lines.push(`| ${r.date} | ${r.raceId} | ${r.scope} | ${roleLabels[r.role]} | ${r.name} | ${r.odds} | ${r.finishPosition} | ${r.winPayout} | ${r.placePayout} |`);
  lines.push('', '## 勝負レース', '', ...battles.map(b => `- ${b.date} ${b.race}: ${b.axis.name} ${b.axis.finishPosition}着 / 投資${b.stake}円 / 払戻${b.payout}円 / ${b.tickets.map(t => `${t.type} ${t.numbers.join('-')}`).join('、')}`), '',
    '## 集計上の注意', '',
    '- 9/22中山11Rは直前更新失敗のため、14:43更新の保存版を使用。発走後の再選出は行っていません。',
    '- 自動公開は完了ログ、その他は公開コミット時刻を採用。CDNへの厳密な反映時刻は再現できません。',
    '- 危険な人気馬の成績は選定の点検用で、購入推奨の回収率ではありません。',
    '- 3着以内率と複勝的中率は異なります。少頭数で複勝が2着払いの場合、3着の複勝払戻は0円です。',
    '- 本文の数値はJSON明細から再計算。現在の開発中ルールは使用していません。', '');
  fs.writeFileSync(path.join(root, `docs/reviews/${outputPrefix}-results.md`), lines.join('\n'));
  console.log(JSON.stringify({ output, raceCount: sources.length, summary, battles }, null, 2));
  process.exit(0);
}
const labels = { specialDetails: '特別レース詳細', allRaceSignals: '全レース一覧', morningSpecialDetails: '朝10時時点の危険馬（別集計）' };
const roles = { leader: '指数1位', value: '注目穴', danger: '危険な人気馬' };
const md = ['# TURF MATRIX 9/20・9/21 集計', '',
  '9/20は24レース、9/21は阪神12レース。各選出馬・各券種100円で計算。',
  '発走前の保存版と当時の選出コードを使用。現在ローカルで修正中の危険馬判定は使っていません。', '',
  '## 日別・合計', '', '| 日付 | 掲載箇所 | 区分 | 対象 | 1着 | 3着以内 | 単勝回収率 | 複勝回収率 |',
  '|---|---|---|---:|---:|---:|---:|---:|'];
for (const s of summary.filter(s => s.scope !== 'morningSpecialDetails')) for (const [role, v] of Object.entries(s.roles)) {
  if (!v.sampleSize) continue;
  md.push(`| ${s.date === 'combined' ? '2日合計' : s.date.slice(5)} | ${labels[s.scope]} | ${roles[role]} | ${v.sampleSize}頭 | ${v.wins} | ${v.topThree} | ${v.winReturnRate.toFixed(1)}% | ${v.placeReturnRate.toFixed(1)}% |`);
}
md.push('', '危険な人気馬の2日合計は9頭中3勝・5頭が3着以内。馬券圏外は4/9頭（44.4%）。買う推奨ではなく、危険判定の反省用成績です。',
  '特別レース詳細の指数1位は同点を全頭集計（神戸新聞杯はロブチェンとコンジェスタス）。全レース一覧は実際に1頭表示された馬のみ。両表は重複するため合算しません。',
  '', '## 勝負レースの実際の買い目', '');
const typeLabel = { win: '単勝', quinella: '馬連', wide: 'ワイド', trio: '3連複' };
for (const b of battles) {
  md.push(`### ${b.date.slice(5)} ${b.race}`, '', `軸：${b.axis.name} ${b.axis.finishPosition}着。`, '',
    ...b.tickets.map(t => `- ${typeLabel[t.type]} ${t.numbers.join('-')}：${t.stake}円 → ${t.payout}円`),
    '', `投資${b.stake}円・払戻${b.payout}円。`, '');
}
md.push(`2日合計：投資${battles.reduce((n, b) => n + b.stake, 0)}円・払戻${battles.reduce((n, b) => n + b.payout, 0)}円（各点100円）。昨日表示されなかったワイドや、今日相手に入っていなかった馬は後付けしていません。`, '',
  '## 特別レースの全選出', '', '| 日付 | レース | 区分 | 馬名 | 指数 | 発走前保存オッズ | 着順 | 単勝払戻 | 複勝払戻 |',
  '|---|---|---|---|---:|---:|---:|---:|---:|');
for (const r of rows.filter(r => r.scope === 'specialDetails')) md.push(`| ${r.date.slice(5)} | ${r.race} | ${roles[r.role]} | ${r.name} | ${r.tmIndex} | ${r.odds} | ${r.finishPosition} | ${r.winPayout}円 | ${r.placePayout}円 |`);
md.push('', '## 全レース一覧の全選出', '', '| 日付 | レース | 区分 | 馬名 | 指数 | 発走前保存オッズ | 着順 | 単勝払戻 | 複勝払戻 |',
  '|---|---|---|---|---:|---:|---:|---:|---:|');
for (const r of rows.filter(r => r.scope === 'allRaceSignals')) md.push(`| ${r.date.slice(5)} | ${r.raceId.split('-').slice(3).join('')} | ${roles[r.role]} | ${r.name} | ${r.tmIndex} | ${r.odds} | ${r.finishPosition} | ${r.winPayout}円 | ${r.placePayout}円 |`);
md.push('', '## 照合メモ', '',
  '- 確定結果・払戻：JV-Link 0B12から36レース493頭分を取得。集計対象の選出馬はすべて馬番・馬名を照合。',
  '- 自動公開は完了ログ時刻、9/21朝は公開確認時刻を使用。それ以外は公開コミット時刻で切り分けており、CDNへ実際に反映された秒単位の時刻は再現できません。',
  '- 9/20阪神10Rは発走14:50後の14:53更新を不採用。14:18の保存版を使用。',
  '- 9/21新涼特別は3連複の相手に勝ち馬14番が含まれず不的中。取得器は3連複払戻に未対応ですが、この不的中判定には確定着順を使用。',
  '- 危険馬の朝10時時点と最終保存版は、今回の9頭について同じ選出。前夜からの変更履歴はJSONへ収録。',
  '- JSONには各レースのコミット、判定時点、入力ハッシュ、全選出明細を保存。push・サイト更新はしていません。', '');
fs.writeFileSync(path.join(root, 'docs/reviews/2026-09-20-21-results.md'), md.join('\n'));
console.log(JSON.stringify({ output, summary, battles, dangerHistory: changes }, null, 2));
