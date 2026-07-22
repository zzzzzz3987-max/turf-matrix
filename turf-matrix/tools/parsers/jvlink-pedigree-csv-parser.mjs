import { parseCsvRows, readTextSmart, resolveFromRepo } from "./parser-contract.mjs";

const source = Object.freeze({
  type: "csv",
  path: "data/target/pedigree.csv",
  requiredForProduction: false,
  sourceSystem: "JRA-VAN JV-Link",
});

const normalizeHeader = (value) => String(value ?? "").replace(/^\uFEFF/, "").trim();

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
      return {
        horseName,
        bloodRegistrationNumber: value(row, "血統登録番号"),
        sire,
        dam,
        broodmareSire,
        damDam,
        sireSire: value(row, "父父"),
        sireDam: value(row, "父母"),
        ancestors: [
          { generation: 1, branch: "sire", name: sire, rawColor: null },
          { generation: 1, branch: "dam", name: dam, rawColor: null },
          { generation: 2, branch: "dam.sire", name: broodmareSire, rawColor: null },
          { generation: 2, branch: "dam.dam", name: damDam, rawColor: null },
        ].filter((ancestor) => ancestor.name),
        source: { type: "JV-Link", record: "RCVN/UM", completeness: "basic-4-line" },
        encoding,
      };
    })
    .filter(Boolean);

  return { parserId: "jvlink-pedigree-csv", encoding, recordCount: records.length, records };
};

export { parse, source };
