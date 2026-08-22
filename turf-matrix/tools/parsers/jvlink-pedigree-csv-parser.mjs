import { parseCsvRows, readTextSmart, resolveFromRepo } from "./parser-contract.mjs";
import { pedigreeCompleteness, structureUmAncestors } from "../pedigree/jvlink-ancestor-tree.mjs";

const source = Object.freeze({
  type: "csv",
  path: "data/target/pedigree.csv",
  requiredForProduction: false,
  sourceSystem: "JRA-VAN JV-Link",
});

const normalizeHeader = (value) => String(value ?? "").replace(/^\uFEFF/, "").trim();

const parseAncestors = (raw) => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((ancestor) => ancestor && typeof ancestor === "object")
      .map((ancestor) => ({
        generation: Number(ancestor.generation),
        branch: String(ancestor.branch ?? "").trim(),
        name: String(ancestor.name ?? "").trim(),
        registrationNumber: String(ancestor.registrationNumber ?? "").trim() || null,
        rawColor: ancestor.rawColor ?? null,
      }))
      .filter((ancestor) => Number.isInteger(ancestor.generation) && ancestor.generation > 0 && ancestor.branch && ancestor.name);
  } catch {
    return [];
  }
};

const parse = ({ path: sourcePath = source.path } = {}) => {
  const path = resolveFromRepo(sourcePath);
  const { text, encoding } = readTextSmart(path);
  const rows = parseCsvRows(text);
  const headers = rows.shift()?.map(normalizeHeader) ?? [];
  const column = (name) => headers.indexOf(name);
  const value = (row, name) => {
    const index = column(name);
    return index >= 0 ? String(row[index] ?? "").trim() || null : null;
  };

  const records = rows
    .map((row) => {
      const horseName = value(row, "馬名");
      if (!horseName) return null;
      const sire = value(row, "父");
      const dam = value(row, "母");
      const broodmareSire = value(row, "母父");
      const damDam = value(row, "母の母");
      const structuredAncestors = parseAncestors(value(row, "祖先JSON"));
      const fallbackAncestors = structureUmAncestors([
        { name: sire },
        { name: dam },
        { name: value(row, "父父") },
        { name: value(row, "父母") },
        { name: broodmareSire },
        { name: damDam },
      ]);
      const ancestors = structuredAncestors.length > 0 ? structuredAncestors : fallbackAncestors;
      const byBranch = new Map(ancestors.map((ancestor) => [ancestor.branch, ancestor]));
      return {
        horseName,
        bloodRegistrationNumber: value(row, "血統登録番号"),
        sire: byBranch.get("sire")?.name ?? sire,
        dam: byBranch.get("dam")?.name ?? dam,
        broodmareSire: byBranch.get("dam.sire")?.name ?? broodmareSire,
        damSire: byBranch.get("dam.sire")?.name ?? broodmareSire,
        damDam: byBranch.get("dam.dam")?.name ?? damDam,
        sireSire: byBranch.get("sire.sire")?.name ?? value(row, "父父"),
        sireDam: byBranch.get("sire.dam")?.name ?? value(row, "父母"),
        ancestors,
        source: {
          type: "JV-Link",
          record: "RCVN/UM",
          completeness: value(row, "血統完全度") ?? pedigreeCompleteness(ancestors),
        },
        encoding,
      };
    })
    .filter(Boolean);

  return { parserId: "jvlink-pedigree-csv", encoding, recordCount: records.length, records };
};

export { parse, source };
