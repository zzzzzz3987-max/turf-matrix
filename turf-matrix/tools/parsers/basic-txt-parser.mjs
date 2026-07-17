import { existsSync, statSync } from "node:fs";
import { cleanCell, PARSER_STATUS, readTextSmart, resolveFromRepo } from "./parser-contract.mjs";

export const parserId = "target-basic-txt";

export const source = Object.freeze({
  type: "txt",
  fileName: "basic.txt",
  path: "tools/csv/input/races/{bundle}/basic.txt",
  requiredForProduction: false,
  sourceSystem: "TARGET frontier JV",
});

export const extractionTargets = Object.freeze([
  "pedigree.sire",
  "pedigree.dam",
  "pedigree.broodmareSire",
  "pedigree.damDam",
  "ability.zi",
]);

const clean = (value) => cleanCell(value).replace(/^[-－]+$/, "") || null;

const charWidth = (char) => {
  const code = char.codePointAt(0) ?? 0;
  if (code === 0) return 0;
  if (code <= 0x007f || (code >= 0xff61 && code <= 0xff9f)) return 1;
  return 2;
};

const sliceByDisplayWidth = (value, start, end = Infinity) => {
  let width = 0;
  let out = "";
  for (const char of String(value ?? "")) {
    const next = width + charWidth(char);
    if (width >= start && width < end) out += char;
    width = next;
    if (width >= end) break;
  }
  return out;
};

const parseRaceInfo = (lines) => {
  const raceLine = lines.find((line) => /^\s*\d+Ｒ/.test(line));
  const conditionLine = lines.find((line) => /頭立/.test(line));
  const header = lines[0] ?? "";
  return {
    header: clean(header),
    raceName: clean(raceLine?.replace(/^\s*\d+Ｒ\s*/, "")),
    condition: clean(conditionLine),
  };
};

const parsePedigreeRows = (lines) => {
  const headerIndex = lines.findIndex((line) => /^馬\s+父\s+母\s+母の父\s+母の母/.test(line));
  if (headerIndex < 0) return [];

  const rows = [];
  for (const line of lines.slice(headerIndex + 1)) {
    if (!line.trim()) break;
    if (/^\s*\d+\s+ZI\[/.test(line)) break;
    const match = line.match(/^\s*(\d{1,2})\s+(.+)$/);
    if (!match) continue;

    const horseNumber = Number(match[1]);
    const parts = [
      sliceByDisplayWidth(line, 3, 21),
      sliceByDisplayWidth(line, 21, 39),
      sliceByDisplayWidth(line, 39, 59),
      sliceByDisplayWidth(line, 59),
    ].map(clean);
    if (parts.filter(Boolean).length < 4) continue;

    rows.push({
      horseNumber,
      sire: parts[0],
      dam: parts[1],
      broodmareSire: parts[2],
      damDam: parts.slice(3).join(" "),
      ancestors: [
        { generation: 1, branch: "sire", name: parts[0], rawColor: null },
        { generation: 1, branch: "dam", name: parts[1], rawColor: null },
        { generation: 2, branch: "dam.sire", name: parts[2], rawColor: null },
        { generation: 2, branch: "dam.dam", name: parts.slice(3).join(" "), rawColor: null },
      ].filter((ancestor) => ancestor.name),
      source: { type: "basic.txt", completeness: "basic-4-line" },
    });
  }
  return rows;
};

const parseZiRows = (lines) => {
  const rows = [];
  for (const line of lines) {
    const match = line.match(/^\s*(\d{1,2})\s+ZI\[\s*([>\d-]+)\s*\]\s*(.*)$/);
    if (!match) continue;
    const rawZi = match[2];
    const scoreText = rawZi.replace(/[^\d]/g, "");
    const score = scoreText ? Number(scoreText) : null;
    const marks = match[3]
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((item) => {
        const scoreMatch = item.match(/([>\d-]+)([A-Z])?/i);
        return scoreMatch
          ? {
              raw: item,
              score: Number(String(scoreMatch[1]).replace(/[^\d]/g, "")) || null,
              surface: scoreMatch[2] ?? null,
            }
          : { raw: item, score: null, surface: null };
      });
    rows.push({
      horseNumber: Number(match[1]),
      zi: score,
      rawZi,
      marks,
    });
  }
  return rows;
};

export const inspect = ({ path = source.path } = {}) => {
  const file = resolveFromRepo(path);
  if (!existsSync(file)) {
    return {
      parserId,
      status: PARSER_STATUS.MISSING,
      source: { ...source, path: file },
      extractionTargets,
      stats: null,
      errors: [],
      warnings: [`basic.txt is missing at ${file}`],
    };
  }

  const stats = statSync(file);
  const { text, encoding } = readTextSmart(file);
  const lines = text.split(/\r\n|\n|\r/);
  const pedigreeRows = parsePedigreeRows(lines);
  const ziRows = parseZiRows(lines);
  const errors = [];
  if (!pedigreeRows.length) errors.push("No pedigree rows were parsed from basic.txt");

  return {
    parserId,
    status: errors.length ? PARSER_STATUS.INVALID : PARSER_STATUS.READY,
    source: { ...source, path: file },
    extractionTargets,
    stats: {
      bytes: stats.size,
      rows: lines.filter((line) => line.trim()).length,
      pedigreeRows: pedigreeRows.length,
      ziRows: ziRows.length,
      encoding,
      updatedAt: stats.mtime.toISOString(),
    },
    errors,
    warnings: [],
  };
};

export const parse = ({ path = source.path } = {}) => {
  const file = resolveFromRepo(path);
  if (!existsSync(file)) {
    return { parserId, race: null, records: [], ziRecords: [], warnings: [`basic.txt is missing at ${file}`] };
  }

  const { text, encoding } = readTextSmart(file);
  const lines = text.split(/\r\n|\n|\r/);
  const ziByNumber = new Map(parseZiRows(lines).map((record) => [record.horseNumber, record]));
  const records = parsePedigreeRows(lines).map((record) => ({
    ...record,
    zi: ziByNumber.get(record.horseNumber)?.zi ?? null,
    ziDetail: ziByNumber.get(record.horseNumber) ?? null,
    encoding,
  }));

  return {
    parserId,
    race: parseRaceInfo(lines),
    recordCount: records.length,
    ziCount: ziByNumber.size,
    records,
    ziRecords: [...ziByNumber.values()],
    warnings: records.length ? [] : ["No pedigree rows were parsed from basic.txt"],
  };
};
