import { existsSync } from "node:fs";
import * as allCsvParser from "../parsers/all-csv-parser.mjs";
import * as basicTxtParser from "../parsers/basic-txt-parser.mjs";
import * as currentRaceParser from "../parsers/current-race-detail-parser.mjs";
import * as oddsParser from "../parsers/odds-csv-parser.mjs";
import * as pedigreeParser from "../parsers/pedigree-html-parser.mjs";
import * as trainingSlopeParser from "../parsers/training-slope-html-parser.mjs";
import * as trainingWoodParser from "../parsers/training-wood-html-parser.mjs";
import { resolveFromRepo } from "../parsers/parser-contract.mjs";

const normalizeHorseKey = (value) =>
  String(value ?? "").normalize("NFKC").replace(/[＊*$]/g, "").replace(/\u3000/g, " ").replace(/\s+/g, "").trim();

const mapByHorse = (records) =>
  new Map(records.map((record) => [normalizeHorseKey(record.horseName), record]).filter(([key]) => key));

const uniqueMapByHorse = (records, label) => {
  const mapped = new Map();
  for (const record of records) {
    const key = normalizeHorseKey(record.horseName);
    if (!key) continue;
    if (mapped.has(key)) throw new Error(`${label}: duplicate normalized horse name ${record.horseName}`);
    mapped.set(key, record);
  }
  return mapped;
};

const finalRaceEntryId = (raceEntryId, horseNumber) => {
  const raw = String(raceEntryId ?? "").trim();
  if (!raw || !Number.isFinite(horseNumber)) return raceEntryId ?? null;
  return `${raw.slice(0, -2)}${String(horseNumber).padStart(2, "0")}`;
};

const groupByHorse = (records) => {
  const grouped = new Map();
  for (const record of records) {
    const key = normalizeHorseKey(record.horseName);
    if (!key) continue;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(record);
  }
  return grouped;
};

const optionalParse = (parser, path, fallback) =>
  existsSync(resolveFromRepo(path)) ? parser.parse({ path }) : fallback;

