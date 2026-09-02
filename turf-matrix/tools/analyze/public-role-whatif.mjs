#!/usr/bin/env node
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildHorseRiskFlags } from "../../src/lib/public-view-model.js";
import {
  selectPublicDangerHorse,
  selectPublicValueEvidenceHorse,
  selectPublicValueHorse,
} from "../../src/lib/public-role-selection.js";
import { loadFrozenPublicRoleDays } from "./lib/public-role-archive.mjs";
import { summarizePublicRoleRecords } from "./lib/public-role-performance.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const score = (horse) => horse?.aiScore ?? horse?.tmIndex;
const factor = (horse, key) => horse?.analysis?.factorsDetail?.[key]?.score;
const valueData = (horse) => horse?.analysis?.factorsDetail?.value ?? {};

const rankedHorses = (race) => [...(race?.horses ?? [])]
  .filter((horse) => finite(score(horse)))
  .sort((left, right) => score(right) - score(left) || (left.number ?? 999) - (right.number ?? 999))
  .map((horse, index, all) => ({
    horse,
    rank: index + 1,
    score: score(horse),
    leaderGap: score(all[0]) - score(horse),
    marketGap: valueData(horse).marketGap,
    ev: valueData(horse).ev,
    valueEligible: valueData(horse).eligible === true,
    ability: factor(horse, "ability"),
    form: factor(horse, "form"),
    training: factor(horse, "training"),
    pace: factor(horse, "pace"),
    distance: factor(horse, "distance"),
    course: factor(horse, "course"),
    weakest: Math.min(...["ability", "distance", "course", "pace", "trackBias", "load", "training"]
      .map((key) => factor(horse, key))
      .filter(finite)),
    riskCount: buildHorseRiskFlags(horse, { limit: 8 }).length,
  }));

const evidenceScore = (candidate) => {
  const weighted = [
    [candidate.ability, 0.30],
    [candidate.form, 0.25],
    [candidate.training, 0.15],
    [candidate.pace, 0.15],
    [candidate.distance, 0.10],
    [candidate.course, 0.05],
  ].filter(([value]) => finite(value));
  const weight = weighted.reduce((sum, [, itemWeight]) => sum + itemWeight, 0);
  return weight ? weighted.reduce((sum, [value, itemWeight]) => sum + value * itemWeight, 0) / weight : 0;
};

const valueBase = (candidate) => candidate.rank > 2 && candidate.valueEligible && finite(candidate.marketGap) && candidate.marketGap >= 2;
const dangerBase = (candidate) => finite(candidate.horse.popularity) && candidate.horse.popularity <= 4 &&
  candidate.rank - candidate.horse.popularity >= 2;

const VALUE_STRATEGIES = {
  baseline: selectPublicValueHorse,
  index_window: selectPublicValueEvidenceHorse,
  balanced_evidence: (race) => rankedHorses(race)
    .filter((candidate) => valueBase(candidate) && candidate.rank <= 5)
    .filter((candidate) => finite(candidate.ability) && candidate.ability >= 68)
    .filter((candidate) => finite(candidate.form) && candidate.form >= 65)
    .filter((candidate) => [candidate.ability, candidate.form, candidate.training, candidate.pace, candidate.distance]
      .filter((item) => finite(item) && item >= 68).length >= 3)
    .sort((a, b) => evidenceScore(b) - evidenceScore(a) || b.score - a.score || a.horse.number - b.horse.number)[0]?.horse ?? null,
  strong_evidence: (race) => rankedHorses(race)
    .filter((candidate) => valueBase(candidate) && candidate.rank <= 5)
    .filter((candidate) => finite(candidate.ability) && candidate.ability >= 70)
    .filter((candidate) => finite(candidate.form) && candidate.form >= 68)
    .filter((candidate) => evidenceScore(candidate) >= 70)
    .sort((a, b) => evidenceScore(b) - evidenceScore(a) || b.score - a.score || a.horse.number - b.horse.number)[0]?.horse ?? null,
  market_quality: (race) => rankedHorses(race)
    .filter((candidate) => valueBase(candidate) && candidate.rank <= 5)
    .filter((candidate) => candidate.horse.popularity >= 5 && candidate.horse.popularity <= 10)
    .filter((candidate) => finite(candidate.ev) && candidate.ev <= 2.2)
    .filter((candidate) => evidenceScore(candidate) >= 68)
    .sort((a, b) => evidenceScore(b) - evidenceScore(a) || b.score - a.score || a.horse.number - b.horse.number)[0]?.horse ?? null,
};

