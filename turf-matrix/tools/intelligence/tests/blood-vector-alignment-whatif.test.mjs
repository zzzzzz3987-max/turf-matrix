import assert from "node:assert/strict";
import { test } from "node:test";

import {
  signedVectorAlignment,
  vectorBloodScore,
  vectorConceptCheck,
} from "../../analyze/blood-vector-alignment.mjs";

test("neutral blood vector contributes exactly zero", () => {
  const alignment = signedVectorAlignment(
    { speed: 0.5, power: 0.5, stamina: 0.5, sustain: 0.5 },
    { speed: 1, power: 0.6, stamina: 0.2, sustain: 0.7 },
  );
  assert.equal(alignment, 0);
  assert.equal(vectorBloodScore(alignment), 65);
});

test("opposite vectors have equal and opposite alignment", () => {
  const race = { speed: 1, power: 0.5, stamina: 0, sustain: 0.5 };
  const matching = signedVectorAlignment({ speed: 1, power: 0.5, stamina: 0, sustain: 0.5 }, race);
  const opposite = signedVectorAlignment({ speed: 0, power: 0.5, stamina: 1, sustain: 0.5 }, race);
  assert.equal(matching, -opposite);
  assert.ok(matching > 0);
});

test("speed and stamina profiles rank correctly for matching conditions", () => {
  assert.equal(vectorConceptCheck().passed, true);
});
