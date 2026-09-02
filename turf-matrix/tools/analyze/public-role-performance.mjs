#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRacePublicConclusion } from "../../src/lib/public-view-model.js";
import { loadFrozenPublicRoleDays } from "./lib/public-role-archive.mjs";
import { collectPublicRoleRecords, summarizePublicRoleRecords } from "./lib/public-role-performance.mjs";

const TOOLS_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(TOOLS_DIR, "..", "..");
const OUTPUT_PATH = join(ROOT, "src", "data", "public-role-performance.json");

const main = () => {
  const records = [];
  const sourceDates = [];
  const snapshots = [];

  for (const day of loadFrozenPublicRoleDays({ root: ROOT })) {
    const { date, commit, snapshot, results } = day;
    const dateRecords = collectPublicRoleRecords({
      date,
      snapshot,
      results,
      selectConclusion: buildRacePublicConclusion,
    });
    if (!dateRecords.length) continue;
    records.push(...dateRecords);
    sourceDates.push(date);
    snapshots.push({ date, commit });
  }

  const output = {
    schemaVersion: 2,
    basis: "current-rules-on-frozen-pre-race-data",
    ruleVersion: "public-role-v2",
    rules: {
      value: "market-gap-baseline",
      danger: "top-four-popularity-with-index-gap-three",
    },
    snapshotCutoff: "13:00 JST",
    from: sourceDates[0] ?? null,
    through: sourceDates.at(-1) ?? null,
    raceDays: sourceDates.length,
    roles: {
      value: summarizePublicRoleRecords(records.filter((record) => record.role === "value")),
      danger: summarizePublicRoleRecords(records.filter((record) => record.role === "danger")),
    },
    snapshots,
  };

  writeFileSync(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({
    output: "src/data/public-role-performance.json",
    from: output.from,
    through: output.through,
    raceDays: output.raceDays,
    roles: output.roles,
  }, null, 2));
};

main();
