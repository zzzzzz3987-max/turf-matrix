import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { cleanCell, PARSER_STATUS, readTextSmart, resolveFromRepo } from "./parser-contract.mjs";

export const parserId = "target-pedigree-html";

export const source = Object.freeze({
  type: "html-directory",
  fileName: "*.html",
  path: "tools/target-html/input/pedigree",
  cachePath: "data/pedigree-cache",
  requiredForProduction: false,
  sourceSystem: "TARGET frontier JV / JBIS",
});

export const extractionTargets = Object.freeze([
  "horse.name",
  "pedigree.generation1",
  "pedigree.generation2",
  "pedigree.generation3",
  "pedigree.generation4",
  "pedigree.generation5",
]);

export const inspect = ({ path = source.path, cachePath = source.cachePath } = {}) => {
  const dir = resolveFromRepo(path);
  const cacheDir = cachePath ? resolveFromRepo(cachePath) : null;
  const warnings = [];

  if (!existsSync(dir) && !(cacheDir && existsSync(cacheDir))) {
    return {
      parserId,
      status: PARSER_STATUS.MISSING,
      source: { ...source, path: dir, cachePath: cacheDir },
      extractionTargets,
      stats: null,
      files: [],
      errors: [],
      warnings: [`pedigree input directory is missing at ${dir}`],
    };
  }

  const files = (existsSync(dir) ? readdirSync(dir) : [])
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
        hasJbisPedigree: /class=["']data-3__items["']/i.test(text),
      };
    });

  const cacheFiles = (cacheDir && existsSync(cacheDir) ? readdirSync(cacheDir) : [])
    .filter((name) => /\.json$/i.test(name))
    .sort();

  if (!files.length && !cacheFiles.length) warnings.push("No horse-level pedigree files were found.");

  return {
    parserId,
    status: files.length || cacheFiles.length ? PARSER_STATUS.READY : PARSER_STATUS.MISSING,
    source: { ...source, path: dir, cachePath: cacheDir },
    extractionTargets,
    stats: {
      fileCount: files.length,
      cacheFileCount: cacheFiles.length,
    },
    files,
    errors: [],
    warnings,
  };
};

const stripExtension = (fileName) => fileName.replace(/\.html?$/i, "");

const parseAncestorName = (raw) => {
  const cleaned = cleanCell(raw);
  return cleaned
    .replace(/\s+\d{4}年[\s\S]*$/, "")
    .replace(/\s*\([A-Z]{2,3}\)\s*$/u, "")
    .trim() || cleaned || null;
};

const decodeHtmlEntities = (value) => String(value ?? "")
  .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
  .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
  .replace(/&amp;/gi, "&")
  .replace(/&quot;/gi, "\"")
  .replace(/&apos;|&#39;/gi, "'")
  .replace(/&lt;/gi, "<")
  .replace(/&gt;/gi, ">");

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

const buildJbisIndexMapForSide = (side, maxGeneration = 5) => {
  const entries = [];
  let branches = [side];
  for (let generation = 1; generation <= maxGeneration; generation++) {
    for (const branch of branches) entries.push({ generation, branch });
    branches = branches.flatMap((branch) => [`${branch}.sire`, `${branch}.dam`]);
  }
  return entries;
};

const jbisIndexMap = [
  ...buildJbisIndexMapForSide("sire"),
  ...buildJbisIndexMapForSide("dam"),
].map((entry, index) => ({ ...entry, index }));

const parseTargetAncestors = (text) => {
  const cells = [...text.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)]
    .map((match) => cleanCell(match[1]))
    .filter(Boolean);
  return {
    format: "target-table",
    sourceSystem: "TARGET frontier JV",
    cellCount: cells.length,
    ancestors: indexMap
      .map(({ index, generation, branch }) => ({
        generation,
        branch,
        name: parseAncestorName(cells[index]),
        rawColor: cells[index] || null,
      }))
      .filter((ancestor) => ancestor.name),
  };
};

