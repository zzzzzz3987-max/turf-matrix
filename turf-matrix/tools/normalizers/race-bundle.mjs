import { existsSync } from "node:fs";
import * as allCsvParser from "../parsers/all-csv-parser.mjs";
import * as basicTxtParser from "../parsers/basic-txt-parser.mjs";
import * as currentRaceParser from "../parsers/current-race-detail-parser.mjs";
import * as jvlinkPedigreeParser from "../parsers/jvlink-pedigree-csv-parser.mjs";
import * as oddsParser from "../parsers/odds-csv-parser.mjs";
import * as pedigreeParser from "../parsers/pedigree-html-parser.mjs";
import * as trainingSlopeParser from "../parsers/training-slope-html-parser.mjs";
import * as trainingWoodParser from "../parsers/training-wood-html-parser.mjs";
import { resolveFromRepo } from "../parsers/parser-contract.mjs";

const normalizeHorseKey = (value) =>
  String(value ?? "").normalize("NFKC").replace(/[＊*$]/g, "").replace(/\u3000/g, " ").replace(/\s+/g, "").trim();

const pedigreeIdentityMatches = (pedigree, currentEntry) => {
  const directComparable = ["sire", "dam", "broodmareSire"]
    .map((field) => [normalizeHorseKey(pedigree?.[field]), normalizeHorseKey(currentEntry?.[field])])
    .filter(([pedigreeName, currentName]) => pedigreeName && currentName);
  const directMatches = directComparable.filter(([pedigreeName, currentName]) => pedigreeName === currentName).length;
  if (directComparable.length < 2 || directMatches < 2) return false;
  if (directMatches === directComparable.length) return true;

  // Imported mares may be registered in Japanese on JBIS and in English on
  // JV-Link. Permit one direct-name mismatch only when the surrounding
  // pedigree independently confirms the identity.
  const supportingComparable = ["sireSire", "sireDam", "damDam"]
    .map((field) => [normalizeHorseKey(pedigree?.[field]), normalizeHorseKey(currentEntry?.[field])])
    .filter(([pedigreeName, currentName]) => pedigreeName && currentName);
  const supportingMatches = supportingComparable
    .filter(([pedigreeName, currentName]) => pedigreeName === currentName).length;
  return supportingMatches >= 2;
};

const withPedigreeTier = (record, tier) => record
  ? { ...record, source: { ...(record.source ?? {}), tier } }
  : null;

const supplementPedigreeDepth = (record, supplemental) => {
  if (!record || !supplemental) return record;
  const primaryAncestors = record.ancestors ?? [];
  const supplementalAncestors = supplemental.ancestors ?? [];
  if (supplementalAncestors.length <= primaryAncestors.length) return record;

  const byBranch = new Map(supplementalAncestors
    .filter((ancestor) => ancestor?.branch && ancestor?.name)
    .map((ancestor) => [ancestor.branch, ancestor]));
  for (const ancestor of primaryAncestors) {
    if (ancestor?.branch && ancestor?.name) byBranch.set(ancestor.branch, ancestor);
  }
  const ancestors = [...byBranch.values()].sort((left, right) =>
    Number(left.generation ?? 0) - Number(right.generation ?? 0)
      || left.branch.localeCompare(right.branch)
  );
  if (ancestors.length <= primaryAncestors.length) return record;

  return {
    ...record,
    ancestors,
    source: {
      ...(record.source ?? {}),
      baseCellCount: record.source?.cellCount ?? primaryAncestors.length,
      cellCount: ancestors.length,
      completeness: ancestors.length >= 62
        ? "five-generation-62"
        : record.source?.completeness,
      supplementedBy: supplemental.source?.sourceSystem
        ?? supplemental.source?.format
        ?? "verified-pedigree-cache",
    },
  };
};