const DANGER_STRATEGIES = {
  baseline: (race) => rankedHorses(race)
    .filter(dangerBase)
    .sort((a, b) => (b.rank - b.horse.popularity) - (a.rank - a.horse.popularity) ||
      a.horse.popularity - b.horse.popularity || a.horse.number - b.horse.number)[0]?.horse ?? null,
  gap_three: selectPublicDangerHorse,
  clear_weakness: (race) => rankedHorses(race)
    .filter((candidate) => dangerBase(candidate) && finite(candidate.weakest) && candidate.weakest <= 64)
    .sort((a, b) => a.weakest - b.weakest || (b.rank - b.horse.popularity) - (a.rank - a.horse.popularity) ||
      a.horse.number - b.horse.number)[0]?.horse ?? null,
  multi_signal: (race) => rankedHorses(race)
    .filter((candidate) => dangerBase(candidate) && candidate.leaderGap >= 3)
    .filter((candidate) => candidate.riskCount >= 2 || (finite(candidate.weakest) && candidate.weakest <= 66))
    .sort((a, b) => b.riskCount - a.riskCount || b.leaderGap - a.leaderGap ||
      (b.rank - b.horse.popularity) - (a.rank - a.horse.popularity) || a.horse.number - b.horse.number)[0]?.horse ?? null,
  strict_gap: (race) => rankedHorses(race)
    .filter((candidate) => dangerBase(candidate) && candidate.rank - candidate.horse.popularity >= 3)
    .filter((candidate) => candidate.rank >= 5 && candidate.leaderGap >= 4)
    .filter((candidate) => finite(candidate.weakest) && candidate.weakest <= 68)
    .sort((a, b) => a.weakest - b.weakest || b.leaderGap - a.leaderGap || a.horse.number - b.horse.number)[0]?.horse ?? null,
};

const evaluate = (days, strategy) => {
  const records = [];
  for (const { date, snapshot, results } of days) {
    const resultByRace = new Map((results.races ?? []).map((race) => [race.bundleId, race]));
    for (const race of snapshot.races ?? []) {
      const selected = strategy(race);
      const resultRace = resultByRace.get(race.bundleId);
      if (!selected || !resultRace) continue;
      const result = (resultRace.horses ?? []).find((horse) => horse.horseNumber === selected.number);
      if (!finite(result?.finishPosition)) continue;
      const payoutAvailable = finite(result.winPayout) && finite(result.placePayout);
      records.push({
        date,
        raceId: race.bundleId,
        horseName: selected.name,
        finishPosition: result.finishPosition,
        payoutAvailable,
        winPayout: payoutAvailable ? result.winPayout : null,
        placePayout: payoutAvailable ? result.placePayout : null,
      });
    }
  }
  return summarizePublicRoleRecords(records);
};

const days = loadFrozenPublicRoleDays({ root: ROOT }).filter((day) =>
  (day.snapshot.races ?? []).some((race) => (day.results.races ?? []).some((result) => result.bundleId === race.bundleId))
);
const holdoutDates = days.slice(-2).map((day) => day.date);
const trainDays = days.slice(0, -2);
const holdoutDays = days.slice(-2);
const report = (strategies) => Object.fromEntries(Object.entries(strategies).map(([name, strategy]) => [name, {
  train: evaluate(trainDays, strategy),
  holdout: evaluate(holdoutDays, strategy),
  all: evaluate(days, strategy),
}]));

console.log(JSON.stringify({
  trainDates: trainDays.map((day) => day.date),
  holdoutDates,
  value: report(VALUE_STRATEGIES),
  danger: report(DANGER_STRATEGIES),
}, null, 2));
