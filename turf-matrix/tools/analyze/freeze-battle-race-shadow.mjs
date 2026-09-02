#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BATTLE_SHADOW_RULE_VERSION,
  isBattleRaceEligible,
  selectBattleRace,
  selectBattleRaceShadow,
} from "../battle-race-selection.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SOURCE = process.env.TURF_MATRIX_ALL_RACE_SIGNALS_SOURCE
  ? join(ROOT, process.env.TURF_MATRIX_ALL_RACE_SIGNALS_SOURCE)
  : join(ROOT, "tools", "all-race-signals.json");
const SHADOW_DIR = join(ROOT, "data", "shadow", "battle-race");
const stableJson = (value) => `${JSON.stringify(value, null, 2)}\n`;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const jstDate = () => new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

const compactHorse = (horse) => horse ? {
  number: horse.number,
  name: horse.name,
  tmIndex: horse.tmIndex,
  selectionScore: horse.selectionScore ?? null,
} : null;

const compactSelection = (race, date) => race ? {
  date,
  raceId: race.id,
  bundleId: race.bundleId,
  track: race.track,
  raceNumber: race.number,
  raceName: race.name,
  scheduledTime: race.time ?? null,
  axis: compactHorse(race.indexTop),
  opponents: (race.opponents ?? []).slice(0, 2).map(compactHorse),
  indexGap: race.indexGap,
  battleProfile: race.battleProfile,
} : null;

if (!existsSync(SOURCE)) throw new Error(`All-race signals are missing: ${SOURCE}`);
const sourceText = readFileSync(SOURCE, "utf8").replace(/^\uFEFF/, "");
const source = JSON.parse(sourceText);
const raceDate = source.date;
if (!/^\d{4}-\d{2}-\d{2}$/.test(raceDate ?? "")) throw new Error("Race date is missing");
if (raceDate < jstDate()) {
  throw new Error(`Past race data cannot be frozen as a pre-race prediction: ${raceDate}`);
}
if (!source.engineFingerprint?.id || !source.selectionFingerprint?.id) {
  throw new Error("Engine fingerprints are missing. Regenerate all-race signals before freezing.");
}

const baseline = compactSelection(selectBattleRace(source.races ?? []), raceDate);
const shadow = compactSelection(selectBattleRaceShadow(source.races ?? []), raceDate);
const candidates = (source.races ?? [])
  .filter(isBattleRaceEligible)
  .map((race) => compactSelection(race, raceDate));
const predictionPayload = {
  raceDate,
  engineFingerprint: source.engineFingerprint,
  selectionFingerprint: source.selectionFingerprint,
  shadowRuleVersion: BATTLE_SHADOW_RULE_VERSION,
  baseline,
  shadow,
  candidates,
};
const artifact = {
  schemaVersion: 1,
  status: "frozen-pre-race-shadow",
  frozenAt: new Date().toISOString(),
  raceDate,
  productionConnected: false,
  policy: {
    resultLeakage: false,
    publicationRule: "公開の勝負レースは現行方式を維持する",
    shadowRule: "現行の適格候補を軸・条件・相手の総合Battle Readinessで並べ替える",
  },
  source: {
    path: "tools/all-race-signals.json",
    sha256: sha256(sourceText),
    raceCount: source.raceCount ?? source.races?.length ?? 0,
    engineFingerprint: source.engineFingerprint,
    selectionFingerprint: source.selectionFingerprint,
  },
  shadowRuleVersion: BATTLE_SHADOW_RULE_VERSION,
  predictionSha256: sha256(stableJson(predictionPayload)),
  baseline,
  shadow,
  candidates,
};

mkdirSync(SHADOW_DIR, { recursive: true });
const output = join(SHADOW_DIR, `${raceDate}-pre-race.json`);
if (existsSync(output)) {
  const previous = JSON.parse(readFileSync(output, "utf8"));
  if (previous.predictionSha256 !== artifact.predictionSha256) {
    throw new Error(`Frozen battle-race shadow already exists with different predictions: ${output}`);
  }
} else {
  writeFileSync(output, stableJson(artifact));
}

console.log(JSON.stringify({
  output,
  raceDate,
  engineFingerprint: source.engineFingerprint.id,
  eligibleCandidates: candidates.length,
  baseline: baseline ? `${baseline.track}${baseline.raceNumber}R ${baseline.axis.name}` : null,
  shadow: shadow ? `${shadow.track}${shadow.raceNumber}R ${shadow.axis.name}` : null,
  changed: baseline?.raceId !== shadow?.raceId,
  predictionSha256: artifact.predictionSha256,
}, null, 2));