const normalizeRaceBundle = ({ bundleId, csv, html }) => {
  const current = currentRaceParser.parse({ path: csv.currentRace });
  const all = allCsvParser.parse({ path: csv.all });
  const basic = optionalParse(basicTxtParser, csv.basic, {
    recordCount: 0,
    ziCount: 0,
    records: [],
    ziRecords: [],
    warnings: [],
  });
  const odds = optionalParse(oddsParser, csv.odds, {
    rowCount: 0,
    entryCount: 0,
    updatedAt: null,
    source: "odds.csv",
    status: "missing",
    entries: [],
  });
  if (odds.entries.length && odds.entries.length !== current.entryCount) {
    throw new Error(`${bundleId}: odds entries ${odds.entries.length} do not match runners ${current.entryCount}`);
  }

  const slope = optionalParse(trainingSlopeParser, html.trainingSlope, { rowCount: 0, records: [] });
  const wood = optionalParse(trainingWoodParser, html.trainingWood, { rowCount: 0, records: [] });
  const pedigree = pedigreeParser.parse({ path: html.pedigree });

  const allByHorse = mapByHorse(all.horses);
  const currentByHorse = uniqueMapByHorse(current.entries, `${bundleId}/currentRace`);
  const oddsByHorse = uniqueMapByHorse(odds.entries, `${bundleId}/odds`);
  if (odds.entries.length) {
    const missingOddsNames = current.entries
      .filter((entry) => !oddsByHorse.has(normalizeHorseKey(entry.horseName)))
      .map((entry) => entry.horseName);
    const unexpectedOddsNames = odds.entries
      .filter((entry) => !currentByHorse.has(normalizeHorseKey(entry.horseName)))
      .map((entry) => entry.horseName);
    if (missingOddsNames.length || unexpectedOddsNames.length) {
      throw new Error(
        `${bundleId}: odds/current runner names do not match. ` +
        `missing odds=[${missingOddsNames.join(", ")}], unexpected odds=[${unexpectedOddsNames.join(", ")}]`,
      );
    }
  }
  const slopeByHorse = groupByHorse(slope.records);
  const woodByHorse = groupByHorse(wood.records);
  const pedigreeByHorse = mapByHorse(pedigree.records);
  const basicByNumber = new Map(basic.records.map((record) => [record.horseNumber, record]));
  const failures = [];

  const horses = current.entries.map((entry) => {
    const key = normalizeHorseKey(entry.horseName);
    const allRecord = allByHorse.get(key) ?? null;
    const oddsEntry = oddsByHorse.get(key) ?? null;
    const training = { slope: slopeByHorse.get(key) ?? [], wood: woodByHorse.get(key) ?? [] };
    const basicRecord = basicByNumber.get(entry.horseNumber) ?? null;
    const pedigreeRecord = pedigreeByHorse.get(key) ?? (basicRecord ? { ...basicRecord, horseName: entry.horseName } : null);
    const availableIndex = basicRecord?.zi ?? pedigreeRecord?.zi ?? oddsEntry?.zi ?? null;
    if (oddsEntry?.zi != null && availableIndex != null && oddsEntry.zi !== availableIndex) {
      throw new Error(`${bundleId}/${entry.horseName}: ZI mismatch own=${availableIndex} odds=${oddsEntry.zi}`);
    }
    const horseNumber = oddsEntry?.horseNumber ?? entry.horseNumber;
    const raceEntryId = finalRaceEntryId(entry.raceEntryId, horseNumber);
    const missing = [];
    if (!allRecord) missing.push("pastRuns");
    if (!oddsEntry) missing.push("odds");
    if (!training.slope.length && !training.wood.length) missing.push("training");
    if (!pedigreeRecord) missing.push("pedigree");
    if (oddsEntry && normalizeHorseKey(oddsEntry.horseName) !== key) {
      throw new Error(`${bundleId}/${entry.horseName}: oddsNameMismatch`);
    }
    if (missing.length) failures.push({ horseName: entry.horseName, missing });

    return {
      horseName: entry.horseName,
      horseNumber,
      raceEntryId,
      availableIndex,
      currentRace: {
        ...entry,
        horseNumber,
        raceEntryId,
        sire: entry.sire ?? basicRecord?.sire ?? null,
        dam: entry.dam ?? basicRecord?.dam ?? null,
        broodmareSire: entry.broodmareSire ?? basicRecord?.broodmareSire ?? null,
        sexAge: `${entry.sex ?? ""}${entry.age ?? ""}` || null,
      },
      pastRuns: allRecord?.pastRuns ?? [],
      odds: oddsEntry
        ? {
            ...oddsEntry,
            updatedAt: odds.updatedAt,
            source: odds.source,
            status: odds.status,
            sourceStatus: odds.status,
          }
        : null,
      training,
      pedigree: pedigreeRecord,
      joinStatus: missing.length ? "partial" : "joined",
      missing,
    };
  });

  return {
    bundleId,
    race: current.race,
    productionReady: horses.every((horse) => horse.odds?.sourceStatus === "active"),
    source: {
      currentRaceDetail: { rows: current.rowCount, entries: current.entryCount, encoding: current.encoding },
      allCsv: { rows: all.rowCount, horses: all.horseCount, encoding: all.encoding },
      odds: {
        rows: odds.rowCount,
        entries: odds.entryCount,
        updatedAt: odds.updatedAt,
        source: odds.source,
        status: odds.status,
      },
      trainingSlope: { rows: slope.rowCount, encoding: slope.encoding ?? null },
      trainingWood: { rows: wood.rowCount, encoding: wood.encoding ?? null },
      pedigree: { records: pedigree.recordCount ?? 0 },
      basicTxt: { records: basic.recordCount ?? 0, zi: basic.ziCount ?? 0 },
    },
    join: {
      runners: horses.length,
      success: horses.filter((horse) => horse.joinStatus === "joined").length,
      partial: horses.filter((horse) => horse.joinStatus === "partial").length,
      oddsSuccess: horses.filter((horse) => horse.odds?.sourceStatus === "active").length,
      failures,
    },
    horses,
  };
};

export { normalizeHorseKey, normalizeRaceBundle };
