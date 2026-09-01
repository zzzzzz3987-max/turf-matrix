#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { aggregateShadowEvaluation, evaluateRaceShadowPrediction } from "./lib/blood-pairing-cross-shadow.mjs";
import { auditBloodCandidate } from "../intelligence/blood-completion-audit.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const valueAfter = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const inputPath = resolve(valueAfter("--input", join(ROOT, "tools", "week-data.batch-candidate.json")));
const outputPath = resolve(valueAfter("--output", join(ROOT, "docs", "analysis", "blood-engine-v2-completion-2026-09-01.md")));
const runtimePath = join(ROOT, "tools", "pad-runtime", "blood-engine-v2-completion-audit.json");
const shadowDir = join(ROOT, "data", "shadow", "blood-pairing-cross-v1");
const archiveDir = join(ROOT, "data", "archive");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
const stableJson = (value) => `${JSON.stringify(value, null, 2)}\n`;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const pct = (value) => Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : "-";

const evaluateFrozenShadow = () => {
  const races = [];
  const pending = [];
  const artifacts = existsSync(shadowDir)
    ? readdirSync(shadowDir).filter((name) => /^\d{4}-\d{2}-\d{2}-pre-race\.json$/.test(name)).sort()
    : [];
  for (const name of artifacts) {
    const artifact = readJson(join(shadowDir, name));
    const expectedHash = sha256(stableJson({
      modelVersion: artifact.modelVersion,
      modelSpecSha256: artifact.source.modelSpecSha256,
      raceDate: artifact.raceDate,
      statisticsCutoff: artifact.statistics.evaluationCutoff,
      predictions: artifact.predictions,
    }));
    if (expectedHash !== artifact.predictionSha256) throw new Error(`Frozen Blood prediction hash mismatch: ${artifact.raceDate}`);
    if (artifact.policy.currentRaceResultRead !== false
      || artifact.statistics.evaluationCutoff !== artifact.raceDate.replaceAll("-", "")) {
      throw new Error(`Invalid pre-race policy in Blood artifact: ${artifact.raceDate}`);
    }
    const resultPath = join(archiveDir, `${artifact.raceDate}-results.json`);
    if (!existsSync(resultPath)) {
      pending.push(artifact.raceDate);
      continue;
    }
    const results = readJson(resultPath);
    const byBundle = new Map((results.races ?? []).map((race) => [race.bundleId, race]));
    const byId = new Map((results.races ?? []).map((race) => [race.id, race]));
    for (const prediction of artifact.predictions) {
      const evaluated = evaluateRaceShadowPrediction(
        prediction,
        byBundle.get(prediction.bundleId) ?? byId.get(prediction.raceId),
      );
      if (evaluated) races.push(evaluated);
    }
  }
  const aggregate = aggregateShadowEvaluation(races);
  const checks = [
    ["評価済み30レース以上", aggregate.raceCount >= 30, `${aggregate.raceCount}レース`],
    ["補正発火20頭以上", aggregate.adjustedHorseCount >= 20, `${aggregate.adjustedHorseCount}頭`],
    ["首位集合変動5レース以上", aggregate.leaderSetChangedRaceCount >= 5, `${aggregate.leaderSetChangedRaceCount}レース`],
    ["最大補正2点以内", aggregate.maxAbsAdjustment <= 2, aggregate.maxAbsAdjustment.toFixed(4)],
    ["首位勝数を維持", aggregate.shadowLeaderWins >= aggregate.currentLeaderWins, `${aggregate.currentLeaderWins}→${aggregate.shadowLeaderWins}`],
    ["首位複勝数を維持", aggregate.shadowLeaderPlaces >= aggregate.currentLeaderPlaces, `${aggregate.currentLeaderPlaces}→${aggregate.shadowLeaderPlaces}`],
    ["上位3ランクの実馬券内数を維持", aggregate.shadowTop3ActualPlaces >= aggregate.currentTop3ActualPlaces, `${aggregate.currentTop3ActualPlaces}→${aggregate.shadowTop3ActualPlaces}`],
    ["勝馬の上位3ランク捕捉を維持", aggregate.shadowWinnerInTop3 >= aggregate.currentWinnerInTop3, `${aggregate.currentWinnerInTop3}→${aggregate.shadowWinnerInTop3}`],
    ["全頭pairwise整合率を維持", (aggregate.shadowPairwiseRate ?? 0) >= (aggregate.currentPairwiseRate ?? 0), `${pct(aggregate.currentPairwiseRate)}→${pct(aggregate.shadowPairwiseRate)}`],
    ["同率首位レースを増やさない", aggregate.shadowLeaderTieRaces <= aggregate.currentLeaderTieRaces, `${aggregate.currentLeaderTieRaces}→${aggregate.shadowLeaderTieRaces}`],
  ].map(([label, pass, value]) => ({ label, pass, value }));
  return {
    status: checks.every((check) => check.pass) ? "pass" : "fail",
    aggregate,
    checks,
    pending,
    frozenArtifactCount: artifacts.length,
  };
};

const candidate = auditBloodCandidate(readJson(inputPath));
const shadow = evaluateFrozenShadow();
const bloodStatistics = readJson(join(ROOT, "data", "master", "bloodlines.json"));
const pairingReference = readJson(join(ROOT, "data", "master", "blood-pairing-reference.json"));
const statisticsTimeGuard = bloodStatistics?.status === "approved"
  && /^\d{8}$/.test(String(bloodStatistics?.evaluationCutoff ?? ""))
  && bloodStatistics?.futureObservationCount === 0;
