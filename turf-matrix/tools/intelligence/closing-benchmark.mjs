import { normalizeCourse, raceShapeKey, classifyPaceTilt } from "./race-shape-history.mjs";

const courses = ["", "sapporo", "hakodate", "fukushima", "niigata", "tokyo", "nakayama", "chukyo", "kyoto", "hanshin", "kokura"];
const classGroup = (r) => r.classGroup || (/新馬/.test(r.raceName) ? "maiden-debut" : /未勝利/.test(r.raceName) ? "maiden" : null);

export function buildClosingReferenceFromExports(exports) {
  const races = new Map();
  const horses = new Map();
  for (const data of exports) {
    if (data.schemaVersion < 3) continue;
    for (const race of data.races ?? []) races.set(race.raceKey, race);
    for (const horse of data.horses ?? []) horses.set(`${horse.raceKey}/${horse.horseNumber}`, horse);
  }
  const fields = new Map();
  for (const horse of horses.values()) {
    if (!fields.has(horse.raceKey)) fields.set(horse.raceKey, []);
    fields.get(horse.raceKey).push(horse);
  }
  return [...horses.values()].flatMap((horse) => {
    const race = races.get(horse.raceKey);
    if (!race || Number(race.trackCode) < 11 || Number(race.trackCode) > 29) return [];
    const condition = race.conditionCodes?.[Math.min(3, Number(horse.age) - 2)];
    const cohortClass = condition && condition !== "000" ? `${race.gradeCode || "ungraded"}:${condition}` : null;
    const field = fields.get(horse.raceKey);
    return [{ ...horse, date: date(race.raceDate), horseId: horse.bloodRegistrationNumber,
      course: courses[Number(race.courseCode)], distance: race.distance, trackCode: race.trackCode,
      surface: Number(race.trackCode) < 23 ? "芝" : "ダ",
      going: Number(race.trackCode) < 23 ? race.turfConditionCode : race.dirtConditionCode,
      classGroup: cohortClass, paceClass: classifyPaceTilt(race)?.classification,
      raceLast3F: race.last3F, fieldSize: race.fieldSize,
      completeField: field.length === Number(race.fieldSize) && field.every((h) => h.bloodRegistrationNumber && Number(h.last3F) >= 25 && Number(h.last3F) < 45 && Number(h.age) >= 2),
    }];
  });
}

export function buildClosingReference(summary, shapes) {
  const races = new Map((summary.pastRaces ?? []).map((r) => [r.raceKey, r]));
  const rows = (summary.pastRuns ?? []).flatMap((run) => {
    const race = races.get(run.raceKey);
    if (!race) return [];
    const course = courses[Number(race.courseCode)];
    const shape = shapes.get(raceShapeKey(date(race.raceDate), course, race.raceNo));
    return [{ ...run, date: date(race.raceDate), course, horseId: run.bloodRegistrationNumber,
      distance: race.distance, trackCode: race.trackCode, surface: Number(race.trackCode) < 23 ? "芝" : "ダ",
      going: Number(race.trackCode) < 23 ? race.turfConditionCode : race.dirtConditionCode,
      classGroup: classGroup(race), paceClass: shape?.pace?.classification,
      raceLast3F: shape?.pace?.last3F, fieldSize: race.fieldSize }];
  });
  const fields = new Map();
  for (const row of rows) {
    if (!fields.has(row.raceKey)) fields.set(row.raceKey, new Set());
    fields.get(row.raceKey).add(row.horseId);
  }
  return rows.map((r) => ({ ...r, completeField: fields.get(r.raceKey).size === Number(r.fieldSize) }));
}

export function indexClosingReference(rows) {
  const cohorts = new Map();
  const horseRuns = new Map();
  for (const row of rows) {
    const k = key(row);
    if (k) {
      if (!cohorts.has(k)) cohorts.set(k, []);
      cohorts.get(k).push(row);
    }
    horseRuns.set(JSON.stringify([row.horseId, row.date, normalizeCourse(row.course), Number(row.distance)]), row);
  }
  return { rows, cohorts, horseRuns };
}

