import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { buildEngineFingerprint } from "../intelligence/engine-fingerprint.mjs";
import { diagnoseEvidenceOverlap } from "./lib/evidence-overlap.mjs";

const names = { abilityOnly: "能力内の距離近似を除外", formOnly: "近走内の距離加減点を除外", both: "両方を除外" };
export const renderEvidenceOverlapReport = (report) => {
  const { summary } = report;
  return [
    `# 能力・近走・距離の重複診断 ${report.raceDate}`, "",
    "本番未接続・結果未参照の試算。重複利用は確認できるが、それだけで過大評価や精度低下とは判定しない。",
    `対象 ${summary.races}レース / ${summary.horses}頭。保存済み能力・近走・距離・総合指数の再現 ${summary.replayed}頭。`, "",
    "## 計算上の経路", "",
    "| 項目 | 実際に利用する実績 | 今回の距離の関与 |", "|---|---|---|",
    "| 能力 | 直近最大12走の着順・着差・クラス・上がり、相手関係、推移など | 各走評価に距離近似の重み0.06。近走能力と推移を通じて最終能力点へ入る |",
    "| 近走 | 中央・地方それぞれ直近最大5走の着順・着差・上がり・クラス | 距離差200m以内+4、400m以内+1、それ以上-3。距離不明は0 |",
    "| 距離適性 | 同馬場の最大12走。着順・着差と距離近似、延長短縮、根幹/非根幹 | 独立した距離評価を維持 |", "",
    "能力詳細の「距離一致」表示点そのものを、もう一度総合指数に足しているわけではない。各走の距離近似とは区別する。",
    "能力内では着差と上がりが各走評価と別の補助項目の両方に使われる。今回はこの配分には手を加えない。",
    `能力の相手関係が未取得で近走能力へフォールバックする馬は${summary.relationFallbackHorses}頭。これは別の独立証拠としては数えない。`, "",
    "## 実績の共用", "",
    `- 3項目の直接過去走選択に共通する実績がある馬: ${summary.horsesWithTripleSharedRuns} / ${summary.horses}頭`,
    `- 3項目共通の延べ馬別過去走: ${summary.tripleSharedRuns}走。そのうち今回と200m以内: ${summary.nearDistanceTripleRuns}走。`,
    "- 同じ過去レースに複数馬が出ていれば馬ごとに数える。独立したレース数ではない。",
    "- 共用走数は正負や加点量を示さない。相手関係経由の間接的な利用はこの走数に含めない。", "",
    "## 距離の直接重複を外す試算", "",
    "近走の加重平均修正やコースの芝ダート分離は混ぜていない。総合指数の係数・調教欠損・距離点・各種補正を維持する。",
    "能力側の候補では距離の小項目を除き、残る各走要素の重みを再正規化する。近走側は距離ボーナス/ペナルティを0にする。",
    "遠い距離の実績では既存の低評価が外れて点が上がる場合もある。全面的な減点候補ではない。", "",
    "| 試算 | 能力変更 | 近走変更 | TM変更 | TM差の範囲 | 首位変更 |", "|---|---:|---:|---:|---|---:|",
    ...Object.entries(summary.candidates).map(([key, value]) => `| ${names[key]} | ${value.abilityChanged} | ${value.formChanged} | ${value.tmChanged} | ${value.tmDeltaRange.join("〜")} | ${value.leadersChanged} |`),
    "", "## 首位比較", "",
    "同点では馬番順で代表首位を決める。同点全馬の番号と順位変動はJSONに保持する。",
    "| レース | 現行 | 能力側のみ | 近走側のみ | 両方 |", "|---|---|---|---|---|",
    ...report.races.map((race) => {
      const name = (number) => race.horses.find((horse) => horse.number === number).name;
      return `| ${race.track}${race.number}R ${race.name} | ${name(race.comparisons.both.currentLeader)} | ${name(race.comparisons.abilityOnly.candidateLeader)} | ${name(race.comparisons.formOnly.candidateLeader)} | ${name(race.comparisons.both.candidateLeader)} |`;
    }),
    "", "## 全馬の両方除外比較", "",
    "| レース | 馬名 | 3項目共用走数 | 能力 現行→候補 | 近走 現行→候補 | 距離（不変） | TM 現行→候補 | 丸め前の寄与差 |",
    "|---|---|---:|---:|---:|---:|---:|---:|",
    ...report.races.flatMap((race) => race.horses.map((horse) => {
      const candidate = horse.candidates.both;
      return `| ${race.track}${race.number}R | ${horse.name} | ${horse.tripleSharedRuns} | ${horse.scores.ability}→${candidate.ability} | ${horse.scores.form}→${candidate.form} | ${horse.scores.distance} | ${horse.currentTm}→${candidate.tm} | ${candidate.weightedDelta} |`;
    })),
    "", "丸め前の寄与差は既存配分に基づく能力・近走点の変更量。総合指数にはその後、丸め・上下限・経験走数補正が入るため単純に一致しない。",
    "各馬の実績日付・距離・着順・着差・利用項目・近走内の距離加減点を同名JSONに保持。元の各走情報は変更していない。",
    "", "## 判定範囲", "",
    "重複の存在と指数への感度を確認した段階。的中率・回収率・適切な配分は未判定。発走前の成績検証には数えず、自動採用もしない。",
    "今後の候補は距離の直接重複を切り分けたもの。着順・着差の共用を全て消すことは、各分析の目的も変えるため保留。",
    "", `入力SHA256: ${report.inputSha256 ?? "未設定"}`, `モデルSHA256: ${report.modelSha256 ?? "未設定"}`, "",
  ].join("\n");
};

const main = () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const { values } = parseArgs({ options: { input: { type: "string", default: "tools/week-data.json" } } });
  const input = readFileSync(resolve(root, values.input), "utf8");
  const report = diagnoseEvidenceOverlap(JSON.parse(input.replace(/^\uFEFF/, "")));
  report.inputSha256 = createHash("sha256").update(input).digest("hex");
  report.modelSha256 = buildEngineFingerprint({ root, entryPoints: ["tools/analyze/lib/evidence-overlap.mjs"] }).sha256;
  report.generatedAt = new Date().toISOString();
  const base = resolve(root, `docs/analysis/evidence-overlap-${report.raceDate}`);
  if (resolve(root, values.input) === base + ".json") throw new Error("Output must not overwrite input");
  mkdirSync(dirname(base), { recursive: true });
  writeFileSync(base + ".json", JSON.stringify(report, null, 2) + "\n");
  writeFileSync(base + ".md", renderEvidenceOverlapReport(report));
  console.log(JSON.stringify(report.summary, null, 2));
};

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