const mergePedigreeWithReference = (record, reference) => {
  if (!record || !reference) return record;
  const referenceByBranch = new Map((reference.ancestors ?? [])
    .filter((ancestor) => Number(ancestor.generation) <= 3 && ancestor.branch && ancestor.name)
    .map((ancestor) => [ancestor.branch, ancestor]));
  const ancestors = (record.ancestors ?? []).map((ancestor) => {
    const referenceAncestor = referenceByBranch.get(ancestor.branch);
    if (!referenceAncestor || Number(ancestor.generation) > 3) return ancestor;
    return {
      ...ancestor,
      name: referenceAncestor.name,
      sourceName: normalizeHorseKey(ancestor.name) === normalizeHorseKey(referenceAncestor.name)
        ? undefined
        : ancestor.name,
      registrationNumber: referenceAncestor.registrationNumber ?? ancestor.registrationNumber,
    };
  });
  const merged = { ...record, ancestors };
  for (const field of ["sire", "dam", "broodmareSire", "sireSire", "sireDam", "damSire", "damDam"]) {
    if (reference[field]) merged[field] = reference[field];
  }
  return merged;
};

const selectPedigreeRecord = ({ localRecord, cachedRecord, jvlinkRecord, basicRecord, currentEntry, horseName }) => {
  if (localRecord && (!jvlinkRecord || pedigreeIdentityMatches(localRecord, jvlinkRecord))) {
    const cacheSupplement = cachedRecord && pedigreeIdentityMatches(localRecord, cachedRecord)
      ? cachedRecord
      : null;
    const supplemented = supplementPedigreeDepth(localRecord, cacheSupplement);
    return withPedigreeTier(mergePedigreeWithReference(supplemented, jvlinkRecord), "race_html");
  }
  if (cachedRecord && pedigreeIdentityMatches(cachedRecord, jvlinkRecord ?? currentEntry)) {
    return withPedigreeTier(mergePedigreeWithReference(cachedRecord, jvlinkRecord), "verified_html_cache");
  }
  if (jvlinkRecord) return withPedigreeTier(jvlinkRecord, "jvlink");
  return basicRecord ? withPedigreeTier({ ...basicRecord, horseName }, "basic_txt") : null;
};

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

let globalPedigreeCache = null;
const globalPedigreeRecords = () => {
  if (!globalPedigreeCache) globalPedigreeCache = pedigreeParser.parse().records;
  return globalPedigreeCache;
};

