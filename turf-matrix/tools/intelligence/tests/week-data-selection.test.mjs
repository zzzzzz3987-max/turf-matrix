import test from "node:test";
import assert from "node:assert/strict";
import { shouldUseCandidatePreview } from "../../../src/lib/week-data-selection.js";

const payload = (date, options = {}) => ({
  productionWeekDataUpdated: options.productionWeekDataUpdated ?? false,
  intelligenceLayerConnected: options.intelligenceLayerConnected ?? true,
  meta: { date },
  races: options.races ?? [{ id: `${date}-race` }],
});

test("a newer analyzed candidate becomes the automatic Thursday preview", () => {
  assert.equal(shouldUseCandidatePreview({
    candidate: payload("2026-09-05"),
    official: payload("2026-08-30", { productionWeekDataUpdated: true }),
  }), true);
});

test("an official payload wins once it reaches the candidate date", () => {
  assert.equal(shouldUseCandidatePreview({
    candidate: payload("2026-09-05"),
    official: payload("2026-09-05", { productionWeekDataUpdated: true }),
  }), false);
});

test("incomplete or explicitly disabled previews never replace production", () => {
  assert.equal(shouldUseCandidatePreview({
    requestedMode: "official",
    candidate: payload("2026-09-05"),
    official: payload("2026-08-30", { productionWeekDataUpdated: true }),
  }), false);
  assert.equal(shouldUseCandidatePreview({
    candidate: payload("2026-09-05", { races: [] }),
    official: payload("2026-08-30", { productionWeekDataUpdated: true }),
  }), false);
});
