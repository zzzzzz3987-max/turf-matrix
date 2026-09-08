import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runFactorShadowCli } from "./lib/factor-shadow-cli.mjs";
import { buildCourseSurfaceArtifact, evaluateCourseSurfaceArtifact, validateCourseSurfaceArtifact } from "./lib/course-surface-shadow.mjs";

const signed = (value) => value > 0 ? "+" + value : String(value);

export const renderCourseSurfaceReport = (artifact) => {
  const races = artifact.predictions;
  const horses = races.flatMap((race) => race.horses);
  const changes = horses.filter((horse) => horse.courseDelta !== 0);
  const lines = [
    `# コース評価・芝ダート分離 ${artifact.raceDate}`, "",
    `- 記録区分: ${artifact.status === "frozen-pre-race" ? "発走前固定" : "過去データの試算（事前検証には数えない）"}`,
    "- 本番Course・TM INDEX: 未接続。近走・距離・能力・その他因子と係数は変更なし。",
    "- 同じ馬場だけで同場・同形態・馬場実績を計算。ダとダートは同じ扱い。障害と馬場不明は混ぜない。",
    `- 対象: ${races.length}レース / ${horses.length}頭`,
    `- Course点の変化: ${changes.length}頭 / TM INDEXの変化: ${horses.filter((horse) => horse.tmDelta !== 0).length}頭`,
    `- TM INDEX首位の変化: ${races.filter((race) => race.leaderChanged).length}レース`,
    "- 結果は読み込まず、精度向上・回収率改善を判定しない。", "",
    "## レース別", "",
    "| レース | 現行首位 | 修正候補首位 | Course変更頭数 |", "|---|---|---|---:|",
    ...races.map((race) => `| ${race.track}${race.number}R ${race.name} | ${race.horses.find((horse) => horse.number === race.currentLeader).name} | ${race.horses.find((horse) => horse.number === race.shadowLeader).name} | ${race.horses.filter((horse) => horse.courseDelta !== 0).length} |`),
    "", "## 点数が変わる全馬", "",
    "| レース | 馬名 | Course 現行→候補 | TM 現行→候補 | 同馬場走数 | 同場・同馬場 | 異馬場等の除外走数 |",
    "|---|---|---:|---:|---:|---:|---:|",
    ...races.flatMap((race) => race.horses.filter((horse) => horse.courseDelta !== 0).map((horse) =>
      `| ${race.track}${race.number}R | ${horse.name} | ${horse.currentCourse}→${horse.shadowCourse} (${signed(horse.courseDelta)}) | ${horse.currentTm}→${horse.shadowTm} | ${horse.evidence.sameSurfaceRuns} | ${horse.evidence.sameCourseRuns} | ${horse.evidence.excludedSurfaceRuns} |`)),
    "", "除外数は候補の比較対象から外した異馬場・障害・不明の総数。全てが現行の同場項目に混入していたという意味ではない。",
    "対象馬場が不明なら発走前比較を中止する。同馬場未経験は既存の固定点を維持し、未経験馬への新しい加点・減点方式は加えていない。",
    "過去走・同場・同形態が重なる現行の重み構造は維持。細かなコース形態評価の接続、走数補正、近走加重平均の変更は別工程。",
    "", `予測SHA256: \`${artifact.predictionSha256}\``, "",
  ];
  return lines.join("\n");
};

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runFactorShadowCli({ name: "course-surface", directory: "course-surface-v1", factor: "course",
    buildArtifact: buildCourseSurfaceArtifact, validateArtifact: validateCourseSurfaceArtifact,
    evaluateArtifact: evaluateCourseSurfaceArtifact, renderReport: renderCourseSurfaceReport });
}
