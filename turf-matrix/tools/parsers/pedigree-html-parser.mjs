import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { cleanCell, PARSER_STATUS, readTextSmart, resolveFromRepo } from "./parser-contract.mjs";

export const parserId = "target-pedigree-html";

export const source = Object.freeze({
  type: "html-directory",
  fileName: "*.html",
  path: "tools/target-html/input/pedigree",
  requiredForProduction: false,
  sourceSystem: "TARGET frontier JV",
});

export const extractionTargets = Object.freeze([
  "horse.name",
  "pedigree.generation1",
  "pedigree.generation2",
  "pedigree.generation3",
  "pedigree.generation4",
]);

export const inspect = () => {
  const dir = resolveFromRepo(source.path);
  const warnings = [];

  if (!existsSync(dir)) {
    return {
      parserId,
      status: PARSER_STATUS.MISSING,
      source: { ...source, path: dir },
      extractionTargets,
      stats: null,
      files: [],
      errors: [],
      warnings: [`pedigree input directory is missing at ${dir}`],
    };
  }

  const files = readdirSync(dir)
    .filter((name) => /\.(html?|HTML?)$/.test(name))
    .sort()
    .map((name) => {
      const path = join(dir, name);
      const stats = statSync(path);
      const { text, encoding } = readTextSmart(path);
      return {
        fileName: name,
        bytes: stats.size,
        encoding,
        updatedAt: stats.mtime.toISOString(),
        hasHtmlTable: /<table[\s>]/i.test(text),
      };
    });

  if (!files.length) warnings.push("No horse-level pedigree HTML files were found.");

  return {
    parserId,
    status: files.length ? PARSER_STATUS.READY : PARSER_STATUS.MISSING,
    source: { ...source, path: dir },
    extractionTargets,
    stats: {
      fileCount: files.length,
    },
    files,
    errors: [],
    warnings,
  };
};

const stripExtension = (fileName) => fileName.replace(/\.html?$/i, "");

const parseAncestorName = (raw) => {
  const cleaned = cleanCell(raw);
  return cleaned.replace(/\s+\d{4}年[\s\S]*$/, "").trim() || cleaned || null;
};

const indexMap = [
  { index: 0, generation: 1, branch: "sire" },
  { index: 1, generation: 2, branch: "sire.sire" },
  { index: 2, generation: 3, branch: "sire.sire.sire" },
  { index: 3, generation: 4, branch: "sire.sire.sire.sire" },
  { index: 4, generation: 4, branch: "sire.sire.sire.dam" },
  { index: 5, generation: 3, branch: "sire.sire.dam" },
  { index: 6, generation: 4, branch: "sire.sire.dam.sire" },
  { index: 7, generation: 4, branch: "sire.sire.dam.dam" },
  { index: 8, generation: 2, branch: "sire.dam" },
  { index: 9, generation: 3, branch: "sire.dam.sire" },
  { index: 10, generation: 4, branch: "sire.dam.sire.sire" },
  { index: 11, generation: 4, branch: "sire.dam.sire.dam" },
  { index: 12, generation: 3, branch: "sire.dam.dam" },
  { index: 13, generation: 4, branch: "sire.dam.dam.sire" },
  { index: 14, generation: 4, branch: "sire.dam.dam.dam" },
  { index: 15, generation: 1, branch: "dam" },
  { index: 16, generation: 2, branch: "dam.sire" },
  { index: 17, generation: 3, branch: "dam.sire.sire" },
  { index: 18, generation: 4, branch: "dam.sire.sire.sire" },
  { index: 19, generation: 4, branch: "dam.sire.sire.dam" },
  { index: 20, generation: 3, branch: "dam.sire.dam" },
  { index: 21, generation: 4, branch: "dam.sire.dam.sire" },
  { index: 22, generation: 4, branch: "dam.sire.dam.dam" },
  { index: 23, generation: 2, branch: "dam.dam" },
  { index: 24, generation: 3, branch: "dam.dam.sire" },
  { index: 25, generation: 4, branch: "dam.dam.sire.sire" },
  { index: 26, generation: 4, branch: "dam.dam.sire.dam" },
  { index: 27, generation: 3, branch: "dam.dam.dam" },
  { index: 28, generation: 4, branch: "dam.dam.dam.sire" },
  { index: 29, generation: 4, branch: "dam.dam.dam.dam" },
];

const parsePedigreeFile = (dir, fileName) => {
  const path = join(dir, fileName);
  const { text, encoding } = readTextSmart(path);
  const cells = [...text.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)]
    .map((match) => cleanCell(match[1]))
    .filter(Boolean);
  const ancestors = indexMap
    .map(({ index, generation, branch }) => ({
      generation,
      branch,
      name: parseAncestorName(cells[index]),
      rawColor: cells[index] || null,
    }))
    .filter((ancestor) => ancestor.name);

  return {
    horseName: stripExtension(fileName),
    sire: ancestors.find((ancestor) => ancestor.branch === "sire")?.name ?? null,
    dam: ancestors.find((ancestor) => ancestor.branch === "dam")?.name ?? null,
    broodmareSire: ancestors.find((ancestor) => ancestor.branch === "dam.sire")?.name ?? null,
    sireSire: ancestors.find((ancestor) => ancestor.branch === "sire.sire")?.name ?? null,
    sireDam: ancestors.find((ancestor) => ancestor.branch === "sire.dam")?.name ?? null,
    damSire: ancestors.find((ancestor) => ancestor.branch === "dam.sire")?.name ?? null,
    damDam: ancestors.find((ancestor) => ancestor.branch === "dam.dam")?.name ?? null,
    ancestors,
    source: {
      fileName,
      encoding,
      cellCount: cells.length,
    },
  };
};

export const parse = () => {
  const dir = resolveFromRepo(source.path);
  if (!existsSync(dir)) {
    return { parserId, records: [], warnings: [`pedigree input directory is missing at ${dir}`] };
  }

  const files = readdirSync(dir)
    .filter((name) => /\.html?$/i.test(name))
    .sort();

  return {
    parserId,
    recordCount: files.length,
    records: files.map((fileName) => parsePedigreeFile(dir, fileName)),
    warnings: files.length ? [] : ["No horse-level pedigree HTML files were found."],
  };
};
