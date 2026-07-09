#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const INPUT_DIR = join(SCRIPT_DIR, "input");

const decodeHtml = (path) => {
  const buffer = readFileSync(path);
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return { text: buffer.slice(3).toString("utf8"), encoding: "utf8-bom" };
  }

  const utf8 = buffer.toString("utf8");
  if (!utf8.includes("\uFFFD")) return { text: utf8, encoding: "utf8" };

  return { text: new TextDecoder("shift_jis").decode(buffer), encoding: "shift_jis" };
};

const stripTags = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const includesAny = (text, words) => words.some((word) => text.includes(word));

const classify = (name, text) => {
  const source = `${name} ${text}`;
  if (includesAny(source, ["\u8840\u7d71", "\u7236", "\u6bcd\u7236"])) return "pedigree";
  if (includesAny(source, ["\u5742\u8def"])) return "training-slope";
  if (includesAny(source, ["CW", "\u30a6\u30c3\u30c9", "10F", "9F", "8F"])) return "training-wood";
  if (includesAny(source, ["\u8abf\u6559", "Lap", "\u30e9\u30c3\u30d7"])) return "training";
  if (includesAny(source, ["\u524d\u8d70", "ZI", "\u811a\u8cea", "\u7740\u9806"])) return "form";
  if (includesAny(source, ["\u51fa\u99ac\u8868", "\u99ac\u756a", "\u99ac\u540d", "\u9a0e\u624b"])) return "racecard";
  return "unknown";
};

const candidateFields = {
  racecard: ["horseNo", "horseName", "sexAge", "jockey", "weight", "trainer", "owner", "breeder", "color", "birthDate"],
  pedigree: ["sire", "dam", "damSire"],
  form: ["zi", "recentDistance", "runningStyle", "finish"],
  "training-slope": ["slopeTime", "lap", "trainer", "date"],
  "training-wood": ["course", "turn", "time10FTo1F", "lap", "date"],
  training: ["trainingTime", "lap", "course", "date"],
  unknown: [],
};

const detectHtmlInputs = () => {
  if (!existsSync(INPUT_DIR)) return [];

  return readdirSync(INPUT_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && [".html", ".htm"].includes(extname(entry.name).toLowerCase()))
    .map((entry) => {
      const path = join(INPUT_DIR, entry.name);
      const { text, encoding } = decodeHtml(path);
      const plain = stripTags(text);
      const kind = classify(entry.name, plain);

      return {
        file: entry.name,
        kind,
        encoding,
        bytes: readFileSync(path).length,
        tableCount: (text.match(/<table\b/gi) ?? []).length,
        rowCount: (text.match(/<tr\b/gi) ?? []).length,
        candidateFields: candidateFields[kind] ?? [],
      };
    });
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const detected = detectHtmlInputs();
  console.log(JSON.stringify({ inputDir: INPUT_DIR, count: detected.length, files: detected }, null, 2));
}

export { detectHtmlInputs };
