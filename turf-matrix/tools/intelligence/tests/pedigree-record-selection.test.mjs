import assert from "node:assert/strict";
import test from "node:test";

import {
  pedigreeIdentityMatches,
  selectPedigreeRecord,
} from "../../normalizers/race-bundle.mjs";

const currentEntry = {
  horseName: "テストホース",
  sire: "テスト父",
  dam: "テスト母",
  broodmareSire: "テスト母父",
};

const record = (source, overrides = {}) => ({
  horseName: "テストホース",
  sire: "テスト父",
  dam: "テスト母",
  broodmareSire: "テスト母父",
  ancestors: [],
  source: { fileName: source },
  ...overrides,
});

test("a race-level four-generation record has first priority", () => {
  const selected = selectPedigreeRecord({
    localRecord: record("race.html"),
    cachedRecord: record("cache.html"),
    jvlinkRecord: record("jvlink.csv"),
    currentEntry,
    horseName: currentEntry.horseName,
  });
  assert.equal(selected.source.fileName, "race.html");
  assert.equal(selected.source.tier, "race_html");
});

test("a deeper verified cache supplements a matching race-level pedigree", () => {
  const selected = selectPedigreeRecord({
    localRecord: record("race.html", {
      ancestors: [
        { generation: 1, branch: "sire", name: "テスト父" },
        { generation: 4, branch: "sire.sire.sire.sire", name: "祖先A" },
      ],
      source: { fileName: "race.html", cellCount: 2 },
    }),
    cachedRecord: record("cache.json", {
      ancestors: [
        { generation: 1, branch: "sire", name: "テスト父" },
        { generation: 4, branch: "sire.sire.sire.sire", name: "祖先A" },
        { generation: 5, branch: "dam.sire.dam.dam.sire", name: "祖先A" },
      ],
      source: { format: "jvlink-hn-five-generation", sourceSystem: "JV-Link", cellCount: 3 },
    }),
    jvlinkRecord: record("jvlink.csv"),
    currentEntry,
    horseName: currentEntry.horseName,
  });

  assert.equal(selected.source.fileName, "race.html");
  assert.equal(selected.source.tier, "race_html");
  assert.equal(selected.source.supplementedBy, "JV-Link");
  assert.equal(selected.ancestors.length, 3);
  assert.equal(selected.ancestors.at(-1).generation, 5);
});

test("a verified four-generation cache record outranks the JV-Link three-generation record", () => {
  const entryWithoutPedigree = { horseName: currentEntry.horseName };
  const selected = selectPedigreeRecord({
    cachedRecord: record("cache.html"),
    jvlinkRecord: record("jvlink.csv"),
    currentEntry: entryWithoutPedigree,
    horseName: currentEntry.horseName,
  });
  assert.equal(selected.source.fileName, "cache.html");
  assert.equal(selected.source.tier, "verified_html_cache");
});

test("a same-name cache mismatch falls back to JV-Link instead of joining the wrong pedigree", () => {
  const cachedRecord = record("cache.html", { sire: "別の父" });
  assert.equal(pedigreeIdentityMatches(cachedRecord, currentEntry), false);

  const selected = selectPedigreeRecord({
    cachedRecord,
    jvlinkRecord: record("jvlink.csv"),
    currentEntry,
    horseName: currentEntry.horseName,
  });
  assert.equal(selected.source.fileName, "jvlink.csv");
  assert.equal(selected.source.tier, "jvlink");
});

test("one bilingual direct-name mismatch is accepted only with supporting ancestor matches", () => {
  const cachedRecord = record("cache.html", {
    dam: "ガールウィズアドリーム",
    sireSire: "Munnings",
    sireDam: "Rushin No Blushin",
    damDam: "Henley",
  });
  const jvlinkRecord = record("jvlink.csv", {
    dam: "Girl With a Dream",
    sireSire: "Munnings",
    sireDam: "Rushin No Blushin",
    damDam: "Henley",
  });

  assert.equal(pedigreeIdentityMatches(cachedRecord, jvlinkRecord), true);
  const selected = selectPedigreeRecord({
    cachedRecord,
    jvlinkRecord,
    currentEntry,
    horseName: currentEntry.horseName,
  });
  assert.equal(selected.source.tier, "verified_html_cache");
  assert.equal(selected.dam, "Girl With a Dream");
});

test("verified HTML adds deep generations without changing JV-Link generation-one-to-three names", () => {
  const cachedRecord = record("cache.html", {
    sireSire: "デインヒル",
    ancestors: [
      { generation: 1, branch: "sire", name: "テスト父" },
      { generation: 2, branch: "sire.sire", name: "デインヒル" },
      { generation: 4, branch: "sire.sire.sire.sire", name: "Danzig" },
    ],
  });
  const jvlinkRecord = record("jvlink.csv", {
    sireSire: "Danehill",
    ancestors: [
      { generation: 1, branch: "sire", name: "テスト父" },
      { generation: 2, branch: "sire.sire", name: "Danehill" },
    ],
  });
  const selected = selectPedigreeRecord({
    cachedRecord,
    jvlinkRecord,
    currentEntry,
    horseName: currentEntry.horseName,
  });

  assert.equal(selected.sireSire, "Danehill");
  assert.equal(selected.ancestors.find((entry) => entry.branch === "sire.sire").name, "Danehill");
  assert.equal(selected.ancestors.find((entry) => entry.branch === "sire.sire").sourceName, "デインヒル");
  assert.equal(selected.ancestors.find((entry) => entry.branch === "sire.sire.sire.sire").name, "Danzig");
});

test("a mismatched race-level HTML record also falls back to JV-Link", () => {
  const selected = selectPedigreeRecord({
    localRecord: record("race.html", { broodmareSire: "別の母父" }),
    jvlinkRecord: record("jvlink.csv"),
    currentEntry,
    horseName: currentEntry.horseName,
  });
  assert.equal(selected.source.fileName, "jvlink.csv");
  assert.equal(selected.source.tier, "jvlink");
});

test("one local HTML record does not disable JV-Link fallback for other horses", () => {
  const selected = selectPedigreeRecord({
    localRecord: null,
    cachedRecord: null,
    jvlinkRecord: record("jvlink.csv"),
    currentEntry,
    horseName: currentEntry.horseName,
  });
  assert.equal(selected.source.tier, "jvlink");
});
