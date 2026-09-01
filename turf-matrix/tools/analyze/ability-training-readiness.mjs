#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ANALYZE_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(ANALYZE_DIR, "..", "..");
const TODAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const OUTPUT = join(ROOT, "docs", "analysis", `ability-training-readiness-${TODAY}.md`);
const pathOf = (...parts) => join(ROOT, ...parts);
const source = (...parts) => existsSync(pathOf(...parts)) ? readFileSync(pathOf(...parts), "utf8") : "";
const json = (...parts) => JSON.parse(source(...parts).replace(/^\uFEFF/, ""));
const exists = (...parts) => existsSync(pathOf(...parts));
const includesAll = (text, values) => values.every((value) => text.includes(value));

const packageJson = json("package.json");
const publishSource = source("tools", "publish-race-batch.ps1");
const abilitySource = source("tools", "intelligence", "ability-ceiling-shadow.mjs");
const abilityProductionSource = source("tools", "intelligence", "form-ai.mjs");
const trainingSource = source("tools", "intelligence", "training-ai.mjs");
const trainingShadowSource = source("tools", "intelligence", "training-evidence-shadow.mjs");
const historyManifest = json("data", "master", "training-history", "manifest.json");
const baselines = json("data", "master", "training-baselines.json");
const videoReviews = json("data", "master", "training-video-reviews.json");
const stables = json("data", "master", "stables.json");

const abilityCriteria = [
  ["能力・クラス・着差・相手関係を分解", includesAll(abilityProductionSource, ["baseAbility", "margin", "peer", "opponentCareer"])],
  ["人気・オッズから独立", includesAll(abilitySource, ["popularity", "odds"]) && exists("tools", "intelligence", "tests", "ability-ceiling-shadow.test.mjs")],
  ["今回結果と未来情報を不使用", abilitySource.includes("currentRaceResultUsed: false") && exists("tools", "intelligence", "tests", "opponent-race-level.test.mjs")],
  ["条件をまたぐ生上がり時計を不使用", abilitySource.includes("rawLast3FUsed: false") && !abilitySource.includes("run.last3F")],
  ["今回距離から独立した能力上限", abilitySource.includes("targetDistanceUsed: false") && !abilitySource.includes("currentRace?.distance")],
  ["少数実績を中立へ縮小", includesAll(abilitySource, ["evidenceFactor", "NEUTRAL_SCORE", "centralCount === 1 ? 0.6 : 0.35"])],
  ["補正を最大±3点に制限", includesAll(abilitySource, ["MAX_ADJUSTMENT = 3", "-MAX_ADJUSTMENT, MAX_ADJUSTMENT"])],
  ["同入力で決定的", exists("tools", "intelligence", "tests", "ability-ceiling-shadow.test.mjs")],
  ["公開前SHA固定", exists("tools", "analyze", "freeze-ability-ceiling-shadow.mjs") && packageJson.scripts?.["shadow:ability:freeze"]],
  ["結果後の独立採用ゲート", exists("tools", "analyze", "evaluate-ability-ceiling-shadow.mjs") && publishSource.includes("shadow:ability:freeze")],
];

const trainingCriteria = [
  ["坂路・ウッドを別Parserで取得", exists("tools", "parsers", "training-slope-html-parser.mjs") && exists("tools", "parsers", "training-wood-html-parser.mjs")],
  ["最終・一週前・中間を日付で分離", includesAll(trainingSource, ["phaseForDays", "final", "oneWeek", "intermediate"])],
  ["4F・1F・加速ラップを分解", includesAll(trainingSource, ["f4Gap", "f1Gap", "accel"])],
  ["好走時の調教履歴と比較", historyManifest.recordCount >= 1000 && historyManifest.sessionCount >= 10000 && trainingSource.includes("trainingHistoryFor")],
  ["公式映像所見を限定補正", videoReviews.reviews?.length > 0 && Number(videoReviews.policy?.maxAdjustment) <= 2],
  ["厩舎勝負パターンを標本条件付きで照合", stables.stables?.length > 0 && includesAll(trainingSource, ["sampleSize >= 20", "validation?.status === \"passed\""])],
  ["調教コース別の実測時計基準", Object.keys(baselines.groups ?? {}).length >= 5 && baselines.policy?.resultDataUsed === false],
  ["未来時計・市場・結果を基準から排除", historyManifest.policy?.futureSessionFilterRequired === true && baselines.policy?.popularityOddsUsed === false],
  ["本数・鮮度を性能点から除く候補と±3点制限", includesAll(trainingShadowSource, ["empiricalQualityBase", "MAX_ADJUSTMENT", "qualityOnlyBase"])],
  ["公開前固定と結果後採用ゲート", exists("tools", "analyze", "freeze-training-evidence-shadow.mjs") && exists("tools", "analyze", "evaluate-training-evidence-shadow.mjs") && publishSource.includes("shadow:training:freeze")],
];

