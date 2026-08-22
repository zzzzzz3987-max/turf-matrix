import assert from "node:assert/strict";
import test from "node:test";

import { pedigreeCompleteness, structureUmAncestors, UM_ANCESTOR_BRANCHES } from "../../pedigree/jvlink-ancestor-tree.mjs";

test("JV-Link UM ancestors retain all 14 named branches", () => {
  const ancestors = structureUmAncestors(UM_ANCESTOR_BRANCHES.map((branch, index) => ({
    registrationNumber: `R${index}`,
    name: `ancestor-${index}`,
  })));

  assert.equal(ancestors.length, 14);
  assert.deepEqual(ancestors.map(({ branch }) => branch), UM_ANCESTOR_BRANCHES);
  assert.deepEqual(ancestors.map(({ generation }) => generation), [1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3]);
  assert.equal(pedigreeCompleteness(ancestors), "three-generation-14");
});

test("JV-Link UM ancestor completeness reports missing entries without inventing names", () => {
  const ancestors = structureUmAncestors([{ name: "Sire" }, { name: "Dam" }]);

  assert.equal(ancestors.length, 2);
  assert.equal(pedigreeCompleteness(ancestors), "partial-2-of-14");
  assert.equal(ancestors.some(({ name }) => !name), false);
});
