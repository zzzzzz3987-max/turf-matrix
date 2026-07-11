#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const NORMALIZED_PATH = join(SCRIPT_DIR, "week-data.normalized.json");
const OUT_PATH = join(SCRIPT_DIR, "week-data.candidate.json");

const normalizeHorseKey = (value) =>
  String(value ?? "")
    .normalize("NFKC")
    .replace(/\u3000/g, " ")
    .replace(/\s+/g, "")
    .trim();

const hasInvalidNumber = (value) => typeof value === "number" && !Number.isFinite(value);

const findInvalidNumbers = (value, path = "$", errors = []) => {
  if (hasInvalidNumber(value)) errors.push(path);
  if (Array.isArray(value)) {
    value.forEach((item, index) => findInvalidNumbers(item, `${path}[${index}]`, errors));
  } else if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, item]) => findInvalidNumbers(item, `${path}.${key}`, errors));
  }
  return errors;
};

const duplicates = (values) => {
  const seen = new Set();
  const duplicated = new Set();
  for (const value of values) {
    if (value == null || value === "") continue;
    if (seen.has(value)) duplicated.add(value);
    seen.add(value);
  }
  return [...duplicated];
};

const buildCandidate = (normalized) => {
  const runners = normalized.horses.map((horse) => {
    const currentRace = horse.currentRace;
    return {
      id: currentRace.raceEntryId,
      number: currentRace.horseNumber,
      name: currentRace.horseName,
      sex: currentRace.sex,
      age: currentRace.age,
      sexAge: currentRace.sexAge,
      jockey: currentRace.jockey,
      carriedWeight: currentRace.carriedWeight,
      trainer: currentRace.trainer,
      stableSide: currentRace.stableSide,
      owner: currentRace.owner,
      breeder: currentRace.breeder,
      coatColor: currentRace.coatColor,
      odds: horse.odds?.winOdds ?? null,
      popularity: horse.odds?.popularity ?? null,
      oddsDetail: horse.odds ?? null,
      tmIndex: null,
      tmValue: null,
      currentRace,
      pastRuns: horse.pastRuns,
      training: horse.training,
      pedigree: horse.pedigree,
      dataStatus: {
        currentRace: "active",
        pastRuns: horse.pastRuns?.length ? "active" : "missing",
        training: horse.missing.includes("training") ? "missing" : "active",
        pedigree: horse.missing.includes("pedigree") ? "missing" : "active",
        odds: horse.odds ? "active" : "missing",
        intelligence: "not_connected",
      },
    };
  });

  const race = normalized.source.currentRaceDetail.race;
  const oddsStatus = runners.every((horse) => horse.dataStatus.odds === "active") ? "active" : "partial";
  return {
    schemaVersion: 1,
    mode: "candidate",
    deterministicOutput: true,
    generatedAt: null,
    productionWeekDataUpdated: false,
    intelligenceLayerConnected: false,
    uiConnected: false,
    meta: {
      date: race.raceDate,
      dateLabel: race.raceDate,
      venue: race.course,
      dataStatus: "odds-ready",
      source: "target-frontier-jv-current-race-detail",
      featuredRaceId: `${race.raceDate}-${race.course}-${race.raceNo}R`,
      oddsUpdatedAt: normalized.source.odds?.updatedAt ?? null,
      oddsStatus,
    },
    races: [
      {
        id: `${race.raceDate}-${race.course}-${race.raceNo}R`,
        track: race.course,
        number: race.raceNo,
        name: race.raceName,
        nameRaw: race.raceNameRaw,
        grade: race.grade,
        time: null,
        surface: race.surface,
        distance: race.distance,
        going: null,
        fieldSize: race.fieldSize,
        oddsUpdatedAt: normalized.source.odds?.updatedAt ?? null,
        oddsStatus,
        oddsSource: normalized.source.odds?.source ?? null,
        dataStatus: {
          currentRace: "active",
          pastRuns: "active",
          odds: oddsStatus,
          intelligence: "not_connected",
        },
        horses: runners,
      },
    ],
    join: normalized.join,
    source: normalized.source,
  };
};