const parseJbisAncestors = (text) => {
  const cards = [...text.matchAll(
    /<div\b[^>]*class=["'][^"']*data-3__(?:male|female)[^"']*["'][^>]*>[\s\S]*?<a\b[^>]*href=["']\/horse\/\d+\/["'][^>]*class=["'][^"']*txt-link[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi,
  )].map((match) => decodeHtmlEntities(cleanCell(match[1]))).filter(Boolean);
  return {
    format: "jbis-five-generation",
    sourceSystem: "JBIS-Search",
    sourceUrl: (() => {
      const horseId = text.match(/https:\/\/www\.jbis\.jp\/horse\/(\d+)\/pedigree\//i)?.[1];
      return horseId ? `https://www.jbis.or.jp/horse/${horseId}/pedigree/` : null;
    })(),
    cellCount: cards.length,
    ancestors: jbisIndexMap
      .map(({ index, generation, branch }) => ({
        generation,
        branch,
        name: parseAncestorName(cards[index]),
        rawColor: cards[index] || null,
      }))
      .filter((ancestor) => ancestor.name),
  };
};

export const parsePedigreeHtml = (text) => (
  /class=["']data-3__items["']/i.test(text)
    ? parseJbisAncestors(text)
    : parseTargetAncestors(text)
);

export const buildPedigreeRecord = ({ horseName, parsed, sourceMeta = {} }) => {
  const ancestors = parsed.ancestors;
  return {
    horseName,
    sire: ancestors.find((ancestor) => ancestor.branch === "sire")?.name ?? null,
    dam: ancestors.find((ancestor) => ancestor.branch === "dam")?.name ?? null,
    broodmareSire: ancestors.find((ancestor) => ancestor.branch === "dam.sire")?.name ?? null,
    sireSire: ancestors.find((ancestor) => ancestor.branch === "sire.sire")?.name ?? null,
    sireDam: ancestors.find((ancestor) => ancestor.branch === "sire.dam")?.name ?? null,
    damSire: ancestors.find((ancestor) => ancestor.branch === "dam.sire")?.name ?? null,
    damDam: ancestors.find((ancestor) => ancestor.branch === "dam.dam")?.name ?? null,
    ancestors,
    source: {
      format: parsed.format,
      sourceSystem: parsed.sourceSystem,
      sourceUrl: parsed.sourceUrl ?? null,
      cellCount: parsed.cellCount,
      ...sourceMeta,
    },
  };
};

const parsePedigreeFile = (dir, fileName) => {
  const path = join(dir, fileName);
  const { text, encoding } = readTextSmart(path);
  const parsed = parsePedigreeHtml(text);
  return buildPedigreeRecord({
    horseName: stripExtension(fileName),
    parsed,
    sourceMeta: {
      fileName,
      encoding,
    },
  });
};

const supplementHtmlWithDeeperCache = (htmlRecord, cachedRecord) => {
  if (!htmlRecord || !cachedRecord) return htmlRecord;
  const directMatches = ["sire", "dam", "broodmareSire"]
    .filter((field) => htmlRecord[field] && cachedRecord[field])
    .filter((field) => cleanCell(htmlRecord[field]) === cleanCell(cachedRecord[field])).length;
  const htmlAncestors = htmlRecord.ancestors ?? [];
  const cachedAncestors = cachedRecord.ancestors ?? [];
  if (directMatches < 2 || cachedAncestors.length <= htmlAncestors.length) return htmlRecord;

  const byBranch = new Map(cachedAncestors
    .filter((ancestor) => ancestor?.branch && ancestor?.name)
    .map((ancestor) => [ancestor.branch, ancestor]));
  for (const ancestor of htmlAncestors) {
    if (ancestor?.branch && ancestor?.name) byBranch.set(ancestor.branch, ancestor);
  }
  const ancestors = [...byBranch.values()].sort((left, right) =>
    Number(left.generation ?? 0) - Number(right.generation ?? 0)
      || left.branch.localeCompare(right.branch)
  );
  if (ancestors.length <= htmlAncestors.length) return htmlRecord;

  return {
    ...htmlRecord,
    ancestors,
    source: {
      ...(htmlRecord.source ?? {}),
      baseCellCount: htmlRecord.source?.cellCount ?? htmlAncestors.length,
      cellCount: ancestors.length,
      completeness: ancestors.length >= 62
        ? "five-generation-62"
        : htmlRecord.source?.completeness,
      supplementedBy: cachedRecord.source?.sourceSystem
        ?? cachedRecord.source?.format
        ?? "verified-pedigree-cache",
    },
  };
};

export const parse = ({ path = source.path, cachePath = source.cachePath } = {}) => {
  const dir = resolveFromRepo(path);
  const cacheDir = cachePath ? resolveFromRepo(cachePath) : null;
  const files = (existsSync(dir) ? readdirSync(dir) : [])
    .filter((name) => /\.html?$/i.test(name))
    .sort();
  const cacheFiles = (cacheDir && existsSync(cacheDir) ? readdirSync(cacheDir) : [])
    .filter((name) => /\.json$/i.test(name))
    .sort();
  const recordsByHorse = new Map();
  for (const fileName of cacheFiles) {
    const record = JSON.parse(readFileSync(join(cacheDir, fileName), "utf8").replace(/^\uFEFF/, ""));
    if (!record?.horseName || !Array.isArray(record.ancestors)) {
      throw new Error(`Invalid pedigree cache record: ${join(cacheDir, fileName)}`);
    }
    recordsByHorse.set(record.horseName, record);
  }
  for (const fileName of files) {
    const record = parsePedigreeFile(dir, fileName);
    recordsByHorse.set(
      record.horseName,
      supplementHtmlWithDeeperCache(record, recordsByHorse.get(record.horseName)),
    );
  }
  const records = [...recordsByHorse.values()].sort((left, right) => left.horseName.localeCompare(right.horseName, "ja"));

  return {
    parserId,
    recordCount: records.length,
    records,
    warnings: records.length ? [] : [`No horse-level pedigree files were found at ${dir}${cacheDir ? ` or ${cacheDir}` : ""}.`],
  };
};
