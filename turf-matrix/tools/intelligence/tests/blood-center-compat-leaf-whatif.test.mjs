import assert from "node:assert/strict";
import { test } from "node:test";

import {
  conceptCompatibilityCheck,
  leafCompatibilityCenter,
} from "../../analyze/blood-center-compat-leaf.mjs";

test("leaf compatibility center depends on race context but not runners", () => {
  const sprint = leafCompatibilityCenter({
    traits: { speed: 0.95, power: 0.70, stamina: 0.35, sustain: 0.65 },
    bloodBiasIds: [],
    bloodMajorTags: [],
  });
  const staying = leafCompatibilityCenter({
    traits: { speed: 0.40, power: 0.70, stamina: 0.95, sustain: 0.90 },
    bloodBiasIds: [],
    bloodMajorTags: [],
  });
  assert.equal(sprint.leafRuleCount, staying.leafRuleCount);
  assert.ok(Number.isFinite(sprint.center));
  assert.ok(Number.isFinite(staying.center));
  assert.notEqual(sprint.center, staying.center);
});

test("compatibility ranks speed and stamina profiles for their matching conditions", () => {
  const result = conceptCompatibilityCheck();
  assert.equal(result.passed, true);
  assert.ok(result.sprintSpeed > result.sprintStamina);
  assert.ok(result.stayingStamina > result.stayingSpeed);
});
