import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";

const IMPORT_PATTERN = /(?:import|export)\s+(?:[^'";]*?\s+from\s+)?["']([^"']+)["']/g;
const SOURCE_EXTENSIONS = ["", ".mjs", ".js", ".json"];

const normalizePath = (value) => value.replaceAll("\\", "/");
const digest = (value) => createHash("sha256").update(value).digest("hex");

const resolveLocalImport = (parentPath, specifier) => {
  if (!specifier.startsWith(".")) return null;
  const base = resolve(dirname(parentPath), specifier);
  for (const extension of SOURCE_EXTENSIONS) {
    const candidate = extension && extname(base) ? base : `${base}${extension}`;
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`Engine fingerprint import could not be resolved: ${specifier} from ${parentPath}`);
};

const localImports = (path) => {
  if (!/[.]m?js$/.test(path)) return [];
  const source = readFileSync(path, "utf8");
  return [...source.matchAll(IMPORT_PATTERN)].map((match) => match[1]);
};

export const collectEngineFiles = ({ root, entryPoints }) => {
  const absoluteRoot = resolve(root);
  const pending = entryPoints.map((entry) => isAbsolute(entry) ? entry : join(absoluteRoot, entry));
  const files = new Set();

  while (pending.length) {
    const path = resolve(pending.pop());
    const key = normalizePath(relative(absoluteRoot, path));
    if (!key || key.startsWith("../") || key === "..") {
      throw new Error(`Engine fingerprint source is outside the repository: ${path}`);
    }
    if (files.has(path)) continue;
    if (!existsSync(path)) throw new Error(`Engine fingerprint source is missing: ${path}`);
    files.add(path);
    for (const specifier of localImports(path)) {
      const imported = resolveLocalImport(path, specifier);
      if (imported) pending.push(imported);
    }
  }

  return [...files].sort((left, right) =>
    normalizePath(relative(absoluteRoot, left)).localeCompare(normalizePath(relative(absoluteRoot, right))));
};

export const buildEngineFingerprint = ({
  root,
  entryPoints = ["tools/generate-race-batch-candidate.mjs"],
  includeManifest = false,
} = {}) => {
  if (!root) throw new Error("Engine fingerprint root is required");
  const absoluteRoot = resolve(root);
  const files = collectEngineFiles({ root: absoluteRoot, entryPoints });
  const manifest = files.map((path) => {
    const content = readFileSync(path);
    return {
      path: normalizePath(relative(absoluteRoot, path)),
      sha256: digest(content),
      bytes: content.length,
    };
  });
  const hash = createHash("sha256");
  hash.update("turf-matrix-engine-fingerprint-v1\0");
  for (const file of manifest) {
    hash.update(file.path);
    hash.update("\0");
    hash.update(file.sha256);
    hash.update("\0");
  }
  const sha256 = hash.digest("hex");
  return {
    schemaVersion: 1,
    id: `tmx-${sha256.slice(0, 16)}`,
    sha256,
    fileCount: manifest.length,
    ...(includeManifest ? { manifest } : {}),
  };
};
