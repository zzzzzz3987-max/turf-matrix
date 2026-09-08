import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runFactorShadowCli } from "./lib/factor-shadow-cli.mjs";
import { buildFormWeightsArtifact, evaluateFormWeightsArtifact, validateFormWeightsArtifact } from "./lib/form-weights-shadow.mjs";

export const renderFormWeightsReport = (artifact) => {
  const races = artifact.predictions;
  const horses = races.flatMap((race) => race.horses);
  return [
    `# 近走評価・加重平均の修正 ${artifact.raceDate}`, "",
    `- 記録区分: ${artifact.status === "frozen-pre-race" ? "発走前固定" : "過去データの試算（事前検証には数えない）"}`,
    "- 本番未接続。近走点のみ変更し、能力・コース・距離・血統・調教などの点数と総合指数の配分は維持。",
    "- 各走の評価と新しい走りを重視する重みは維持。重み付き合計を走数ではなく重みの合計で割る。",
    "- 中央・地方それぞれ直近5走、両方ある場合は85:15、地方のみの中立点への補正、未経験50点も維持。",
    `- 対象: ${races.length}レース / ${horses.length}頭`,
    `- 近走点の変化: ${horses.filter((horse) => horse.formDelta !== 0).length}頭 / TM INDEXの変化: ${horses.filter((horse) => horse.tmDelta !== 0).length}頭`,
    `- TM INDEX首位の変化: ${races.filter((race) => race.leaderChanged).length}レース`,
    "- 結果は読んでいない。点数の上昇は的中率・回収率の改善を示さない。", "",
    "## レース別", "",
    "| レース | 現行首位 | 修正候補首位 |", "|---|---|---|",
    ...races.map((race) => `| ${race.track}${race.number}R ${race.name} | ${race.horses.find((horse) => horse.number === race.currentLeader).name} | ${race.horses.find((horse) => horse.number === race.shadowLeader).name} |`),
    "", "## 全馬の比較", "",
    "| レース | 馬名 | 近走 現行→候補 | TM 現行→候補 | 中央 走数 / 重み合計 | 地方 走数 / 重み合計 |",
    "|---|---|---:|---:|---:|---:|",
    ...races.flatMap((race) => race.horses.map((horse) =>
      `| ${race.track}${race.number}R | ${horse.name} | ${horse.currentForm}→${horse.shadowForm} | ${horse.currentTm}→${horse.shadowTm} | ${horse.evidence.central.count} / ${horse.evidence.central.totalWeight.toFixed(2)} | ${horse.evidence.local.count} / ${horse.evidence.local.totalWeight.toFixed(2)} |`)),
    "", "5走あると重み合計は4.20。現行は重み付き合計を5で割るため、同じ内容の走りでも走数によって点が下がる。候補は4.20で割り、この差をなくす。",
    "各走の日付・重み・評価値と中央/地方別の平均は同名JSONに保存。近走状態の別候補（form-state-v1）や芝ダート分離候補とは合算していない。",
    "総合指数の配分、端数処理、経験走数補正は維持。首位が同点の場合は馬番の小さい方を比較対象にする。",
    "", `予測SHA256: \`${artifact.predictionSha256}\``, "",
  ].join("\n");
};

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runFactorShadowCli({ name: "form-weights", directory: "form-normalized-weights-v1", factor: "form",
    buildArtifact: buildFormWeightsArtifact, validateArtifact: validateFormWeightsArtifact,
    evaluateArtifact: evaluateFormWeightsArtifact, renderReport: renderFormWeightsReport });
}
