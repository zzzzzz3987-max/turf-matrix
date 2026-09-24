import assert from "node:assert/strict";
import test from "node:test";
import { buildRaceValueMetrics } from "../value-ai.mjs";

const horse = (number, tmIndex, popularity) => ({
  id: `horse-${number}`,
  number,
  tmIndex,
  odds: 5,
  popularity,
  oddsDetail: { status: "active" },
});

test("equal index scores share a competitive rank regardless of horse number", () => {
  const runners = [horse(1, 75, 1), horse(2, 75, 2), horse(3, 70, 5)];
  const metrics = buildRaceValueMetrics(runners);

  assert.equal(metrics.get(runners[0]).indexRank, 1);
  assert.equal(metrics.get(runners[1]).indexRank, 1);
  assert.equal(metrics.get(runners[2]).indexRank, 3);
  assert.equal(metrics.get(runners[0]).marketGap, 0);
  assert.equal(metrics.get(runners[1]).marketGap, 1);
  assert.equal(metrics.get(runners[2]).marketGap, 2);
});
