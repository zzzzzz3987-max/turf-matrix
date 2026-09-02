#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  rankPublicRoleHorses,
  selectPublicDangerHorse,
  selectPublicValueEvidenceHorse,
  selectPublicValueHorse,
} from "../../src/lib/public-role-selection.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SOURCE = join(ROOT, "tools", "week-data.json");
const SHADOW_DIR = join(ROOT, "data", "shadow", "public-roles");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
const stableJson = (value) => `${JSON.stringify(value, null, 2)}\n`;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const jstDate = () => new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

const compactHorse = (horse, race) => {
  if (!horse) return null;
  const rank = rankPublicRoleHorses(race).find((candidate) => candidate.horse.id === horse.id)?.rank ?? null;
  return {
    id: horse.id ?? null,
    number: horse.number,
    name: horse.name,
    popularity: horse.popularity ?? null,
    tmIndex: horse.aiScore ?? horse.tmIndex ?? null,
    indexRank: rank,
  };
};

if (!existsSync(SOURCE)) throw new Error(`Race data is missing: ${SOURCE}`);
const sourceText = readFileSync(SOURCE, "utf8").replace(/^\uFEFF/, "");
const source = JSON.parse(sourceText);
const raceDate = source.meta?.date ?? source.races?.[0]?.id?.slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(raceDate ?? "")) throw new Error("Race date is missing");
if (raceDate < jstDate()) {
  throw new Error(`Past race data cannot be frozen as a pre-race prediction: ${raceDate}`);
}

const predictions = (source.races ?? []).map((race) => ({
  raceId: race.id,
  bundleId: race.bundleId,
  track: race.track,
  raceNumber: race.number,
  raceName: race.name,
  scheduledTime: race.time ?? null,
  productionValue: compactHorse(selectPublicValueHorse(race), race),
  evidenceValue: compactHorse(selectPublicValueEvidenceHorse(race), race),
  productionDanger: compactHorse(selectPublicDangerHorse(race), race),
}));
const predictionPayload = {
  raceDate,
  ruleVersion: "public-role-v2",
  valueCandidate: "index-rank-3-to-5-evidence-weighted",
  dangerRule: "top-four-popularity-with-index-gap-three",
  predictions,
};
const artifact = {
  schemaVersion: 1,
  status: "frozen-pre-race-shadow",
  frozenAt: new Date().toISOString(),
  raceDate,
  productionConnected: {
    valueEvidenceV2: false,
    dangerGapThree: true,
  },
  policy: {
    resultLeakage: false,
    valueV2PublicationRule: "公開の注目穴は現行維持。Evidence方式は影で比較する",
    dangerPublicationRule: "4番人気以内かつ人気順位よりTM INDEXが3位以上低い馬",
  },
  source: {
    path: "tools/week-data.json",
    sha256: sha256(sourceText),
    raceCount: source.races?.length ?? 0,
  },
  predictionSha256: sha256(stableJson(predictionPayload)),
  predictions,
};

mkdirSync(SHADOW_DIR, { recursive: true });
const output = join(SHADOW_DIR, `${raceDate}-pre-race.json`);
if (existsSync(output)) {
  const previous = readJson(output);
  if (previous.predictionSha256 !== artifact.predictionSha256) {
    throw new Error(`Frozen public-role shadow already exists with different predictions: ${output}`);
  }
} else {
  writeFileSync(output, stableJson(artifact));
}

console.log(JSON.stringify({
  output,
  raceDate,
  races: predictions.length,
  productionValueCandidates: predictions.filter((row) => row.productionValue).length,
  evidenceValueCandidates: predictions.filter((row) => row.evidenceValue).length,
  changedValueSelections: predictions.filter((row) =>
    row.evidenceValue && row.productionValue?.number !== row.evidenceValue.number
  ).length,
  dangerCandidates: predictions.filter((row) => row.productionDanger).length,
  predictionSha256: artifact.predictionSha256,
}, null, 2));