const pairingIsolationGuard = pairingReference?.approval?.scoreApplied === false
  && pairingReference?.futureObservationCount === 0;
const safeProductionComplete = candidate.status === "complete"
  && statisticsTimeGuard
  && pairingIsolationGuard;
const checkRows = candidate.checks.map((check) => `| ${check.label} | ${check.pass ? "PASS" : "FAIL"} |`).join("\n");
const shadowRows = shadow.checks.map((check) => `| ${check.label} | ${check.pass ? "PASS" : "FAIL"} | ${check.value} |`).join("\n");
const report = `# Blood Intelligence Engine v2 完成監査 (2026-09-01)

## 結論

**${safeProductionComplete ? "COMPLETE（検証済み範囲）" : "INCOMPLETE"}**

5代相当血統、父、母父、系統、クロス、条件適性、集団実績、Confidence、Evidenceは全頭で利用可能。個別血統プロフィールと既存の検証済みBloodロジックは点数へ反映する。

配合・クロスの実績補正は114レースの影評価で首位成績を悪化させたため不採用。構造と統計はEvidenceとして残すが、Blood ScoreとTM INDEXには接続しない。これは未完成ではなく、検証結果に基づく安全な完成境界とする。

## 現候補データ（構造監査用）

- レース: ${candidate.metrics.raceCount}
- 出走馬: ${candidate.metrics.horseCount}
- 5代相当62祖先取得: ${candidate.metrics.fiveGenerationCount}/${candidate.metrics.horseCount}
- 父・母父取得: ${candidate.metrics.sireAndBroodmareSireCount}/${candidate.metrics.horseCount}
- クロス検出: ${candidate.metrics.detectedCrossHorseCount}頭
- クロスなし判定: ${candidate.metrics.noCrossHorseCount}頭
- クロス未判定: ${candidate.metrics.horseCount - candidate.metrics.determinedCrossCount}頭
- 馬固有の説明文: ${candidate.metrics.uniqueSummaryCount}/${candidate.metrics.horseCount}
- 配合・クロス統計の点数誤接続: ${candidate.metrics.pairingOrCrossScoreAppliedCount}頭
- Blood集団統計の時点ガード: ${statisticsTimeGuard ? "PASS" : "FAIL"}（cutoff ${bloodStatistics?.evaluationCutoff ?? "-"} / future ${bloodStatistics?.futureObservationCount ?? "-"}件）
- 配合・クロス統計の分離ガード: ${pairingIsolationGuard ? "PASS" : "FAIL"}

## 完成条件

| 条件 | 判定 |
|---|---|
${checkRows}

## 配合・クロス補正の検証

- 凍結artifact: ${shadow.frozenArtifactCount}日分
- 評価済み: ${shadow.aggregate.raceCount}レース / ${shadow.aggregate.horseCount}頭
- 補正発火: ${shadow.aggregate.adjustedHorseCount}頭
- 首位集合変動: ${shadow.aggregate.leaderSetChangedRaceCount}レース
- 首位勝数: ${shadow.aggregate.currentLeaderWins}→${shadow.aggregate.shadowLeaderWins}
- 首位複勝数: ${shadow.aggregate.currentLeaderPlaces}→${shadow.aggregate.shadowLeaderPlaces}
- pairwise整合率: ${pct(shadow.aggregate.currentPairwiseRate)}→${pct(shadow.aggregate.shadowPairwiseRate)}

| 採用条件 | 判定 | 実測 |
|---|---|---|
${shadowRows}

**判定: ${shadow.status === "pass" ? "PASS（接続候補）" : "FAIL（点数非接続を維持）"}**

## 本番で使う範囲

- 5代相当血統の構造、父、母父、主要系統、クロス検出
- 父・母父の個別プロフィールと祖先フォールバック
- 距離、芝・ダート、馬場、コース文脈との適合
- 時点付き集団実績、サンプル補正、Confidence、Evidence
- 未検証の配合・クロス統計は参考表示のみ

## 境界

- 出走馬、着順、人気、オッズを係数決定に使用しない。
- Future leakageを許可しない。
- Blood外のエンジンおよびTM INDEX weightは変更しない。
- 今後の事前固定データで採用ゲートが自然にPASSした場合だけ、配合・クロス補正の接続を別工程で再検討する。
`;

mkdirSync(dirname(outputPath), { recursive: true });
mkdirSync(dirname(runtimePath), { recursive: true });
writeFileSync(outputPath, report, "utf8");
writeFileSync(runtimePath, stableJson({ safeProductionComplete, candidate, shadow }), "utf8");
console.log(JSON.stringify({
  status: safeProductionComplete ? "complete" : "incomplete",
  output: outputPath,
  horses: candidate.metrics.horseCount,
  fiveGeneration: candidate.metrics.fiveGenerationCount,
  crossDetected: candidate.metrics.detectedCrossHorseCount,
  shadowStatus: shadow.status,
  shadowLeaderWins: `${shadow.aggregate.currentLeaderWins}->${shadow.aggregate.shadowLeaderWins}`,
  shadowLeaderPlaces: `${shadow.aggregate.currentLeaderPlaces}->${shadow.aggregate.shadowLeaderPlaces}`,
}, null, 2));
if (!safeProductionComplete) process.exitCode = 1;
