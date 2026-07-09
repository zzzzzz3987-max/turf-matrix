#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = resolve(SCRIPT_DIR, "csv-config.json");
const MIN_SIZE_BYTES = 1024;
const REQUIRED_KINDS = new Set(["unified", "odds"]);
const KIND_LABELS = {
  unified: "all.csv (TARGET all export / \u5168\u3066.csv)",
  shutuba: "shutuba.csv (出馬表 / 出馬表分析)",
  odds: "odds.csv (オッズ)",
  supplement: "supplement.csv (補完用)",
  training: "training.csv (調教)",
  pedigree: "pedigree.csv (血統)",
};

const todayKey = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const countRows = (path) => {
  const text = readFileSync(path);
  if (!text.length) return 0;
  return text.toString("utf8").split(/\r\n|\n|\r/).filter((line) => line.trim().length > 0).length;
};

const errors = [];
const warnings = [];

if (!existsSync(CONFIG_PATH)) {
  errors.push(`Missing config: ${CONFIG_PATH}`);
} else {
  const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  const baseDir = dirname(CONFIG_PATH);
  const files = config.files ?? [];
  const today = todayKey();

  for (const kind of REQUIRED_KINDS) {
    if (!files.some((file) => file.kind === kind)) errors.push(`Missing required CSV config kind: ${kind}`);
  }

  for (const file of files) {
    const isRequired = REQUIRED_KINDS.has(file.kind);
    const path = resolve(baseDir, file.path);

    if (!existsSync(path)) {
      const label = KIND_LABELS[file.kind] ?? file.kind;
      const message = isRequired
        ? `Required TARGET CSV is missing: ${label}. Place it at ${path}. all.csv may be exported on Thursday; odds.csv is added on Friday before production update.`
        : `Optional TARGET CSV is missing: ${label}. Expected path: ${path}`;
      if (isRequired) errors.push(message);
      else warnings.push(message);
      continue;
    }

    const stats = statSync(path);
    const modified = todayKey(stats.mtime);
    const size = stats.size;
    const rows = countRows(path);

    if (modified !== today) {
      const label = KIND_LABELS[file.kind] ?? file.kind;
      const message = `${isRequired ? "Required" : "Optional"} TARGET CSV was not updated today: ${label}. path=${path} / mtime=${modified}. Re-export it from TARGET after the Friday update.`;
      if (isRequired) errors.push(message);
      else warnings.push(message);
    }

    if (size < MIN_SIZE_BYTES) {
      const label = KIND_LABELS[file.kind] ?? file.kind;
      const message = `${isRequired ? "Required" : "Optional"} TARGET CSV is smaller than 1 KB: ${label}. path=${path} / ${size} bytes. Check the TARGET export result.`;
      if (isRequired) errors.push(message);
      else warnings.push(message);
    }

    if (rows < 2) {
      const label = KIND_LABELS[file.kind] ?? file.kind;
      const message = `${isRequired ? "Required" : "Optional"} TARGET CSV has fewer than 2 rows: ${label}. path=${path} / rows=${rows}. Check the TARGET export range.`;
      if (isRequired) errors.push(message);
      else warnings.push(message);
    }
  }
}

warnings.forEach((message) => console.warn(`[WARN] ${message}`));

if (errors.length) {
  errors.forEach((message) => console.error(`[ERROR] ${message}`));
  process.exit(1);
}

console.log("CSV input validation passed.");
