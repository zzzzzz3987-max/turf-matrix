import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { buildEngineFingerprint } from "../intelligence/engine-fingerprint.mjs";
import { preserveFrozenArtifact } from "./lib/factor-shadow-cli.mjs";
import { OVERLAP_VARIANTS, buildOverlapShadowArtifact, validateOverlapShadowArtifact,
  evaluateOverlapShadowArtifact, aggregateOverlapEvaluations } from "./lib/evidence-overlap-shadow.mjs";

const names = { abilityOnly: "能力側だけ除外（参考）", formOnly: "近走側だけ除外（参考）", both: "両方除外（主比較）" };
const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (path) => JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
const save = (path, data) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
};

export const renderOverlapShadowReport = (artifact) => [
  `# 距離重複調整の比較記録 ${artifact.raceDate}`, "",
  artifact.status === "frozen-pre-race" ? "発走前固定済み。本番の点数は未変更。" : "過去データの試算。発走前の検証件数には数えない。",
  "主比較は能力・近走の両方から距離の直接評価を外す案。片方だけの2案は参考比較。結果から主比較を選び直さない。",
  "近走の加重平均修正、コースの芝ダート分離、総合配分の変更は混ぜない。", "",
  "| レース | 発走 | 現行首位 | 能力側のみ | 近走側のみ | 両方 |", "|---|---|---|---|---|---|",
  ...artifact.predictions.map((race) => {
    const name = (number) => race.horses.find((horse) => horse.number === number).name;
    return `| ${race.track}${race.number}R ${race.name} | ${race.time} | ${name(race.comparisons.both.currentLeader)} | ${OVERLAP_VARIANTS.map((key) => name(race.comparisons[key].candidateLeader)).join(" | ")} |`;
  }), "",
  "同点首位は馬番の小さい馬を代表に固定。同点全馬と全馬の点数はJSONに保存。",
  "結果照合では馬番・馬名の一致と全馬の着順・払戻を確認する。不足、競走中止・取消などのあるレースは3候補とも除外し、除外理由を記録する。",
  "単勝・複勝はそれぞれ各レース100円均等として集計する。両券種を合算した購入計画ではない。",
  "自動採用はしない。モデルのコードが違う記録は累積集計でも別グループにする。", "",
  `記録時刻: ${artifact.frozenAt}`, `モデルSHA256: ${artifact.modelSha256}`, `予測SHA256: ${artifact.predictionSha256}`, "",
].join("\n");

export const renderOverlapEvaluationReport = (evaluation) => [
  `# 距離重複調整の成績 ${evaluation.raceDate}`, "",
  "発走前に固定した代表首位を比較。本番未接続・採用判断は別途。3候補をすべて掲載し、好成績の案だけを選ばない。", "",
  "| 比較 | 版 | 評価レース | 勝数 | 複勝的中 | 単勝回収率 | 複勝回収率 |", "|---|---|---:|---:|---:|---:|---:|",
  ...OVERLAP_VARIANTS.flatMap((key) => ["current", "shadow"].map((mode) => {
    const s = evaluation.variants[key].summary[mode];
    const percent = (value) => value == null ? "未集計" : value.toFixed(1) + "%";
    return `| ${names[key]} | ${mode === "current" ? "現行" : "候補"} | ${s.races} | ${s.wins} | ${s.placeHits} | ${percent(s.winRoiPercent)} | ${percent(s.placeRoiPercent)} |`;
  })), "",
  "## 除外レース", "",
  ...(evaluation.variants.both.skipped.length ? evaluation.variants.both.skipped.map((race) => `- ${race.raceId}: ${race.reason}`) : ["なし。"]),
  "", "単勝・複勝それぞれ100円均等。首位入替レースだけの成績、払戻総額、入力照合用ハッシュはJSONに保存。",
  `予測SHA256: ${evaluation.predictionSha256}`, `結果SHA256: ${evaluation.resultSha256}`, "",
].join("\n");

const main = () => {
  const { values } = parseArgs({ options: { input: { type: "string", default: "tools/week-data.json" },
    freeze: { type: "boolean", default: false }, evaluate: { type: "string" }, results: { type: "string" },
    aggregate: { type: "boolean", default: false } } });
  if (values.aggregate) {
    if (values.freeze || values.evaluate || values.results || values.input !== "tools/week-data.json") throw new Error("Aggregate cannot combine other modes");
    const dir = resolve(root, "docs/analysis");
    const files = readdirSync(dir).filter((name) => /^evidence-overlap-evaluation-\d{4}-\d{2}-\d{2}\.json$/.test(name)).sort();
    const report = aggregateOverlapEvaluations(files.map((name) => read(resolve(dir, name))));
    save(resolve(dir, "evidence-overlap-cumulative.json"), report);
    console.log(JSON.stringify({ dates: files.length, groups: report.groups }, null, 2));
    return;
  }
  if (values.evaluate) {
    if (values.freeze || !values.results) throw new Error("Evaluation requires --results and cannot freeze");
    const artifact = read(resolve(root, values.evaluate));
    validateOverlapShadowArtifact(artifact);
    const report = evaluateOverlapShadowArtifact(artifact, read(resolve(root, values.results)));
    const base = resolve(root, `docs/analysis/evidence-overlap-evaluation-${artifact.raceDate}`);
    if ([values.evaluate, values.results].some((path) => [base + ".json", base + ".md"].includes(resolve(root, path)))) throw new Error("Evaluation output must not overwrite an input");
    save(base + ".json", report);
    writeFileSync(base + ".md", renderOverlapEvaluationReport(report));
    console.log(JSON.stringify({ report: base + ".md", primary: report.variants.both.summary, skipped: report.variants.both.skipped }, null, 2));
    return;
  }
  if (values.results) throw new Error("--results requires --evaluate");
  const week = read(resolve(root, values.input));
  const modelSha256 = buildEngineFingerprint({ root, entryPoints: ["tools/analyze/lib/evidence-overlap-shadow.mjs"] }).sha256;
  let artifact = buildOverlapShadowArtifact(week, { prospective: values.freeze, modelSha256 });
  if (values.freeze) artifact = preserveFrozenArtifact(resolve(root, `data/shadow/direct-distance-overlap-v1/${artifact.raceDate}-pre-race.json`), artifact, validateOverlapShadowArtifact);
  const base = resolve(root, `docs/analysis/evidence-overlap-${values.freeze ? "shadow" : "shadow-diagnostic"}-${artifact.raceDate}`);
  save(base + ".json", artifact);
  writeFileSync(base + ".md", renderOverlapShadowReport(artifact));
  console.log(JSON.stringify({ report: base + ".md", status: artifact.status, races: artifact.predictions.length, primaryVariant: artifact.policy.primaryVariant }, null, 2));
};

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
