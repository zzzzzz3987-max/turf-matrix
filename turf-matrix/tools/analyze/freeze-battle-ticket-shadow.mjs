#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BATTLE_TICKET_RULE_VERSION,
  BATTLE_TICKET_THRESHOLDS,
  buildBaselineBattleTicketPlan,
  buildBattleTicketPlan,
  sameBattleTicketPlan,
} from "../battle-ticket-selection.mjs";
import { selectBattleRace } from "../battle-race-selection.mjs";
import { buildEngineFingerprint } from "../intelligence/engine-fingerprint.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SOURCE = process.env.TURF_MATRIX_ALL_RACE_SIGNALS_SOURCE
  ? join(ROOT, process.env.TURF_MATRIX_ALL_RACE_SIGNALS_SOURCE)
  : join(ROOT, "tools", "all-race-signals.json");
const SHADOW_DIR = join(ROOT, "data", "shadow", "battle-ticket");
const stableJson = (value) => `${JSON.stringify(value, null, 2)}\n`;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const jstDate = () => new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());

if (!existsSync(SOURCE)) throw new Error(`All-race signals are missing: ${SOURCE}`);
const sourceText = readFileSync(SOURCE, "utf8").replace(/^\uFEFF/, "");
const source = JSON.parse(sourceText);
const raceDate = source.date;
if (!/^\d{4}-\d{2}-\d{2}$/.test(raceDate ?? "")) throw new Error("Race date is missing");
if (raceDate < jstDate()) throw new Error(`Past race data cannot be frozen as a pre-race prediction: ${raceDate}`);
if (!source.engineFingerprint?.id || !source.selectionFingerprint?.id) {
  throw new Error("Engine fingerprints are missing. Regenerate all-race signals before freezing.");
}

const race = selectBattleRace(source.races ?? []);
const baseline = race ? buildBaselineBattleTicketPlan(race) : null;
const shadow = race ? buildBattleTicketPlan(race) : null;
const ticketFingerprint = buildEngineFingerprint({
  root: ROOT,
  entryPoints: ["tools/battle-ticket-selection.mjs"],
});
const predictionPayload = {
  raceDate,
  engineFingerprint: source.engineFingerprint,
  selectionFingerprint: source.selectionFingerprint,
  ticketFingerprint,
  ticketRuleVersion: BATTLE_TICKET_RULE_VERSION,
  race: race ?? null,
  baseline,
  shadow,
};
const artifact = {
  schemaVersion: 1,
  status: "frozen-pre-race-shadow",
  frozenAt: new Date().toISOString(),
  raceDate,
  productionConnected: false,
  policy: {
    resultLeakage: false,
    publicationRule: "公開買い目は現行方式を維持する",
    shadowRule: "単勝・馬連・ワイドを固定基準で個別採否し、該当券種がなければ見送る",
  },
  source: {
    path: "tools/all-race-signals.json",
    sha256: sha256(sourceText),
    engineFingerprint: source.engineFingerprint,
    selectionFingerprint: source.selectionFingerprint,
  },
  ticketFingerprint,
  ticketRuleVersion: BATTLE_TICKET_RULE_VERSION,
  thresholds: BATTLE_TICKET_THRESHOLDS,
  predictionSha256: sha256(stableJson(predictionPayload)),
  race: race ?? null,
  baseline,
  shadow,
};

mkdirSync(SHADOW_DIR, { recursive: true });
const output = join(SHADOW_DIR, `${raceDate}-pre-race.json`);
if (existsSync(output)) {
  const previous = JSON.parse(readFileSync(output, "utf8"));
  if (previous.predictionSha256 !== artifact.predictionSha256) {
    throw new Error(`Frozen battle-ticket shadow already exists with different predictions: ${output}`);
  }
} else {
  writeFileSync(output, stableJson(artifact));
}

console.log(JSON.stringify({
  output,
  raceDate,
  race: race ? `${race.track}${race.number}R ${race.indexTop.name}` : null,
  baselineTickets: baseline?.tickets.length ?? 0,
  shadowStatus: shadow?.status ?? "no-battle-race",
  shadowTickets: shadow?.tickets.map((item) => item.type) ?? [],
  changed: !sameBattleTicketPlan(baseline, shadow),
  predictionSha256: artifact.predictionSha256,
}, null, 2));
