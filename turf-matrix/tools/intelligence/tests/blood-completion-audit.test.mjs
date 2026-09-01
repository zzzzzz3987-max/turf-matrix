import test from "node:test";
import assert from "node:assert/strict";
import { REQUIRED_COMPONENTS, auditBloodCandidate } from "../blood-completion-audit.mjs";

const horse = (name, scoreApplied = false) => ({
  name,
  analysis: {
    factorsDetail: {
      blood: {
        score: 67,
        summary: `${name}固有の血統説明`,
        confidenceGrade: "C",
        identity: { sire: "父", broodmareSire: "母父" },
        dataCompleteness: { status: "complete", entryCount: 62, deepestGeneration: 5 },
        crossStatus: "none_detected",
        sireProfile: { summary: "父の説明" },
        broodmareSireProfile: { summary: "母父の説明" },
        evidenceV2: [{ type: "pairing", scoreApplied }],
        componentDetails: Object.fromEntries(REQUIRED_COMPONENTS.map((key) => [key, { status: "active" }])),
      },
    },
  },
});

test("completion audit accepts complete five-generation Blood evidence", () => {
  const result = auditBloodCandidate({
    races: [{ track: "東京", number: 1, horses: [horse("アルファ"), horse("ベータ")] }],
  });
  assert.equal(result.status, "complete");
  assert.equal(result.metrics.fiveGenerationCount, 2);
  assert.equal(result.metrics.uniqueSummaryCount, 2);
});

test("completion audit rejects an unapproved pairing score connection", () => {
  const result = auditBloodCandidate({
    races: [{ track: "東京", number: 1, horses: [horse("アルファ", true)] }],
  });
  assert.equal(result.status, "incomplete");
  assert.equal(result.metrics.pairingOrCrossScoreAppliedCount, 1);
});
