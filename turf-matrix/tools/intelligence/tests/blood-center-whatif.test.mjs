import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  dictionaryCompatibilityCenter,
  dictionaryRuleCompatibilities,
} from "../blood-ai.mjs";
import { buildRaceContext } from "../race-context.mjs";
import { BLOODLINE_RULES } from "../dictionaries/bloodline-dictionary.mjs";
import { FEMALE_LINE_RULES } from "../dictionaries/female-line-dictionary.mjs";

const median = (values) => {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

test("Blood center equals the median compatibility of every dictionary rule", () => {
  const context = buildRaceContext({ course: "新潟", surface: "芝", distance: 1000 });
  const compatibilities = dictionaryRuleCompatibilities(context);
  const result = dictionaryCompatibilityCenter(context);
  assert.equal(result.ruleCount, BLOODLINE_RULES.length + FEMALE_LINE_RULES.length);
  assert.equal(result.center, median(compatibilities.map((item) => item.compatibility)));
});

test("Blood center calculation has no week, result, popularity, or odds dependency", () => {
  const source = readFileSync(new URL("../blood-ai.mjs", import.meta.url), "utf8");
  const forbidden = ["week-data.json", "finishPosition", "popularity", "winOdds"];
  for (const token of forbidden) assert.equal(source.includes(token), false, token);
});

test("adding a dictionary rule recalculates rather than reuses a fixed center", () => {
  const context = buildRaceContext({ course: "新潟", surface: "芝", distance: 1000 });
  const rules = [...BLOODLINE_RULES, ...FEMALE_LINE_RULES];
  const before = dictionaryCompatibilityCenter(context, rules);
  const expandedRules = [
    ...rules,
    {
      id: "center-recalculation-probe",
      traits: { speed: 0, power: 0, stamina: 0, sustain: 0 },
      fit: [],
    },
  ];
  const after = dictionaryCompatibilityCenter(context, expandedRules);
  const expected = median(dictionaryRuleCompatibilities(context, expandedRules).map((item) => item.compatibility));
  assert.equal(after.ruleCount, before.ruleCount + 1);
  assert.equal(after.center, expected);
  assert.equal(after.compatibilities.some((item) => item.id === "center-recalculation-probe"), true);
});
