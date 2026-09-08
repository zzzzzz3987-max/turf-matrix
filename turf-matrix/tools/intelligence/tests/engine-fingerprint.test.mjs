import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildEngineFingerprint } from "../engine-fingerprint.mjs";

test("engine fingerprint is deterministic and follows local imports", () => {
  const root = mkdtempSync(join(tmpdir(), "turf-matrix-engine-"));
  try {
    writeFileSync(join(root, "entry.mjs"), 'import { value } from "./factor.mjs";\nexport default value;\n');
    writeFileSync(join(root, "factor.mjs"), "export const value = 67;\n");
    const first = buildEngineFingerprint({ root, entryPoints: ["entry.mjs"], includeManifest: true });
    const second = buildEngineFingerprint({ root, entryPoints: ["entry.mjs"], includeManifest: true });
    assert.deepEqual(first, second);
    assert.deepEqual(first.manifest.map((file) => file.path), ["entry.mjs", "factor.mjs"]);

    writeFileSync(join(root, "factor.mjs"), "export const value = 68;\n");
    const changed = buildEngineFingerprint({ root, entryPoints: ["entry.mjs"] });
    assert.notEqual(changed.id, first.id);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fingerprint follows require dictionaries and manifest-declared history shards", () => {
  const root = mkdtempSync(join(tmpdir(), "turf-matrix-engine-"));
  try {
    mkdirSync(join(root, "training-history"));
    writeFileSync(join(root, "entry.mjs"), 'const a = require("./dictionary.json"); const b = require("./training-history/manifest.json");');
    writeFileSync(join(root, "dictionary.json"), '{"score":67}');
    writeFileSync(join(root, "training-history/manifest.json"), '{"populatedShards":["00"]}');
    writeFileSync(join(root, "training-history/00.json"), '{"records":[]}');
    const options = { root, entryPoints: ["entry.mjs"], includeManifest: true };
    const first = buildEngineFingerprint(options);
    assert.equal(first.schemaVersion, 2);
    assert.deepEqual(first.manifest.map((file) => file.path), [
      "dictionary.json", "entry.mjs", "training-history/00.json", "training-history/manifest.json",
    ]);
    writeFileSync(join(root, "dictionary.json"), '{"score":68}');
    const second = buildEngineFingerprint(options);
    assert.notEqual(first.sha256, second.sha256);
    writeFileSync(join(root, "training-history/00.json"), '{"records":[{"key":"horse"}]}');
    assert.notEqual(second.sha256, buildEngineFingerprint(options).sha256);
    writeFileSync(join(root, "training-history/manifest.json"), '{"populatedShards":["01"]}');
    assert.throws(() => buildEngineFingerprint(options), /could not be resolved/);
    writeFileSync(join(root, "training-history/manifest.json"), '{"populatedShards":[".."]}');
    assert.throws(() => buildEngineFingerprint(options), /Invalid training history shard/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
