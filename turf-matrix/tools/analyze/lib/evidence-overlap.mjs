import { calculateAbilityProfile, selectAbilityRuns } from "../../intelligence/ability-ai.mjs";
import { scoreRecentForm, selectRecentFormRuns, buildRecentFormWeightEvidence } from "../../intelligence/form-ai.mjs";
import { buildDistanceProfile, selectDistanceRuns } from "../../intelligence/distance-ai.mjs";
import { enrichPeerRuns } from "../../intelligence/peer-run-enrichment.mjs";
import { calculateTmIndex, weightsFor } from "../../intelligence/tm-index-engine.mjs";
import { traceIndex } from "../audit-index-contributions.mjs";

export const OVERLAP_VERSION = "direct-distance-overlap-diagnostic-v1";
const keys = ["ability", "form", "distance"];
const variants = ["abilityOnly", "formOnly", "both"];
const round = (value) => Math.round(value * 10000) / 10000;
const clip = (value) => Math.max(45, Math.min(92, value));
const ranking = (horses, score) => [...horses].sort((a, b) => score(b) - score(a) || a.number - b.number);
const checkedDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? "")) throw new Error("Invalid evidence date");
  const parsed = new Date(value + "T00:00:00Z");
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error("Invalid evidence date");
  return value;
};

export const restorePublishedPeerInputs = (race) => {
  const normalized = race.horses.map((horse) => ({ ...horse,
    horseName: horse.name, horseNumber: horse.number, odds: horse.oddsDetail ?? horse.odds,
  }));
  const restored = enrichPeerRuns(normalized);
  return normalized.map((horse, i) => {
    if (horse.analysis?.factorsDetail?.ability?.inputs?.opponentQuality && !horse.opponentEvidence) {
      throw new Error(`Missing frozen opponent evidence: ${horse.name}`);
    }
    return { ...horse, peerRuns: horse.peerRuns ?? restored[i].peerRuns };
  });
};