const normalizeRaceBundle = ({
  bundleId,
  csv,
  html,
  provisional = false,
  allowMissingRaceName = false,
  allowMissingPastRuns = false,
}) => {
  const directCurrentRace = String(csv.currentRace ?? "").replaceAll("\\", "/").includes("data/target/races/");
  const current = currentRaceParser.parse({
    path: csv.currentRace,
    allowProvisional: provisional,
    allowMissingRaceName,
  });
  const all = allowMissingPastRuns
    ? optionalParse(allCsvParser, csv.all, { rowCount: 0, horses: [] })
    : allCsvParser.parse({ path: csv.all });
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
  if (odds.entries.length > current.entryCount) {
    throw new Error(`${bundleId}: odds entries ${odds.entries.length} exceed runners ${current.entryCount}`);
  }

  const slope = optionalParse(trainingSlopeParser, html.trainingSlope, { rowCount: 0, records: [] });
  const wood = optionalParse(trainingWoodParser, html.trainingWood, { rowCount: 0, records: [] });
  const pedigree = pedigreeParser.parse({ path: html.pedigree, cachePath: null });
  const cachedPedigree = globalPedigreeRecords();
  const jvlinkPedigree = optionalParse(jvlinkPedigreeParser, csv.pedigree, { recordCount: 0, records: [] });

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
    if (unexpectedOddsNames.length) {
      throw new Error(
        `${bundleId}: odds/current runner names do not match. ` +
        `missing odds=[${missingOddsNames.join(", ")}], unexpected odds=[${unexpectedOddsNames.join(", ")}]`,
      );
    }
  }
  const slopeByHorse = groupByHorse(slope.records);
  const woodByHorse = groupByHorse(wood.records);
  const localPedigreeByHorse = mapByHorse(pedigree.records);
  const cachedPedigreeByHorse = mapByHorse(cachedPedigree);
  const jvlinkPedigreeByHorse = mapByHorse(jvlinkPedigree.records);
  const basicByNumber = new Map(basic.records.map((record) => [record.horseNumber, record]));
  const failures = [];

  const horses = current.entries.map((entry) => {
    const key = normalizeHorseKey(entry.horseName);
    const allRecord = allByHorse.get(key) ?? null;
    const oddsEntry = oddsByHorse.get(key) ?? null;
    const training = { slope: slopeByHorse.get(key) ?? [], wood: woodByHorse.get(key) ?? [] };
    // TARGET basic.txt uses its display-row number, which is not guaranteed to
    // equal JV-Link's actual horse number. Never apply it by number to a direct
    // race card; the name-bearing odds record remains safe when available.
    const basicRecord = directCurrentRace ? null : basicByNumber.get(entry.horseNumber) ?? null;
    const pedigreeRecord = selectPedigreeRecord({
      localRecord: localPedigreeByHorse.get(key),
      cachedRecord: cachedPedigreeByHorse.get(key),
      jvlinkRecord: jvlinkPedigreeByHorse.get(key),
      basicRecord,
      currentEntry: entry,
      horseName: entry.horseName,
    });
    const availableIndex = oddsEntry?.zi ?? basicRecord?.zi ?? pedigreeRecord?.zi ?? null;
    if (!directCurrentRace && oddsEntry?.zi != null && basicRecord?.zi != null && oddsEntry.zi !== basicRecord.zi) {
      throw new Error(`${bundleId}/${entry.horseName}: ZI mismatch own=${basicRecord.zi} odds=${oddsEntry.zi}`);
    }
    const horseNumber = oddsEntry?.horseNumber ?? entry.horseNumber;
    const raceEntryId = finalRaceEntryId(entry.raceEntryId, horseNumber);
    const missing = [];
    if (!allRecord) missing.push("pastRuns");
    if (!Number.isFinite(oddsEntry?.winOdds)) missing.push("odds");
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
            status: oddsEntry.status ?? odds.status,
            sourceStatus: oddsEntry.status ?? odds.status,
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
    productionReady: horses.some((horse) => horse.odds?.sourceStatus === "active"),
    source: {
      currentRaceDetail: { rows: current.rowCount, entries: current.entryCount, encoding: current.encoding },
      allCsv: { rows: all.rowCount, horses: all.horseCount, encoding: all.encoding },
      odds: {
        rows: odds.rowCount,
        entries: odds.entryCount,
        updatedAt: odds.updatedAt,
        source: odds.source,
        status: odds.entries.length && odds.entries.length < current.entryCount ? "partial" : odds.status,
      },
      trainingSlope: { rows: slope.rowCount, encoding: slope.encoding ?? null },
      trainingWood: { rows: wood.rowCount, encoding: wood.encoding ?? null },
      pedigree: {
        records: horses.filter((horse) => horse.pedigree).length,
        source: "per-horse layered selection",
        raceHtml: horses.filter((horse) => horse.pedigree?.source?.tier === "race_html").length,
        verifiedHtmlCache: horses.filter((horse) => horse.pedigree?.source?.tier === "verified_html_cache").length,
        jvlink: horses.filter((horse) => horse.pedigree?.source?.tier === "jvlink").length,
        basicTxt: horses.filter((horse) => horse.pedigree?.source?.tier === "basic_txt").length,
      },
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

export {
  mergePedigreeWithReference,
  normalizeHorseKey,
  normalizeRaceBundle,
  pedigreeIdentityMatches,
  selectPedigreeRecord,
};
