import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