export function attachClosingEvidence(horse, reference) {
  const index = Array.isArray(reference) ? indexClosingReference(reference) : reference;
  const horseId = horse.currentRace?.horseId ?? horse.pedigree?.bloodRegistrationNumber;
  return { ...horse, pastRuns: (horse.pastRuns ?? []).map((run) => {
    const row = index.horseRuns.get(JSON.stringify([horseId, date(run.date), normalizeCourse(run.course), Number(run.distance)]));
    const fallback = Number.isFinite(run.last3F) && run.last3F > 0 && run.last3F < 45
      ? Math.max(42, Math.min(94, Math.round(90 - (run.last3F - 33.5) * 7))) : null;
    return { ...run, closingBenchmark: benchmarkClosing(row ?? {}, index.cohorts.get(key(row ?? {})) ?? [], horse.currentRace?.raceDate, fallback) };
  }) };
}

export const CLOSING_POLICY = Object.freeze({ version: "closing-context-v1", minRaces: 20, minDays: 5, priorRaces: 20 });
const num = (v) => v == null || typeof v === "boolean" || String(v).trim() === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null;
const date = (v) => {
  const s = String(v ?? "").replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3");
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s ? s : null;
};
const median = (a) => { const s = [...a].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const key = (r) => {
  if (!r.course || !r.classGroup || !r.paceClass || !r.going || !r.surface || !r.trackCode ||
      !(num(r.distance) > 0) || !(num(r.age) >= 2)) return null;
  return JSON.stringify([normalizeCourse(r.course), r.surface, String(r.trackCode), num(r.distance), num(r.age), r.classGroup, r.going, r.paceClass]);
};
const valid = (r) => date(r.date) && r.raceKey && r.horseId && num(r.last3F) >= 25 && num(r.last3F) < 45 &&
  num(r.raceLast3F) >= 25 && num(r.raceLast3F) < 45 && num(r.finishPosition) > 0 &&
  (r.abnormalityCode == null || String(r.abnormalityCode) === "0");

export function benchmarkClosing(target, reference, cutoff, fallback) {
  const empty = { status: "missing", score: fallback, raceCount: 0, dayCount: 0, policy: CLOSING_POLICY.version };
  const until = date(cutoff);
  const k = key(target);
  if (!until || !valid(target) || !k || date(target.date) >= until) return empty;
  const races = new Map();
  const seen = new Set();
  for (const row of reference) {
    const id = `${row.raceKey}/${row.horseId}`;
    // Only complete-field imports qualify; a selected list of today's opponents is a biased cohort.
    if (!row.completeField || !valid(row) || key(row) !== k || date(row.date) >= until ||
        row.raceKey === target.raceKey || row.horseId === target.horseId || seen.has(id)) continue;
    seen.add(id);
    if (!races.has(row.raceKey)) races.set(row.raceKey, []);
    races.get(row.raceKey).push(row);
  }
  const dayCount = new Set([...races.values()].map((r) => date(r[0].date))).size;
  const count = races.size;
  if (count < CLOSING_POLICY.minRaces || dayCount < CLOSING_POLICY.minDays) return { ...empty, status: "limited", raceCount: count, dayCount };
  // Equal weight per race; compare both absolute closing speed and closing relative to race pace.
  const absolute = [...races.values()].map((rows) => median(rows.map((r) => Number(r.last3F))));
  const relative = [...races.values()].map((rows) => median(rows.map((r) => Number(r.last3F) - Number(r.raceLast3F))));
  const percentile = (values, value) => values.reduce((s, x) => s + (x > value ? 1 : x === value ? 0.5 : 0), 0) / values.length;
  const rank = (percentile(absolute, Number(target.last3F)) + percentile(relative, Number(target.last3F) - Number(target.raceLast3F))) / 2;
  const contextual = 42 + 54 * rank;
  const reliability = count / (count + CLOSING_POLICY.priorRaces);
  return { status: "available", score: Math.round(fallback + (contextual - fallback) * reliability),
    raceCount: count, dayCount, percentile: Math.round(rank * 100), policy: CLOSING_POLICY.version,
    summary: `同条件${count}レースとの比較で、上がりの速さとレース全体に対する末脚を評価。` };
}
