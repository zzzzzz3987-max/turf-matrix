import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { buildTrainingAnalysis } from "../intelligence/training-ai.mjs";
import { buildTrainingVideoDiagnosis } from "../intelligence/training-video-diagnosis.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const { values } = parseArgs({ options: {
  input: { type: "string", default: "tools/week-data.batch-normalized.json" },
  "reviews-dir": { type: "string", default: "data/shadow/training-video-v2" },
  "as-of": { type: "string" }, output: { type: "string" }, horse: { type: "string" },
} });
if (!values["as-of"]) throw new Error("Pass --as-of with a timezone-aware timestamp to keep the report reproducible.");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
const input = resolve(ROOT, values.input);
const directory = resolve(ROOT, values["reviews-dir"]);
const batch = readJson(input);
if (!Array.isArray(batch.races) || !batch.races.every((race) => Array.isArray(race.horses))) throw new Error("Expected a normalized race batch.");
const records = readdirSync(directory).filter((name) => name.endsWith(".json")).sort().map((name) => readJson(resolve(directory, name)));
if (records.some((record) => !record || Array.isArray(record) || record.schemaVersion !== 2)) throw new Error("Observation directory contains an invalid or legacy record; audit it before diagnosis.");
const horses = batch.races.flatMap((race) => race.horses).filter((horse) => !values.horse || horse.horseName === values.horse);
if (!horses.length) throw new Error("No matching horses; no report was written.");
const report = horses.map((horse) => {
  const training = buildTrainingAnalysis(horse);
  return { horseName: horse.horseName, race: `${horse.currentRace.course}${horse.currentRace.raceNo}R`,
    clockScore: training.clockScore, clockStatus: training.status,
    diagnosis: buildTrainingVideoDiagnosis(horse, training, records, { asOf: values["as-of"] }) };
});
const summary = { horses: report.length, provisional: report.filter((row) => row.diagnosis.status === "provisional").length,
  notReviewed: report.filter((row) => row.diagnosis.status === "not_reviewed").length,
  needsReview: report.filter((row) => row.diagnosis.status === "needs_review").length,
  productionScoreChanged: false, automaticFullVideoDiagnosisComplete: false };
const escape = (value) => String(value ?? "").replace(/[\r\n|]/g, " ");
const status = { provisional: "暫定所見あり", needs_review: "要確認", not_reviewed: "映像診断未実施" };
if (values.output) {
  const output = resolve(ROOT, values.output);
  const fromDocs = relative(resolve(ROOT, "docs", "analysis"), output);
  if (isAbsolute(fromDocs) || fromDocs === ".." || fromDocs.startsWith("..\\") || fromDocs.startsWith("../") || !output.endsWith(".md")) throw new Error("Reports may only be written as .md files under docs/analysis.");
  const rows = report.map((row) => `| ${escape(row.race)} | ${escape(row.horseName)} | ${row.clockStatus === "missing" ? "保留（中立）" : row.clockScore} | ${status[row.diagnosis.status]} |`).join("\n");
  const details = report.filter((row) => row.diagnosis.status !== "not_reviewed").map((row) => {
    const d = row.diagnosis;
    const clips = d.clips.map((clip) => [
      `### ${clip.phaseLabel} ${clip.videoDate}`,
      `[公式映像](${clip.sourceUrl}) / 時計照合: ${clip.clock.status === "matched" ? `${clip.clock.checkedSplits.join("・")}を照合して一致（4F ${clip.clock.f4}秒・1F ${clip.clock.f1}秒）` : "未照合"}`,
      ...clip.reviewNotes.map((note) => `観察メモ: ${note}`),
      ...clip.findings.map((item) => `- ${item.label}: ${item.summary} (${item.evidence.from.toFixed(2)}～${item.evidence.to.toFixed(2)}秒、${item.evidence.frameCount}場面)\n  根拠: ${item.evidence.rationale}\n  制限: ${item.limitations.join(" ")}`),
      `保留: ${clip.pending.map((item) => item.label).join("、") || "なし"}`,
    ].join("\n\n")).join("\n\n");
    const comparison = [...d.phaseComparison.reasons, d.phaseComparison.summary].filter(Boolean).join(" ");
    return `## ${row.horseName}\n\n${d.summary}\n\n${clips}\n\n### 一週前と最終の比較\n\n${comparison}\n\n除外記録: ${d.excluded.length}件。映像補正0点、独立確認は未完了。`;
  }).join("\n\n");
  const markdown = `# 調教映像・時計照合レポート ${batch.raceDate}\n\n映像記録の基準時刻: ${values["as-of"]}\n\n対象${summary.horses}頭 / 暫定所見${summary.provisional}頭 / 新方式の映像診断未実施${summary.notReviewed}頭 / 要確認${summary.needsReview}頭。\n\nこれは観察記録を使った内部診断レポート。全動画の自動診断や調教師による評価の代替が完成したことを示すものではない。既存調教点は入力データの時計・厩舎パターン等の分析であり、映像の採点ではない。過去時点の入力を復元するバックテストではない。公開データ・指数は更新しない。\n\n${details}\n\n## 対象馬の一覧\n\n| レース | 馬名 | 既存調教点（映像補正前） | 新方式の映像診断 |\n|---|---|---:|---|\n${rows}\n`;
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, markdown, "utf8");
  console.log(JSON.stringify({ ...summary, output }, null, 2));
} else console.log(JSON.stringify({ summary, report }, null, 2));