const score = (criteria) => criteria.filter(([, pass]) => Boolean(pass)).length * 10;
const artifactProgress = (directory) => {
  const path = pathOf("data", "shadow", directory);
  if (!existsSync(path)) return { days: 0, races: 0, changes: 0 };
  const artifacts = readdirSync(path).filter((name) => /^\d{4}-\d{2}-\d{2}-pre-race\.json$/.test(name)).map((name) => json("data", "shadow", directory, name));
  return {
    days: artifacts.length,
    races: artifacts.reduce((sum, artifact) => sum + Number(artifact.summary?.raceCount ?? 0), 0),
    changes: artifacts.reduce((sum, artifact) => sum + Number(artifact.summary?.tmLeaderChangedRaceCount ?? 0), 0),
  };
};
const abilityProgress = artifactProgress("ability-ceiling-v1");
const trainingProgress = artifactProgress("training-evidence-v1");
const criterionTable = (criteria) => criteria.map(([label, pass]) => `| ${label} | ${pass ? "PASS" : "FAIL"} | ${pass ? 10 : 0} |`).join("\n");

const report = `# Ability / Training 完成監査 (${TODAY})

## 判定

| AI | 構造完成度 | 本番接続 | 独立検証 |
|---|---:|---|---|
| Ability | ${score(abilityCriteria)}/100 | 現行維持 | ${abilityProgress.races}/30レース・TM首位変更${abilityProgress.changes}/5 |
| Training | ${score(trainingCriteria)}/100 | 現行維持 | ${trainingProgress.races}/30レース・TM首位変更${trainingProgress.changes}/5 |

構造完成度は機能・漏洩防止・決定性・事前固定・採用ゲートの実装状況。本番精度を100点と主張する値ではない。独立検証を満たすまでは候補スコアを本番TM INDEXへ接続しない。

## Ability

| 完成条件 | 判定 | 点 |
|---|---|---:|
${criterionTable(abilityCriteria)}

## Training

| 完成条件 | 判定 | 点 |
|---|---|---:|
${criterionTable(trainingCriteria)}

## Trainingデータ基盤

- 馬別履歴: ${historyManifest.recordCount}頭 / ${historyManifest.sessionCount}本 / ${historyManifest.shardCount}分割
- 実測時計基準: ${Object.entries(baselines.groups ?? {}).map(([key, value]) => `${key} n=${value.sampleSize}`).join("、")}
- 映像所見: ${videoReviews.reviews?.length ?? 0}件
- 厩舎辞書: ${stables.stables?.length ?? 0}厩舎

## 運用

公開処理でAbilityとTrainingの予測を結果前にSHA固定する。結果取得後、30レース以上・TM首位変更5件以上・対象AIとTMの勝数、複勝数、pairwiseを維持し、TM勝数または複勝数が1件以上改善した場合だけ接続候補とする。
`;

mkdirSync(dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, report, "utf8");
console.log(JSON.stringify({
  output: OUTPUT,
  abilityStructuralScore: score(abilityCriteria),
  trainingStructuralScore: score(trainingCriteria),
  abilityValidation: abilityProgress,
  trainingValidation: trainingProgress,
  abilityFailures: abilityCriteria.filter(([, pass]) => !pass).map(([label]) => label),
  trainingFailures: trainingCriteria.filter(([, pass]) => !pass).map(([label]) => label),
}, null, 2));
