import assert from "node:assert/strict";
import test from "node:test";

import {
  expandAncestorsWithHn,
  normalizeBreedingId,
} from "../../pedigree/jvlink-hn-pedigree.mjs";

test("HN expansion follows breeding parent ids into generations four and five", () => {
  const ancestors = [{
    generation: 3,
    branch: "sire.sire.sire",
    name: "Ancestor",
    registrationNumber: "1000000001",
  }];
  const records = [
    {
      breedingRegistrationNumber: "1000000001",
      name: "Ancestor",
      sireBreedingRegistrationNumber: "1000000002",
      damBreedingRegistrationNumber: "1000000003",
    },
    {
      breedingRegistrationNumber: "1000000002",
      name: "Fourth Sire",
      sireBreedingRegistrationNumber: "1000000004",
      damBreedingRegistrationNumber: "1000000005",
    },
    { breedingRegistrationNumber: "1000000003", name: "Fourth Dam" },
    { breedingRegistrationNumber: "1000000004", name: "Fifth Sire" },
    { breedingRegistrationNumber: "1000000005", name: "Fifth Dam" },
  ];

  const expanded = expandAncestorsWithHn(ancestors, records, 5);
  assert.deepEqual(expanded.map(({ generation, branch, name }) => [generation, branch, name]), [
    [3, "sire.sire.sire", "Ancestor"],
    [4, "sire.sire.sire.dam", "Fourth Dam"],
    [4, "sire.sire.sire.sire", "Fourth Sire"],
    [5, "sire.sire.sire.sire.dam", "Fifth Dam"],
    [5, "sire.sire.sire.sire.sire", "Fifth Sire"],
  ]);
});

test("HN expansion never invents a parent when the referenced master row is absent", () => {
  const expanded = expandAncestorsWithHn([{
    generation: 3,
    branch: "dam.dam.dam",
    name: "Known",
    registrationNumber: "1000000001",
  }], [{
    breedingRegistrationNumber: "1000000001",
    name: "Known",
    sireBreedingRegistrationNumber: "1000000002",
  }]);
  assert.equal(expanded.length, 1);
});

test("HN breeding ids reject blank and zero placeholders", () => {
  assert.equal(normalizeBreedingId("0000000000"), null);
  assert.equal(normalizeBreedingId(""), null);
  assert.equal(normalizeBreedingId("12345678"), "12345678");
  assert.equal(normalizeBreedingId("1234567890"), "1234567890");
});