export const diagnoseEvidenceOverlap = (week) => {
  const raceDate = checkedDate(week?.meta?.date);
  const ids = new Set();
  const races = (week.races ?? []).map((race) => {
    const raceId = race.bundleId ?? race.id;
    if (!raceId || ids.has(raceId)) throw new Error("Missing or duplicate race identity");
    ids.add(raceId);
    const context = race.raceContext ?? race;
    const numbers = new Set();
    const horses = restorePublishedPeerInputs(race).map((horse) => {
      if (!horse.name || !Number.isInteger(horse.number) || horse.number < 1 || numbers.has(horse.number)) throw new Error("Invalid horse identity");
      numbers.add(horse.number);
      if (horse.currentRace?.raceDate !== raceDate || !Array.isArray(horse.pastRuns)) throw new Error("Invalid horse race date or history");
      const dates = horse.pastRuns.map((run) => checkedDate(run.date ?? run.raceDate));
      if (dates.some((date, i) => date >= raceDate || (i > 0 && date > dates[i - 1]))) throw new Error("Past runs must precede target date and be newest first");
      const scores = Object.fromEntries((horse.analysis.indexContributions ?? []).map((entry) => [entry.key, entry.score]));
      const ability = calculateAbilityProfile(horse);
      const recomputed = { ability: ability.score, form: scoreRecentForm(horse), distance: buildDistanceProfile(horse).score };
      const trace = traceIndex(horse, context);
      if (!trace.rawMatches || !trace.finalMatches || calculateTmIndex(scores, context) !== horse.analysis.rawTmIndex ||
          keys.some((key) => !Number.isFinite(scores[key]) || scores[key] !== recomputed[key])) {
        throw new Error(`Baseline replay failed: ${horse.name}`);
      }
      const count = horse.pastRuns.length;
      const sampleFactor = count === 0 ? 0.3 : count === 1 ? 0.5 : count === 2 ? 0.7 : 1;
      const sample = (raw) => Math.round(65 + (raw - 65) * sampleFactor);
      if (sample(horse.analysis.rawTmIndex) !== horse.analysis.rawTmIndex + horse.analysis.sampleAdjustment) throw new Error("Baseline sample policy differs");
      const weights = weightsFor(context);
      const availableWeight = Object.entries(weights).reduce((sum, [key, weight]) => sum + (Number.isFinite(scores[key]) ? weight : 0), 0);
      const noDistanceAbility = calculateAbilityProfile(horse, { includeDistanceFit: false }).score;
      const noDistanceForm = scoreRecentForm(horse, { includeDistanceFit: false });
      const candidates = Object.fromEntries(variants.map((variant) => {
        const changed = {
          ability: variant === "formOnly" ? scores.ability : noDistanceAbility,
          form: variant === "abilityOnly" ? scores.form : noDistanceForm,
        };
        const raw = calculateTmIndex({ ...scores, ...changed }, context);
        const tm = clip(sample(raw) + horse.analysis.goingAdjustment + horse.analysis.loadAdjustment + horse.analysis.trackBiasAdjustment);
        // These factors are not dispersion-calibrated. The raw contribution change precedes rounding and clipping.
        const weightedDelta = ((changed.ability - scores.ability) * weights.ability + (changed.form - scores.form) * weights.form) / availableWeight;
        return [variant, { ...changed, raw, tm, tmDelta: tm - horse.tmIndex, weightedDelta: round(weightedDelta) }];
      }));
      const abilityRuns = new Set(selectAbilityRuns(horse));
      const formGroups = selectRecentFormRuns(horse);
      const formRuns = new Set([...formGroups.central, ...formGroups.local]);
      const distanceRuns = new Set(selectDistanceRuns(horse));
      const formEvidence = buildRecentFormWeightEvidence(horse);
      const formBonus = new Map(Object.entries(formGroups).flatMap(([origin, runs]) =>
        runs.map((run, i) => [run, formEvidence[origin].runs[i].distanceFitBonus])));
      const runUsage = horse.pastRuns.map((run, index) => ({
        index, date: dates[index], course: run.course, raceName: run.raceName ?? null,
        surface: run.surface, distance: run.distance, finish: run.finishPosition, margin: run.margin ?? null,
        targetDistanceGap: Number.isFinite(Number(run.distance)) && Number.isFinite(Number(horse.currentRace.distance))
          ? Math.abs(Number(run.distance) - Number(horse.currentRace.distance)) : null,
        factors: [abilityRuns.has(run) ? "ability" : null, formRuns.has(run) ? "form" : null, distanceRuns.has(run) ? "distance" : null].filter(Boolean),
        directFormDistanceBonus: formBonus.get(run) ?? null,
      })).filter((run) => run.factors.length);
      return {
        number: horse.number, name: horse.name, currentTm: horse.tmIndex, scores, candidates,
        currentRaw: horse.analysis.rawTmIndex,
        effectiveWeights: Object.fromEntries(keys.map((key) => [key, round(weights[key] / availableWeight)])),
        tripleSharedRuns: runUsage.filter((run) => run.factors.length === 3).length,
        nearDistanceTripleRuns: runUsage.filter((run) => run.factors.length === 3 && run.targetDistanceGap != null && run.targetDistanceGap <= 200).length,
        relationFallbackToRecent: [ability.opponentScore, ability.peerScore, ability.encounterScore, ability.careerOpponentScore].every((score) => score == null),
        peerRunCount: horse.peerRuns.length,
        runUsage,
      };
    });
    if (horses.length < 2) throw new Error("Incomplete race");
    const ranked = ranking(horses, (horse) => horse.currentTm);
    const leader = ranked[0];
    const comparisons = Object.fromEntries(variants.map((variant) => {
      const candidates = ranking(horses, (horse) => horse.candidates[variant].tm);
      return [variant, {
        currentLeader: leader.number, candidateLeader: candidates[0].number,
        currentTiedLeaders: ranked.filter((horse) => horse.currentTm === leader.currentTm).map((horse) => horse.number),
        candidateTiedLeaders: candidates.filter((horse) => horse.candidates[variant].tm === candidates[0].candidates[variant].tm).map((horse) => horse.number),
        leaderChanged: leader.number !== candidates[0].number,
        rankChanges: ranked.filter((horse, i) => candidates[i].number !== horse.number).length,
      }];
    }));
    return { raceId, track: race.track, number: race.number, name: race.name, comparisons, horses };
  });
  if (!races.length) throw new Error("No races");
  const horses = races.flatMap((race) => race.horses);
  return {
    schemaVersion: 1, modelVersion: OVERLAP_VERSION, raceDate,
    status: "retrospective-diagnostic", productionConnected: false, prospectiveEvidence: false,
    policy: { resultsRead: false, weightsChanged: false, distanceFactorChanged: false,
      formNormalizationApplied: false, courseSurfaceCandidateApplied: false, automaticAdoption: false },
    summary: {
      races: races.length, horses: horses.length, replayed: horses.length,
      horsesWithTripleSharedRuns: horses.filter((horse) => horse.tripleSharedRuns > 0).length,
      tripleSharedRuns: horses.reduce((sum, horse) => sum + horse.tripleSharedRuns, 0),
      nearDistanceTripleRuns: horses.reduce((sum, horse) => sum + horse.nearDistanceTripleRuns, 0),
      relationFallbackHorses: horses.filter((horse) => horse.relationFallbackToRecent).length,
      candidates: Object.fromEntries(variants.map((variant) => [variant, {
        abilityChanged: horses.filter((horse) => horse.candidates[variant].ability !== horse.scores.ability).length,
        formChanged: horses.filter((horse) => horse.candidates[variant].form !== horse.scores.form).length,
        tmChanged: horses.filter((horse) => horse.candidates[variant].tmDelta !== 0).length,
        tmDeltaRange: [Math.min(...horses.map((horse) => horse.candidates[variant].tmDelta)), Math.max(...horses.map((horse) => horse.candidates[variant].tmDelta))],
        leadersChanged: races.filter((race) => race.comparisons[variant].leaderChanged).length,
      }])),
    }, races,
  };
};
