import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { parse } from "../../parsers/odds-csv-parser.mjs";

test("odds parser preserves a no-vote runner as missing without estimating odds", () => {
  const dir = mkdtempSync(join(tmpdir(), "tm-odds-partial-"));
  const path = join(dir, "odds.csv");
  writeFileSync(path, [
    "人気,枠,馬番,馬名,騎手,ZI,単勝,状態",
    "1,,1,本命馬,,,2.4,active",
    "2,,2,未投票馬,,,,missing",
  ].join("\n"), "utf8");

  try {
    const result = parse({ path, expectedFieldSize: 2 });
    assert.equal(result.status, "partial");
    assert.equal(result.entries[0].winOdds, 2.4);
    assert.equal(result.entries[0].status, "active");
    assert.equal(result.entries[1].winOdds, null);
    assert.equal(result.entries[1].status, "missing");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("odds parser accepts a horse-number gap caused by a scratched runner", () => {
  const dir = mkdtempSync(join(tmpdir(), "tm-odds-scratch-"));
  const path = join(dir, "odds.csv");
  writeFileSync(path, [
    "人気,枠,馬番,馬名,騎手,ZI,単勝,状態",
    "1,,1,出走馬A,,,2.4,active",
    "2,,3,出走馬B,,,4.8,active",
    "3,,4,出走馬C,,,7.1,active",
  ].join("\n"), "utf8");

  try {
    const result = parse({ path, expectedFieldSize: 3 });
    assert.equal(result.status, "active");
    assert.deepEqual(result.entries.map((entry) => entry.horseNumber), [1, 3, 4]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
