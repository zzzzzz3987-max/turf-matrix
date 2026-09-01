import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { parse as parsePedigreeDirectory, parsePedigreeHtml } from "../parsers/pedigree-html-parser.mjs";
import { resolveFromRepo } from "../parsers/parser-contract.mjs";

const MANIFEST_PATH = resolveFromRepo("tools/pedigree/jbis-pedigree-manifest.json");
const OUTPUT_DIR = resolveFromRepo("tools/target-html/input/pedigree");
const CACHE_DIR = resolveFromRepo("data/pedigree-cache");
const BASE_URL = "https://www.jbis.or.jp/horse";

const options = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, value = "true"] = arg.replace(/^--/, "").split("=");
  return [key, value];
}));

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
const selected = options.horse
  ? manifest.filter((entry) => entry.horseName === options.horse)
  : manifest;

if (!selected.length) throw new Error(`No JBIS manifest entry matched horse=${options.horse ?? "all"}`);
mkdirSync(OUTPUT_DIR, { recursive: true });
mkdirSync(CACHE_DIR, { recursive: true });

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const results = [];

for (const [index, entry] of selected.entries()) {
  const outputPath = join(OUTPUT_DIR, `${entry.horseName}.html`);
  if (existsSync(outputPath) && options.refresh !== "true") {
    results.push({ horseName: entry.horseName, status: "existing", outputPath });
    continue;
  }

  const sourceUrl = `${BASE_URL}/${entry.jbisHorseId}/pedigree/`;
  const response = await fetch(sourceUrl, {
    headers: {
      "User-Agent": "TURF-MATRIX pedigree cache builder (+https://turf-matrix.vercel.app/)",
      Accept: "text/html,application/xhtml+xml",
    },
  });
  if (!response.ok) throw new Error(`${entry.horseName}: JBIS returned HTTP ${response.status} for ${sourceUrl}`);

  const html = await response.text();
  const parsed = parsePedigreeHtml(html);
  if (!html.includes(entry.horseName)) {
    throw new Error(`${entry.horseName}: horse name was not found in JBIS response ${sourceUrl}`);
  }
  if (parsed.format !== "jbis-five-generation" || parsed.ancestors.length !== 62) {
    throw new Error(
      `${entry.horseName}: expected 62 JBIS ancestors, got ${parsed.ancestors.length} (${parsed.format})`,
    );
  }

  writeFileSync(outputPath, html, "utf8");
  results.push({
    horseName: entry.horseName,
    status: "downloaded",
    sourceUrl,
    ancestorCount: parsed.ancestors.length,
    outputPath,
  });
  if (index < selected.length - 1) await delay(250);
}

const cacheRecords = parsePedigreeDirectory({
  path: "tools/target-html/input/pedigree",
  cachePath: null,
}).records;
for (const record of cacheRecords) {
  writeFileSync(
    join(CACHE_DIR, `${record.horseName}.json`),
    `${JSON.stringify({ ...record, cacheVersion: 1 }, null, 2)}\n`,
    "utf8",
  );
}

console.log(JSON.stringify({
  manifest: MANIFEST_PATH,
  selected: selected.length,
  downloaded: results.filter((result) => result.status === "downloaded").length,
  existing: results.filter((result) => result.status === "existing").length,
  cacheRecords: cacheRecords.length,
  cacheDirectory: CACHE_DIR,
  results,
}, null, 2));
