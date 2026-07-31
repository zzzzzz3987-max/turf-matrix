import assert from "node:assert/strict";
import { test } from "node:test";

import { lineageVectorScore } from "../../analyze/blood-lineage-vector.mjs";

const entry = (branch, name, scoreWeight) => ({ branch, name, scoreWeight });
const match = (id, depth, hitEntry) => ({ id, depth, hitEntries: [hitEntry] });

test("independent pedigree branches remain in lineage-vector evidence", () => {
  const result = lineageVectorScore({
    matches: [
      match("storm_cat", 2, entry("sire", "Storm Cat", 0.4)),
      match("roberto", 1, entry("dam.sire", "Roberto", 0.25)),
    ],
    raceTraits: { speed: 1, power: 0.7, stamina: 0.3, sustain: 0.6 },
  });
  assert.equal(result.evidence.length, 2);
  assert.deepEqual(result.evidence.map((item) => item.branch), ["sire", "dam.sire"]);
});

test("a more specific rule replaces its parent on the same ancestor", () => {
  const sire = entry("sire", "Harlan's Holiday", 0.4);
  const result = lineageVectorScore({
    matches: [
      match("storm_cat", 2, sire),
      match("harlan_speed", 3, sire),
    ],
    raceTraits: { speed: 1, power: 0.7, stamina: 0.3, sustain: 0.6 },
  });
  assert.equal(result.evidence.length, 1);
  assert.equal(result.evidence[0].ruleId, "harlan_speed");
});

test("unmatched weight is not treated as neutral evidence", () => {
  const result = lineageVectorScore({
    matches: [match("storm_cat", 2, entry("sire", "Storm Cat", 0.4))],
    raceTraits: { speed: 1, power: 0.8, stamina: 0.3, sustain: 0.6 },
  });
  assert.ok(result.score > 65);
  assert.equal(result.evidence.length, 1);
});

