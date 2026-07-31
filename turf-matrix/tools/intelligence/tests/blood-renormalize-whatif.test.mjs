import assert from "node:assert/strict";
import { test } from "node:test";

import {
  contractedScore,
  renormalizedWeightedRaw,
} from "../../analyze/blood-renormalize.mjs";

test("one matched branch keeps its raw contribution after renormalization", () => {
  assert.ok(Math.abs(renormalizedWeightedRaw([{ raw: 9, weight: 0.12 }]) - 9) < 1e-12);
});

test("the same adopted rules produce the same score regardless of coverage metadata", () => {
  const evidence = [
    { ruleId: "rule-a", raw: 8, weight: 0.4 },
    { ruleId: "rule-b", raw: -2, weight: 0.25 },
  ];
  const lowCoverageHorse = { coverage: 0.2, evidence };
  const highCoverageHorse = { coverage: 0.9, evidence };
  const score = (horse) => contractedScore(renormalizedWeightedRaw(horse.evidence));
  assert.equal(score(lowCoverageHorse), score(highCoverageHorse));
});

test("unmatched evidence remains neutral", () => {
  assert.equal(renormalizedWeightedRaw([]), 0);
  assert.equal(contractedScore(renormalizedWeightedRaw([])), 65);
});
