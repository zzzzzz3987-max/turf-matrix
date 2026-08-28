import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const args = process.argv.slice(2);
const valueAfter = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const inputPath = resolve(valueAfter("--input", "tools/jvlink/output/stables.learned.json"));
const outputPath = resolve(valueAfter("--output", "data/master/stables.json"));

if (!existsSync(inputPath)) {
  console.error(`[ERROR] 厩舎パターンの承認候補がありません: ${inputPath}`);
  process.exit(2);
}

const learned = JSON.parse(readFileSync(inputPath, "utf8"));
const stables = (learned.stables ?? []).filter((stable) =>
  stable.accepted === true &&
  stable.sampleSize >= (learned.minimumSampleSize ?? 20) &&
  stable.matchSampleSize >= (learned.minimumPatternSampleSize ?? 8) &&
  stable.validation?.status === "passed" &&
  Number.isFinite(stable.adjustedLift) && stable.adjustedLift > 0 &&
  Number.isFinite(stable.hitRate)
);
const summary = {
  input: inputPath,
  output: outputPath,
  candidateCount: learned.stables?.length ?? 0,
  approvedCount: stables.length,
  minimumSampleSize: learned.minimumSampleSize ?? 20,
  minimumPatternSampleSize: learned.minimumPatternSampleSize ?? 8,
};

if (!args.includes("--confirm")) {
  console.log(JSON.stringify({ ...summary, status: "review-only", note: "--confirm 指定時のみmasterへ反映します。" }, null, 2));
  process.exit(1);
}

const approved = {
  schemaVersion: 3,
  status: "approved",
  source: learned.source,
  approval: {
    minimumSampleSize: learned.minimumSampleSize ?? 20,
    minimumPatternSampleSize: learned.minimumPatternSampleSize ?? 8,
    note: "重複排除済みの着順付き調教アーカイブから生成し、対照比較と時系列検証を通過した候補だけを明示承認。",
  },
  stables,
};
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(approved, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ ...summary, status: "approved" }, null, 2));
