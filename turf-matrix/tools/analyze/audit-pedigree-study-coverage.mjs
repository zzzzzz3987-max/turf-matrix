import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findPedigreeStudyProfile, PEDIGREE_STUDY_PROFILES } from "../../src/data/pedigree-study-profiles.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const normalize = (name) => String(name ?? "").normalize("NFKC").toLowerCase().replace(/[＊*\s.'’\-]/g, "");

export const auditPedigreeStudyCoverage = (week, index) => {
  const names = new Map();
  const horses = (week.races ?? []).flatMap((race) => (race.horses ?? []).map((horse) => {
    const identity = horse.analysis?.pedigree?.identity ?? {};
    const sides = [["sire", identity.sire], ["broodmareSire", identity.broodmareSire]].map(([role, name]) => {
      if (!name) return { role, name: null, status: "identity_missing" };
      const key = normalize(name);
      const profile = findPedigreeStudyProfile(name);
      const indexed = index.names.some((aliases) => aliases.some((alias) => normalize(alias) === key));
      const status = profile ? "covered" : indexed ? "indexed_not_reviewed" : "not_in_index";
      const row = names.get(key) ?? { name, status, count: 0, source: profile?.source ?? null };
      row.count += 1;
      names.set(key, row);
      return { role, name, status };
    });
    return { raceId: race.id, name: horse.name, sides };
  }));
  const records = [...names.values()].sort((a, b) => a.name.localeCompare(b.name, "ja"));
  const coveredSides = horses.flatMap((horse) => horse.sides).filter((side) => side.status === "covered");
  return {
    raceDate: week.meta?.date ?? null,
    indexUrl: index.indexUrl,
    indexCheckedAt: index.checkedAt,
    profileCount: PEDIGREE_STUDY_PROFILES.length,
    scoringChanged: false,
    summary: {
      horses: horses.length,
      eitherParentCovered: horses.filter((horse) => horse.sides.some((side) => side.status === "covered")).length,
      bothParentsCovered: horses.filter((horse) => horse.sides.every((side) => side.status === "covered")).length,
      sireCovered: coveredSides.filter((side) => side.role === "sire").length,
      broodmareSireCovered: coveredSides.filter((side) => side.role === "broodmareSire").length,
      uniqueParentNames: records.length,
      coveredNames: records.filter((row) => row.status === "covered").length,
      indexedNotReviewedNames: records.filter((row) => row.status === "indexed_not_reviewed").length,
      notInIndexNames: records.filter((row) => row.status === "not_in_index").length,
      missingIdentitySides: horses.flatMap((horse) => horse.sides).filter((side) => side.status === "identity_missing").length,
    },
    names: records,
    horses,
  };
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
  const input = resolve(option("--input", resolve(root, "tools/week-data.json")));
  const output = resolve(option("--output", resolve(root, "docs/analysis/pedigree-study-coverage.json")));
  const index = JSON.parse(readFileSync(resolve(root, "data/research/pedigree-study-index.json"), "utf8"));
  const result = auditPedigreeStudyCoverage(JSON.parse(readFileSync(input, "utf8")), index);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(result, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({ profileCount: result.profileCount, ...result.summary }, null, 2));
}
