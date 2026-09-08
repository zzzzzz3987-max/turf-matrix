import { createHash } from "node:crypto";
import { normalizeCourseSurface } from "../../intelligence/course-ai.mjs";
import { calculateTmIndex } from "../../intelligence/tm-index-engine.mjs";
import { traceIndex } from "../audit-index-contributions.mjs";
import { evaluateFrozenLeaders } from "./frozen-leader-evaluation.mjs";

const clip = (value) => Math.max(45, Math.min(92, value));
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const rank = (horses, key) => [...horses].sort((a, b) => b[key] - a[key] || a.number - b.number);
const checkedDate = (value) => {
  const text = String(value ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error("Invalid race date");
  const time = Date.parse(text + "T00:00:00Z");
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== text) throw new Error("Invalid race date");
  return text;
};

export const createFactorOnlyShadow = ({ factor, label, version, policy, scoreCurrent, scoreCandidate, buildEvidence }) => {
  const buildPrediction = (week) => {
    const raceDate = checkedDate(week?.meta?.date);
    const ids = new Set();
    const predictions = (week.races ?? []).map((race) => {
      const raceId = race.bundleId ?? race.id;
      if (!raceId || ids.has(raceId)) throw new Error("Missing or duplicate race identity");
      ids.add(raceId);
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(race.time ?? "")) throw new Error("Missing or invalid post time");
      const context = race.raceContext ?? race;
      const numbers = new Set();
      const horses = (race.horses ?? []).map((horse) => {
        if (!Number.isInteger(horse.number) || horse.number < 1 || !horse.name || numbers.has(horse.number)) {
          throw new Error("Missing or duplicate horse identity");
        }
        numbers.add(horse.number);
        if (horse.currentRace?.raceDate !== raceDate || !Array.isArray(horse.pastRuns)) throw new Error("Horse race date or past runs unavailable");
        if (horse.currentRace.course !== race.track ||
            normalizeCourseSurface(horse.currentRace.surface) !== normalizeCourseSurface(race.surface)) throw new Error("Horse and race course conditions differ");
        if (horse.pastRuns.some((run) => checkedDate(run.date ?? run.raceDate) >= raceDate)) {
          throw new Error("Past runs contain current or future results");
        }
        const trace = traceIndex(horse, context);
        const scores = Object.fromEntries(horse.analysis.indexContributions.map((row) => [row.key, row.score]));
        if (!trace.rawMatches || !trace.finalMatches || calculateTmIndex(scores, context) !== horse.analysis.rawTmIndex ||
            scoreCurrent(horse) !== scores[factor]) throw new Error(`Baseline replay failed: ${horse.name}`);
        const evidence = buildEvidence(horse);
        const shadowScore = scoreCandidate(horse);
        if (!Number.isFinite(shadowScore)) throw new Error("Invalid candidate score");
        const shadowRaw = calculateTmIndex({ ...scores, [factor]: shadowScore }, context);
        const count = horse.pastRuns.length;
        const sampleFactor = count === 0 ? 0.3 : count === 1 ? 0.5 : count === 2 ? 0.7 : 1;
        if (Math.round(65 + (horse.analysis.rawTmIndex - 65) * sampleFactor) !==
            horse.analysis.rawTmIndex + horse.analysis.sampleAdjustment) throw new Error(`Baseline sample adjustment differs: ${horse.name}`);
        const shadowExperience = Math.round(65 + (shadowRaw - 65) * sampleFactor);
        const shadowTm = clip(shadowExperience + horse.analysis.goingAdjustment + horse.analysis.loadAdjustment + horse.analysis.trackBiasAdjustment);
        return {
          number: horse.number, name: horse.name,
          ["current" + label]: scores[factor], ["shadow" + label]: shadowScore,
          [factor + "Delta"]: shadowScore - scores[factor],
          currentTm: horse.tmIndex, shadowTm, tmDelta: shadowTm - horse.tmIndex,
          currentRaw: horse.analysis.rawTmIndex, shadowRaw,
          unchangedScores: Object.fromEntries(Object.entries(scores).filter(([key]) => key !== factor)),
          evidence,
        };
      });
      if (horses.length < 2) throw new Error("Incomplete race");
      const currentLeader = rank(horses, "currentTm")[0].number;
      const shadowLeader = rank(horses, "shadowTm")[0].number;
      return {
        raceId, date: raceDate, time: race.time, track: race.track, number: race.number, name: race.name,
        currentLeader, shadowLeader, leaderChanged: currentLeader !== shadowLeader, horses,
      };
    });
    if (!predictions.length) throw new Error("No races");
    return { raceDate, predictions };
  };

  const buildArtifact = (week, { now = new Date().toISOString(), prospective = false, modelSha256 } = {}) => {
    const { raceDate, predictions } = buildPrediction(week);
    if (!Number.isFinite(Date.parse(now))) throw new Error("Invalid freeze time");
    if (prospective && predictions.some((race) => Date.parse(now) >= Date.parse(`${raceDate}T${race.time}:00+09:00`))) {
      throw new Error("Pre-race freeze refused: a race has already started");
    }
    const payload = {
      schemaVersion: 1,
      modelVersion: version,
      modelSha256: modelSha256 ?? null,
      inputSha256: hash(week),
      frozenAt: now,
      status: prospective ? "frozen-pre-race" : "retrospective-diagnostic",
      productionConnected: false,
      raceDate,
      policy: { ...policy },
      predictions,
    };
    return { ...payload, predictionSha256: hash(payload) };
  };

  const validateArtifact = (artifact) => {
    const { predictionSha256, ...payload } = artifact;
    if (hash(payload) !== predictionSha256) throw new Error(`${label} prediction hash mismatch`);
    if (artifact.schemaVersion !== 1 || !/^[0-9a-f]{64}$/.test(artifact.modelSha256 ?? "") ||
        !/^[0-9a-f]{64}$/.test(artifact.inputSha256 ?? "")) throw new Error(`Missing ${factor} source fingerprint`);
    if (artifact.modelVersion !== version || artifact.productionConnected !== false) throw new Error(`Invalid ${factor} prediction version or policy`);
    if (Object.entries(policy).some(([key, value]) => artifact.policy?.[key] !== value)) throw new Error(`Invalid ${factor} prediction policy`);
    if (artifact.status !== "frozen-pre-race") throw new Error("Retrospective diagnostics are not prospective evidence");
    if (!Number.isFinite(Date.parse(artifact.frozenAt)) || !artifact.predictions?.length) throw new Error("Invalid freeze time or empty predictions");
    const date = checkedDate(artifact.raceDate);
    for (const race of artifact.predictions) {
      if (race.date !== date || !/^([01]\d|2[0-3]):[0-5]\d$/.test(race.time ?? "") ||
          Date.parse(artifact.frozenAt) >= Date.parse(`${date}T${race.time}:00+09:00`)) {
        throw new Error("Prediction is not strictly before the race");
      }
    }
  };

  const evaluateArtifact = (artifact, results) => {
    validateArtifact(artifact);
    return evaluateFrozenLeaders(artifact, results);
  };
  return { buildPrediction, buildArtifact, validateArtifact, evaluateArtifact };
};