const validateCandidate = (candidate) => {
  const errors = [];
  const race = candidate.races?.[0];
  const horses = race?.horses ?? [];

  if (!race) errors.push("race is missing");
  if (horses.length !== 16) errors.push(`runners must be 16 but got ${horses.length}`);
  if (candidate.meta?.date !== "2026-07-12") errors.push(`meta.date mismatch: ${candidate.meta?.date}`);
  if (race?.track !== candidate.meta?.venue) errors.push(`track mismatch: ${race?.track}`);
  if (race?.number !== 11) errors.push(`race number mismatch: ${race?.number}`);
  if (race?.grade !== "G3") errors.push(`grade mismatch: ${race?.grade}`);
  if (!race?.surface) errors.push("surface is missing");
  if (race?.distance !== 2000) errors.push(`distance mismatch: ${race?.distance}`);

  const horseNumbers = horses.map((horse) => horse.number);
  const expected = Array.from({ length: 16 }, (_, index) => index + 1);
  if (horseNumbers.some((number, index) => number !== expected[index])) {
    errors.push(`horse numbers must be 1-16: ${horseNumbers.join(", ")}`);
  }

  const duplicateHorseNumbers = duplicates(horseNumbers);
  const duplicateHorseNames = duplicates(horses.map((horse) => normalizeHorseKey(horse.name)));
  const duplicateRaceEntryIds = duplicates(horses.map((horse) => horse.id));
  if (duplicateHorseNumbers.length) errors.push(`duplicate horse numbers: ${duplicateHorseNumbers.join(", ")}`);
  if (duplicateHorseNames.length) errors.push(`duplicate horse names: ${duplicateHorseNames.join(", ")}`);
  if (duplicateRaceEntryIds.length) errors.push(`duplicate raceEntryIds: ${duplicateRaceEntryIds.join(", ")}`);

  const pastRunCount = horses.reduce((sum, horse) => sum + (horse.pastRuns?.length ?? 0), 0);
  if (pastRunCount !== 311) errors.push(`pastRuns total must be 311 but got ${pastRunCount}`);

  const oddsJoinCount = horses.filter((horse) => horse.odds != null && horse.popularity != null).length;
  if (oddsJoinCount !== 16) errors.push(`odds join must be 16 but got ${oddsJoinCount}`);
  const invalidOdds = horses.filter((horse) => horse.odds != null && horse.odds <= 0);
  if (invalidOdds.length) errors.push(`invalid odds: ${invalidOdds.map((horse) => horse.name).join(", ")}`);

  const missingCurrentRace = horses.filter((horse) => !horse.currentRace?.raceEntryId);
  if (missingCurrentRace.length) errors.push(`currentRace missing: ${missingCurrentRace.map((horse) => horse.name).join(", ")}`);

  const invalidNumbers = findInvalidNumbers(candidate);
  if (invalidNumbers.length) errors.push(`invalid numeric values: ${invalidNumbers.join(", ")}`);

  return {
    errors,
    summary: {
      runners: horses.length,
      horseNumberCount: horseNumbers.length,
      jockeyCount: horses.filter((horse) => horse.jockey).length,
      carriedWeightCount: horses.filter((horse) => horse.carriedWeight != null).length,
      trainerCount: horses.filter((horse) => horse.trainer).length,
      pastRunCount,
      pedigreeJoinCount: horses.filter((horse) => horse.dataStatus.pedigree === "active").length,
      trainingSuccessCount: horses.filter((horse) => horse.dataStatus.training === "active").length,
      trainingPartialCount: horses.filter((horse) => horse.dataStatus.training === "missing").length,
      oddsJoinCount,
      duplicateHorseNumberCount: duplicateHorseNumbers.length,
      duplicateHorseNameCount: duplicateHorseNames.length,
      duplicateRaceEntryIdCount: duplicateRaceEntryIds.length,
    },
  };
};

const normalized = JSON.parse(readFileSync(NORMALIZED_PATH, "utf8"));
const candidate = buildCandidate(normalized);
const validation = validateCandidate(candidate);

if (validation.errors.length) {
  validation.errors.forEach((error) => console.error(`[ERROR] ${error}`));
  process.exit(1);
}

const json = JSON.stringify(candidate, null, 2) + "\n";
writeFileSync(OUT_PATH, json);

console.log(
  JSON.stringify(
    {
      out: OUT_PATH,
      sha256: createHash("sha256").update(json).digest("hex"),
      summary: validation.summary,
    },
    null,
    2
  )
);
