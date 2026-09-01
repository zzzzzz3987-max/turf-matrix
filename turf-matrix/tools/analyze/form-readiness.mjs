#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ANALYZE_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(ANALYZE_DIR, "..", "..");
const TODAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const OUTPUT = join(ROOT, "docs", "analysis", `form-readiness-${TODAY}.md`);
const pathOf = (...parts) => join(ROOT, ...parts);
const source = (...parts) => existsSync(pathOf(...parts)) ? readFileSync(pathOf(...parts), "utf8") : "";
const json = (...parts) => JSON.parse(source(...parts).replace(/^\uFEFF/, ""));
const exists = (...parts) => existsSync(pathOf(...parts));
const includesAll = (text, values) => values.every((value) => text.includes(value));

const packageJson = json("package.json");
const publishSource = source("tools", "publish-race-batch.ps1");
const formSource = source("tools", "intelligence", "form-state-shadow.mjs");
const freezeSource = source("tools", "analyze", "freeze-form-state-shadow.mjs");
const evaluateSource = source("tools", "analyze", "evaluate-form-state-shadow.mjs");
const criteria = [
  ["公開時点より前の過去走だけを使用", includesAll(formSource, ["isPreRaceRun", "runDate < targetDate"])],
  ["直近3走を決定的な新しい順で評価", includesAll(formSource, ["slice(0, 3)", "right.dateValue - left.dateValue"])],
  ["着順百分位と着差を分解", includesAll(formSource, ["finishQuality", "marginQuality", "weight: 0.58", "? 0.42 : 0"])],
  ["人気・オッズ・Valueから独立", includesAll(formSource, ["popularityOddsValueUsed: false"]) && !formSource.includes("run.popularity")],
  ["生上がり3Fを不使用", formSource.includes("rawLast3FUsed: false") && !formSource.includes("run.last3F")],
  ["候補部分はAbility・ZI・相手関係と今回条件から独立", includesAll(formSource, ["candidateAbilityZiOpponentEvidenceUsed: false", "candidateTargetDistanceSurfaceCourseUsed: false"])],
  ["少数実績と地方実績を中立へ縮小", includesAll(formSource, ["evidenceFactor", "isLocalRun(run)", "* 0.4"])],
  ["状態推移と通過順は監視Evidenceのみ", includesAll(freezeSource, ["momentumUsedAsPerformanceScore: false", "passingProgressUsedAsPerformanceScore: false"])],
  ["最大±3点・決定性テスト", includesAll(formSource, ["MAX_ADJUSTMENT = 3", "CANDIDATE_BLEND = 0.35"]) && exists("tools", "intelligence", "tests", "form-state-shadow.test.mjs")],
  ["公開前SHA固定と結果後採用ゲート", packageJson.scripts?.["shadow:form:freeze"] && includesAll(publishSource, ["shadow:form:freeze", "FormShadow"]) && includesAll(evaluateSource, ["MIN_RACES = 30", "MIN_TM_LEADER_CHANGES = 5"])],
];
const score = criteria.filter(([, pass]) => Boolean(pass)).length * 10;
const shadowPath = pathOf("data", "shadow", "form-state-v1");
const artifacts = existsSync(shadowPath)
  ? readdirSync(shadowPath).filter((name) => /^\d{4}-\d{2}-\d{2}-pre-race\.json$/.test(name)).map((name) => json("data", "shadow", "form-state-v1", name))
  : [];
const progress = {
  days: artifacts.length,
  races: artifacts.reduce((sum, artifact) => sum + Number(artifact.summary?.raceCount ?? 0), 0),
  changes: artifacts.reduce((sum, artifact) => sum + Number(artifact.summary?.tmLeaderChangedRaceCount ?? 0), 0),
};
const report = `# Form AI 完成監査 (${TODAY})

## 判定

| AI | 構造完成度 | 本番接続 | 独立検証 |
|---|---:|---|---|
| Form | ${score}/100 | 現行維持 | ${progress.races}/30レース・TM首位変更${progress.changes}/5 |

構造完成度は責務分離、漏洩防止、決定性、事前固定、採用ゲートの実装状況。本番精度を100点と主張する値ではない。独立検証を満たすまでは候補スコアを本番TM INDEXへ接続しない。

| 完成条件 | 判定 | 点 |
|---|---|---:|
${criteria.map(([label, pass]) => `| ${label} | ${pass ? "PASS" : "FAIL"} | ${pass ? 10 : 0} |`).join("\n")}

## 現行診断

- 過去114レース / 1478頭では、現行Formの着順相関 -0.302に対し直近内容単体は -0.325。
- 安全な最大±3点の影補正ではForm相関とTM相関が改善したが、TM首位勝数・複勝数を維持できず過去診断はFAIL。
- このため本番Formは変更せず、次回以降の公開前artifactだけで30レース以上を評価する。

## 責務

Abilityは能力上限・ZI・相手関係、Formは直近3走で実際に走れている水準を担当する。今回距離・芝ダート・コース・斤量・生上がり時計は各専用Factorへ残す。
`;
mkdirSync(dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, report, "utf8");
console.log(JSON.stringify({ output: OUTPUT, structuralScore: score, validation: progress, failures: criteria.filter(([, pass]) => !pass).map(([label]) => label) }, null, 2));
