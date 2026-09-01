import test from "node:test";
import assert from "node:assert/strict";
import { resolveBloodlineId, resolvePedigreeLineIds } from "../bloodline-resolver.mjs";

test("major Japanese sire descendants resolve to stable dictionary line ids", () => {
  assert.equal(resolveBloodlineId("サートゥルナーリア")?.id, "kingmambo");
  assert.equal(resolveBloodlineId("キズナ")?.id, "deep_impact");
  assert.equal(resolveBloodlineId("ハーツクライ")?.id, "heart_cry");
});

test("bridge rules collapse to their canonical statistical family", () => {
  const resolved = resolveBloodlineId("Speightstown");
  assert.equal(resolved?.id, "mr_prospector");
  assert.equal(resolved?.sourceRuleId, "mr_prospector_bridge");
});

test("paternal and broodmare-sire paths resolve independently", () => {
  const resolved = resolvePedigreeLineIds({
    sire: "Unknown Young Sire",
    broodmareSire: "Unknown BMS",
    ancestors: [
      { branch: "sire.sire", generation: 2, name: "Speightstown" },
      { branch: "dam.sire.sire", generation: 3, name: "ディープインパクト" },
    ],
  });
  assert.equal(resolved.sireLine?.id, "mr_prospector");
  assert.equal(resolved.sireLine?.branch, "sire.sire");
  assert.equal(resolved.broodmareSireLine?.id, "deep_impact");
  assert.equal(resolved.broodmareSireLine?.branch, "dam.sire.sire");
});

test("unknown ancestry stays unknown instead of becoming a name-based line", () => {
  assert.equal(resolveBloodlineId("Completely Unknown"), null);
  assert.deepEqual(resolvePedigreeLineIds({ sire: "Unknown", broodmareSire: "Unknown" }), {
    sireLine: null,
    broodmareSireLine: null,
  });
});
