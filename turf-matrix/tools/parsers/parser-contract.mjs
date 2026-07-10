import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PARSER_STATUS = Object.freeze({
  READY: "ready",
  MISSING: "missing",
  INVALID: "invalid",
});

export const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const TOOLS_DIR = resolve(SCRIPT_DIR, "..");
export const REPO_ROOT = resolve(TOOLS_DIR, "..");

export const resolveFromRepo = (path) => resolve(REPO_ROOT, path);

export const readTextSmart = (path) => {
  const buffer = readFileSync(path);
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return { text: buffer.slice(3).toString("utf8"), encoding: "utf8-bom" };
  }

  const utf8 = buffer.toString("utf8");
  if (!utf8.includes("\uFFFD")) return { text: utf8, encoding: "utf8" };

  return { text: new TextDecoder("shift_jis").decode(buffer), encoding: "shift_jis" };
};

export const countNonEmptyRows = (text) =>
  text.split(/\r\n|\n|\r/).filter((line) => line.trim().length > 0).length;

export const cleanCell = (value) =>
  String(value ?? "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\u3000/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const toNumber = (value) => {
  const normalized = String(value ?? "").replace(/,/g, "").trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

export const parseCsvRows = (text) => {
  const rows = [];
  let row = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === "\"") {
        if (text[index + 1] === "\"") {
          current += "\"";
          index++;
        } else {
          quoted = false;
        }
      } else {
        current += char;
      }
    } else if (char === "\"") {
      quoted = true;
    } else if (char === ",") {
      row.push(current);
      current = "";
    } else if (char === "\n") {
      row.push(current);
      rows.push(row);
      row = [];
      current = "";
    } else if (char !== "\r") {
      current += char;
    }
  }

  if (current !== "" || row.length) {
    row.push(current);
    rows.push(row);
  }

  return rows.filter((record) => record.some((cell) => cleanCell(cell).length > 0));
};

export const parseTargetHtmlRows = (text) =>
  text
    .split(/<tr\b[^>]*>/i)
    .slice(1)
    .map((chunk) =>
      [...chunk.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((match) => cleanCell(match[1]))
    )
    .filter((row) => row.length > 0);

export const inspectTextInput = ({
  parserId,
  source,
  extractionTargets,
  minBytes = 1024,
  minRows = 2,
  required = false,
}) => {
  const path = resolveFromRepo(source.path);
  const errors = [];
  const warnings = [];

  if (!existsSync(path)) {
    const message = `${source.fileName} is missing at ${path}`;
    if (required) errors.push(message);
    else warnings.push(message);

    return {
      parserId,
      status: required ? PARSER_STATUS.INVALID : PARSER_STATUS.MISSING,
      source: { ...source, path },
      extractionTargets,
      stats: null,
      errors,
      warnings,
    };
  }

  const stats = statSync(path);
  const { text, encoding } = readTextSmart(path);
  const rows = countNonEmptyRows(text);

  if (stats.size < minBytes) {
    errors.push(`${source.fileName} is smaller than ${minBytes} bytes`);
  }
  if (rows < minRows) {
    errors.push(`${source.fileName} has fewer than ${minRows} non-empty rows`);
  }

  return {
    parserId,
    status: errors.length ? PARSER_STATUS.INVALID : PARSER_STATUS.READY,
    source: { ...source, path },
    extractionTargets,
    stats: {
      bytes: stats.size,
      rows,
      encoding,
      updatedAt: stats.mtime.toISOString(),
    },
    errors,
    warnings,
  };
};

