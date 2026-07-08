#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = resolve(SCRIPT_DIR, "csv-config.json");
const MIN_SIZE_BYTES = 1024;
const REQUIRED_KINDS = new Set(["shutuba", "odds"]);

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
      const message = `CSV not found (${file.kind}): ${path}`;
      if (isRequired) errors.push(message);
      else warnings.push(message);
      continue;
    }

    const stats = statSync(path);
    const modified = todayKey(stats.mtime);
    const size = stats.size;
    const rows = countRows(path);

    if (modified !== today) {
      const message = `CSV is not updated today (${file.kind}): ${path} / mtime=${modified}`;
      if (isRequired) errors.push(message);
      else warnings.push(message);
    }

    if (size < MIN_SIZE_BYTES) {
      const message = `CSV is smaller than 1 KB (${file.kind}): ${path} / ${size} bytes`;
      if (isRequired) errors.push(message);
      else warnings.push(message);
    }

    if (rows < 2) {
      const message = `CSV has fewer than 2 rows (${file.kind}): ${path} / rows=${rows}`;
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
