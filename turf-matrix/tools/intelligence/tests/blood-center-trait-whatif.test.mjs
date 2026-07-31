import assert from "node:assert/strict";
import { test } from "node:test";

import { BLOODLINE_RULES } from "../dictionaries/bloodline-dictionary.mjs";
import { FEMALE_LINE_RULES } from "../dictionaries/female-line-dictionary.mjs";
import {
  dictionaryLeafRules,
  dictionaryLeafTraitCenter,
  ruleTraitScore,
} from "../../analyze/blood-center-trait.mjs";

test("trait center is computed only from dictionary leaf rules", () => {
  const center = dictionaryLeafTraitCenter();
  const leaves = dictionaryLeafRules();
  assert.equal(center.leafRuleCount, leaves.length);
  assert.ok(Number.isFinite(center.center));
  assert.equal(center.totalRuleCount, BLOODLINE_RULES.length + FEMALE_LINE_RULES.length);
});

test("trait score is race-independent and uses only dictionary traits", () => {
  const rule = { traits: { speed: 0.8, power: 0.6, stamina: 0.4, sustain: 1.0 } };
  assert.equal(ruleTraitScore(rule), 70);
});

test("adding a leaf dictionary rule recalculates the center population", () => {
  const before = dictionaryLeafTraitCenter();
  const synthetic = {
    id: "synthetic_leaf",
    depth: 4,
    parentGroup: "Synthetic",
    terms: ["synthetic leaf"],
    traits: { speed: 1, power: 1, stamina: 1, sustain: 1 },
  };
  const after = dictionaryLeafTraitCenter([...BLOODLINE_RULES, synthetic], FEMALE_LINE_RULES);
  assert.equal(after.leafRuleCount, before.leafRuleCount + 1);
  assert.notEqual(after.totalWeight, before.totalWeight);
});
