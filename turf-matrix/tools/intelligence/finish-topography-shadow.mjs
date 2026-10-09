const source = venue => `https://www.jra.go.jp/facilities/race/${venue}/course/`;
// Separate the finish straight from relief around the rest of the course.
// Turf only: dirt and unverified routes deliberately remain unsupported.
const TURF_TOPOGRAPHY = {
  京都: { finishStraight: 'flat', enRouteRelief: 'third-corner-hill', source: source('kyoto') },
  新潟: { finishStraight: 'flat', enRouteRelief: 'route-dependent', source: source('niigata') },
  小倉: { finishStraight: 'flat', enRouteRelief: 'second-corner-hill', source: source('kokura') },
  札幌: { finishStraight: 'flat', enRouteRelief: 'mostly-flat', source: source('sapporo') },
  東京: { finishStraight: 'uphill', enRouteRelief: 'undulating', source: source('tokyo') },
  阪神: { finishStraight: 'uphill', enRouteRelief: 'route-dependent', source: source('hanshin') },
  中山: { finishStraight: 'uphill', enRouteRelief: 'undulating', source: source('nakayama') },
  中京: { finishStraight: 'uphill', enRouteRelief: 'backstretch-rise-and-descent', source: source('chukyo') },
  福島: { finishStraight: 'uphill', enRouteRelief: 'repeated-undulation', source: source('fukushima') },
};
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const mean = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const rounded = value => value == null ? null : Math.round(value * 1000) / 1000;
const gradeGroup = run => {
  const text = `${run.grade ?? ''} ${run.raceName ?? ''}`.normalize('NFKC');
  const grade = text.match(/G([123])/i);
  return grade ? `G${grade[1]}` : /ステークス|\(L\)|オープン|OP/.test(text) ? 'open' : 'unknown';
};
const goingGroup = run => {
  const going = run.trackCondition ?? run.going;
  return going === '良' ? 'good' : ['稍重', '重', '不良'].includes(going) ? 'wet' : 'unknown';
};
const resolveFinishTopography = race => {
  if (race?.surface !== '芝' || !finite(race.distance) || race.distance < 1000 || race.distance > 3600) return null;
  const course = race.course ?? race.track;
  // Straight 1000m is not comparable with a cornered race's finish straight.
  if (course === '新潟' && race.distance === 1000) return null;
  const profile = TURF_TOPOGRAPHY[course];
  return profile ? { ...profile, course, scope: 'turf-finish-straight', verifiedAt: '2026-10-07' } : null;
};
const statistics = rows => ({
  runs: rows.length,
  wins: rows.filter(r => r.finishPosition === 1).length,
  topThree: rows.filter(r => r.finishPosition <= 3).length,
  topThreeRate: rounded(mean(rows.map(r => Number(r.finishPosition <= 3)))),
  meanMargin: rounded(mean(rows.filter(r => finite(r.margin) && r.margin >= 0).map(r => r.margin))),
  marginRuns: rows.filter(r => finite(r.margin) && r.margin >= 0).length,
  venues: [...new Set(rows.map(r => r.course))],
});

const buildFinishTopographyShadow = (horse, { asOf, distanceWindow = 200 } = {}) => {
  if (!validDate(asOf)) throw new Error('A valid asOf date is required');
  if (!finite(distanceWindow) || distanceWindow < 0 || distanceWindow > 400) throw new Error('Invalid distance window');
  const target = horse.currentRace ?? {};
  const profile = resolveFinishTopography(target);
  const excluded = {};
  const reject = reason => { excluded[reason] = (excluded[reason] ?? 0) + 1; };
  const seen = new Set();
  const rows = [];
  for (const run of horse.pastRuns ?? []) {
    const date = run.date ?? run.raceDate;
    if (!validDate(date)) { reject('undated'); continue; }
    if (date >= asOf) { reject('not-before-asOf'); continue; }
    if (run.surface !== target.surface) { reject('surface'); continue; }
    if (!finite(run.distance) || !finite(target.distance) || Math.abs(run.distance - target.distance) > distanceWindow) {
      reject('distance'); continue;
    }
    if (!Number.isInteger(run.finishPosition) || run.finishPosition < 1 ||
      (finite(run.fieldSize) && run.finishPosition > run.fieldSize) ||
      (run.abnormalityCode != null && !['0', '00', ''].includes(String(run.abnormalityCode)))) {
      reject('invalid-result'); continue;
    }
    const topology = resolveFinishTopography(run);
    if (!topology) { reject('unsupported-topography'); continue; }
    const identity = `${date}|${run.course}|${run.raceNumber ?? run.raceNo ?? run.raceName ?? run.distance}`;
    if (seen.has(identity)) { reject('duplicate'); continue; }
    seen.add(identity);
    rows.push({ date, course: run.course, distance: run.distance, race: run.raceName ?? null,
      finishPosition: run.finishPosition, margin: finite(run.margin) ? run.margin : null,
      carriedWeight: finite(run.carriedWeight) ? run.carriedWeight : null,
      gradeGroup: gradeGroup(run), goingGroup: goingGroup(run), ...topology });
  }
  const flat = rows.filter(r => r.finishStraight === 'flat');
  const uphill = rows.filter(r => r.finishStraight === 'uphill');
  // Exact distance / grade / going overlap limits obvious cross-condition comparisons.
  // This is descriptive evidence, not a causal hill effect or an index adjustment.
  const strata = new Map();
  for (const row of rows) {
    if (row.gradeGroup === 'unknown' || row.goingGroup === 'unknown') continue;
    const key = `${row.distance}|${row.gradeGroup}|${row.goingGroup}`;
    if (!strata.has(key)) strata.set(key, { flat: [], uphill: [] });
    strata.get(key)[row.finishStraight].push(row);
  }
  const shared = [...strata.entries()].filter(([, s]) => s.flat.length && s.uphill.length);
  const matchedFlat = shared.flatMap(([, s]) => s.flat);
  const matchedUphill = shared.flatMap(([, s]) => s.uphill);
  const comparable = matchedFlat.length >= 3 && matchedUphill.length >= 3;
  const status = !profile ? 'unsupported' : !rows.length ? 'missing' : comparable ? 'descriptive-comparison' : 'limited';
  const targetRuns = rows.filter(r => r.course === target.course && r.distance === target.distance);
  const summary = !profile ? 'この条件の直線勾配は未確認です。' :
    `直線平坦は${flat.length}走で3着以内${statistics(flat).topThree}回、坂ありは${uphill.length}走で3着以内${statistics(uphill).topThree}回。` +
    (comparable ? '条件が重なる実績を比較できますが、坂だけの効果とは断定できません。' : '比較条件が揃うデータ不足のため、得意・不得意は判断保留です。');
  return { policy: 'finish-topography-shadow-v1', shadow: true, scoreConnected: false, indexAdjustment: 0,
    asOf, status, target: profile, distanceWindow, flat: statistics(flat), uphill: statistics(uphill),
    directCondition: statistics(targetRuns), matched: { flat: statistics(matchedFlat), uphill: statistics(matchedUphill),
      strata: shared.map(([key]) => key), comparable },
    excluded, evidence: rows, summary,
    caveats: ['相手の能力、斤量、展開、馬場、成長・休養の差は残ります。',
      '世代限定戦と古馬混合戦の分離は未実装です。', '直線の長さや内外回りも別条件です。',
      '着差は符号の異なる勝ち馬記録を除き、取得できた非負値だけを集計します。'],
  };
};

export { TURF_TOPOGRAPHY, resolveFinishTopography, buildFinishTopographyShadow };
