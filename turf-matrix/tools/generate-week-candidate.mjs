#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const NORMALIZED_PATH = join(SCRIPT_DIR, "week-data.normalized.json");
const OUT_PATH = join(SCRIPT_DIR, "week-data.candidate.json");

const FACTOR_KEYS = ["ability", "distance", "lap", "training", "trainingLap", "stable", "frame", "course", "pace"];

const clamp = (value, min = 35, max = 96) => Math.max(min, Math.min(max, Math.round(value)));
const avg = (values, fallback = 60) => {
  const nums = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  return nums.length ? nums.reduce((sum, value) => sum + value, 0) / nums.length : fallback;
};
const normalizeHorseKey = (value) =>
  String(value ?? "")
    .normalize("NFKC")
    .replace(/\u3000/g, " ")
    .replace(/\s+/g, "")
    .trim();

const hasInvalidNumber = (value) => typeof value === "number" && !Number.isFinite(value);

const findInvalidNumbers = (value, path = "$", errors = []) => {
  if (hasInvalidNumber(value)) errors.push(path);
  if (Array.isArray(value)) {
    value.forEach((item, index) => findInvalidNumbers(item, `${path}[${index}]`, errors));
  } else if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, item]) => findInvalidNumbers(item, `${path}.${key}`, errors));
  }
  return errors;
};

const duplicates = (values) => {
  const seen = new Set();
  const duplicated = new Set();
  for (const value of values) {
    if (value == null || value === "") continue;
    if (seen.has(value)) duplicated.add(value);
    seen.add(value);
  }
  return [...duplicated];
};

const scoreZi = (horse) => clamp(42 + ((horse.odds?.zi ?? 95) - 80) * 1.3);

const scoreRecentForm = (horse) => {
  const runs = (horse.pastRuns ?? []).slice(0, 5);
  if (!runs.length) return 50;
  return clamp(
    avg(
      runs.map((run, index) => {
        const field = run.fieldSize || 16;
        const finish = run.finishPosition || field;
        const finishScore = ((field - finish + 1) / field) * 100;
        const marginScore = run.margin == null ? 60 : 72 - run.margin * 18;
        const recentWeight = 1 - index * 0.08;
        return (finishScore * 0.55 + marginScore * 0.45) * recentWeight;
      })
    )
  );
};

const scoreDistance = (horse) => {
  const target = horse.currentRace?.distance ?? 2000;
  const runs = horse.pastRuns ?? [];
  const relevant = runs
    .filter((run) => run.surface === horse.currentRace?.surface)
    .map((run) => Math.max(0, 100 - Math.abs((run.distance ?? target) - target) / 8));
  return clamp(avg(relevant.slice(0, 12), 58));
};

const scoreCourse = (horse) => {
  const runs = horse.pastRuns ?? [];
  const sameCourse = runs.filter((run) => run.course === horse.currentRace?.course);
  const sameSurface = runs.filter((run) => run.surface === horse.currentRace?.surface);
  const sameCourseScore = sameCourse.length ? 62 + Math.min(18, sameCourse.length * 3) : 52;
  const surfaceScore = sameSurface.length ? 58 + Math.min(18, sameSurface.length) : 50;
  return clamp(sameCourseScore * 0.55 + surfaceScore * 0.45);
};

const scoreLap = (horse) => {
  const runs = (horse.pastRuns ?? []).filter((run) => typeof run.last3F === "number").slice(0, 8);
  if (!runs.length) return 55;
  return clamp(avg(runs.map((run) => 92 - (run.last3F - 33) * 8)));
};

const scorePace = (horse) => {
  const orders = (horse.pastRuns ?? [])
    .slice(0, 8)
    .flatMap((run) => run.passingOrder ?? [])
    .filter((value) => typeof value === "number" && value > 0);
  if (!orders.length) return 58;
  const mean = avg(orders, 8);
  return clamp(76 - Math.abs(mean - 6) * 3.5);
};

const scoreTraining = (horse) => {
  const slope = horse.training?.slope ?? [];
  const wood = horse.training?.wood ?? [];
  const records = [...slope, ...wood];
  if (!records.length) return 50;

  const countScore = 58 + Math.min(18, records.length * 2);
  const finalF = [
    ...slope.map((item) => item["1F"]),
    ...wood.map((item) => item.times?.["1F"]),
  ].filter((value) => typeof value === "number");
  const finalScore = finalF.length ? avg(finalF.map((value) => 94 - (value - 11.2) * 9)) : 60;
  return clamp(countScore * 0.45 + finalScore * 0.55);
};

const scoreBlood = (horse) => {
  const pedigree = horse.pedigree;
  if (!pedigree) return 50;
  const ancestorCount = pedigree.ancestors?.length ?? 0;
  const base = 60 + Math.min(18, ancestorCount * 0.6);
  const completeness = [pedigree.sire, pedigree.dam, pedigree.broodmareSire, pedigree.sireSire, pedigree.damDam].filter(Boolean).length;
  return clamp(base + completeness * 2);
};

const scoreValue = (horse, abilityScore) => {
  if (!horse.odds?.winOdds || !horse.odds?.popularity) return 50;
  const popularity = horse.odds.popularity;
  const odds = horse.odds.winOdds;
  const gapBonus = (abilityScore - 65) * 0.45 + Math.max(0, popularity - 4) * 2.2;
  const longOddsRisk = odds > 50 ? (odds - 50) * 0.18 : 0;
  return clamp(52 + gapBonus - longOddsRisk);
};

const frameScore = (number) => {
  if (number <= 4) return 68;
  if (number <= 10) return 64;
  if (number <= 14) return 60;
  return 58;
};

const buildPedigreeAnalysis = (horse, bloodScore) => ({
  lines: [
    { role: "Sire", name: horse.pedigree?.sire ?? horse.currentRace?.sire ?? "未取得", note: "父系情報を4代血統から参照" },
    { role: "Dam", name: horse.pedigree?.dam ?? horse.currentRace?.dam ?? "未取得", note: "母系情報を4代血統から参照" },
    { role: "BMS", name: horse.pedigree?.broodmareSire ?? horse.currentRace?.broodmareSire ?? "未取得", note: "母父を補助評価に使用" },
    { role: "Family", name: horse.pedigree?.damDam ?? "未取得", note: "牝系の取得状態を確認" },
  ],
  scores: {
    course: bloodScore,
    distance: clamp(bloodScore + 2),
    going: clamp(bloodScore - 4),
    lap: clamp(bloodScore - 2),
    family: bloodScore,
    speed: clamp(bloodScore - 1),
    stamina: clamp(bloodScore + 3),
    burst: clamp(bloodScore - 3),
    sustain: clamp(bloodScore + 4),
  },
});

const confidenceFor = (horse, factors) => {
  if (horse.dataStatus?.training === "missing") return "mid";
  if (horse.pastRuns?.length >= 8 && horse.pedigree && horse.odds?.status === "active") return "high";
  return "mid";
};

const gradeForTraining = (score) => (score >= 82 ? "A" : score >= 72 ? "B" : score >= 60 ? "C" : "D");

const buildAnalysis = (horse) => {
  const displayName = horse.name ?? horse.currentRace?.horseName ?? horse.odds?.horseName ?? "対象馬";
  const displayNumber = horse.number ?? horse.currentRace?.horseNumber;
  const ability = scoreZi(horse);
  const form = scoreRecentForm(horse);
  const distance = scoreDistance(horse);
  const course = scoreCourse(horse);
  const lap = scoreLap(horse);
  const pace = scorePace(horse);
  const training = scoreTraining(horse);
  const trainingLap = training;
  const blood = scoreBlood(horse);
  const value = scoreValue(horse, ability);
  const stable = clamp(58 + (horse.trainer ? 6 : 0) + (horse.dataStatus?.training === "active" ? 6 : 0));
  const frame = frameScore(displayNumber);

  const factors = {
    ability,
    distance,
    lap,
    training,
    trainingLap,
    stable,
    frame,
    course,
    pace,
  };

  const tmIndex = clamp(
    ability * 0.28 +
      form * 0.18 +
      distance * 0.13 +
      course * 0.1 +
      training * 0.12 +
      blood * 0.09 +
      value * 0.07 +
      pace * 0.03 +
      8,
    45,
    92
  );

  const confidence = confidenceFor(horse, factors);
  const trainingStatus =
    horse.dataStatus?.training === "active"
      ? `調教データ${(horse.training?.slope?.length ?? 0) + (horse.training?.wood?.length ?? 0)}件を接続`
      : "調教データはpartialとして評価";
  const recent = horse.pastRuns?.[0];
  const recentText = recent ? `直近は${recent.course}${recent.raceName}で${recent.finishPosition}着` : "近走データは不足";
  const valueText = horse.odds?.popularity
    ? `単勝${horse.odds.winOdds}倍・${horse.odds.popularity}人気をValue評価へ反映`
    : "オッズ未取得";

  return {
    tmIndex,
    tmValue: value,
    comment: `TM INDEX v0: ${recentText}。${trainingStatus}。`,
    analysis: {
      status: "tm-index-v0",
      confidence,
      confidenceReasons: [
        `過去走${horse.pastRuns?.length ?? 0}件を参照`,
        trainingStatus,
        horse.pedigree ? "4代血統を接続済み" : "血統データ未取得",
        valueText,
      ],
      tags: [
        `ZI ${horse.odds?.zi ?? "未取得"}`,
        `人気 ${horse.odds?.popularity ?? "未取得"}`,
        horse.dataStatus?.training === "active" ? "Training active" : "Training partial",
      ],
      factors,
      factorsDetail: {
        blood: { key: "blood", label: "Blood", score: blood, maxScore: 100, status: horse.pedigree ? "active" : "missing", summary: "4代血統の取得状態と中距離向きの基礎評価" },
        training: { key: "training", label: "Training", score: training, maxScore: 100, status: horse.dataStatus?.training === "active" ? "active" : "partial", summary: trainingStatus },
        course: { key: "course", label: "Course", score: course, maxScore: 100, status: "active", summary: `${horse.currentRace?.course}${horse.currentRace?.surface}${horse.currentRace?.distance}mへの接続評価` },
        pace: { key: "pace", label: "Pace", score: pace, maxScore: 100, status: "active", summary: "近走の通過順から脚質バランスを評価" },
        stable: { key: "stable", label: "Stable", score: stable, maxScore: 100, status: "active", summary: "厩舎・調教取得状態を補助評価" },
        form: { key: "form", label: "Form", score: form, maxScore: 100, status: horse.pastRuns?.length ? "active" : "missing", summary: "近走着順と着差を中心に評価" },
        value: { key: "value", label: "Value", score: value, maxScore: 100, status: horse.odds?.status === "active" ? "active" : "missing", summary: "人気・単勝オッズと基礎能力の差を評価" },
      },
      insight: [
        `${displayName}はTM INDEX v0で${tmIndex}。${recentText}。`,
        `血統・調教・近走・オッズを分離して評価し、人気の後追いにならないようValueは補助扱いにしています。`,
        horse.dataStatus?.training === "active"
          ? trainingStatus
          : "調教データがないためTraining AIはpartialとして扱っています。",
      ],
      pros: [
        `ZI ${horse.odds?.zi ?? "未取得"}を能力評価に反映`,
        `過去走${horse.pastRuns?.length ?? 0}件をForm評価に使用`,
        horse.pedigree ? "4代血統をBlood評価に使用" : "血統データは未取得",
      ],
      cons: [
        horse.dataStatus?.training === "missing" ? "調教データが不足" : "調教評価はv0の簡易判定",
        "ペース・馬場の高度推定は次フェーズで拡張",
      ],
      commentary: `${displayName}は、能力指標・近走内容・コース距離・調教取得状態・血統・オッズ妙味を統合したTM INDEX v0で${tmIndex}と評価しました。現段階では学習モデルではなく、TARGET実データに基づく決定的な初期分析です。`,
      frameEval: {
        score: frame,
        text: `馬番${displayNumber ?? "未取得"}を補助評価に使用。枠順の高度な有利不利判定は次フェーズで拡張します。`,
      },
      trainingEval: {
        grade: gradeForTraining(training),
        oneWeek: {
          score: training,
          text: trainingStatus,
        },
        final: {
          status: horse.dataStatus?.training === "active" ? "確認済み" : "partial",
          text: horse.dataStatus?.training === "active" ? "坂路/CW等の取得データから最終追いを確認。" : "TARGET側に調教データがなく、欠損として安全に扱います。",
        },
        stablePattern: {
          match: horse.dataStatus?.training === "active",
          text: horse.trainer ? `${horse.trainer}厩舎の出走データとして接続済み。` : "厩舎情報未取得。",
        },
      },
      pedigree: buildPedigreeAnalysis(horse, blood),
      verdict: {
        status: "active",
        label: tmIndex >= 82 ? "Top Signal" : tmIndex >= 74 ? "Positive" : "Watch",
        summary: `${recentText}。${valueText}。`,
        evidence: [
          `TM INDEX v0 ${tmIndex}`,
          `Form ${form} / Training ${training} / Blood ${blood} / Value ${value}`,
          trainingStatus,
        ],
      },
      topSignal: {
        status: "active",
        label: tmIndex >= 82 ? "Top Signal" : "Signal",
        summary: `${displayName} / TM INDEX ${tmIndex}`,
      },
    },
  };
};

const buildCandidate = (normalized) => {
  const runners = normalized.horses.map((horse) => {
    const currentRace = horse.currentRace;
    const ai = buildAnalysis(horse);
    return {
      id: currentRace.raceEntryId,
      number: currentRace.horseNumber,
      name: currentRace.horseName,
      sex: currentRace.sex,
      age: currentRace.age,
      sexAge: currentRace.sexAge,
      jockey: currentRace.jockey,
      carriedWeight: currentRace.carriedWeight,
      trainer: currentRace.trainer,
      stableSide: currentRace.stableSide,
      owner: currentRace.owner,
      breeder: currentRace.breeder,
      coatColor: currentRace.coatColor,
      odds: horse.odds?.winOdds ?? null,
      popularity: horse.odds?.popularity ?? null,
      oddsDetail: horse.odds ?? null,
      tmIndex: ai.tmIndex,
      tmValue: ai.tmValue,
      comment: ai.comment,
      analysis: ai.analysis,
      currentRace,
      pastRuns: horse.pastRuns,
      training: horse.training,
      pedigree: horse.pedigree,
      dataStatus: {
        currentRace: "active",
        pastRuns: horse.pastRuns?.length ? "active" : "missing",
        training: horse.missing.includes("training") ? "missing" : "active",
        pedigree: horse.missing.includes("pedigree") ? "missing" : "active",
        odds: horse.odds ? "active" : "missing",
        intelligence: "tm-index-v0",
      },
    };
  });

  const race = normalized.source.currentRaceDetail.race;
  const oddsStatus = runners.every((horse) => horse.dataStatus.odds === "active") ? "active" : "partial";
  return {
    schemaVersion: 1,
    mode: "candidate",
    deterministicOutput: true,
    generatedAt: null,
    productionWeekDataUpdated: false,
    intelligenceLayerConnected: true,
    intelligenceStage: "tm-index-v0",
    uiConnected: true,
    meta: {
      date: race.raceDate,
      dateLabel: race.raceDate,
      venue: race.course,
      dataStatus: "odds-ready",
      source: "target-frontier-jv-current-race-detail",
      featuredRaceId: `${race.raceDate}-${race.course}-${race.raceNo}R`,
      oddsUpdatedAt: normalized.source.odds?.updatedAt ?? null,
      oddsStatus,
    },
    races: [
      {
        id: `${race.raceDate}-${race.course}-${race.raceNo}R`,
        track: race.course,
        number: race.raceNo,
        name: race.raceName,
        nameRaw: race.raceNameRaw,
        grade: race.grade,
        time: null,
        surface: race.surface,
        distance: race.distance,
        going: null,
        fieldSize: race.fieldSize,
        oddsUpdatedAt: normalized.source.odds?.updatedAt ?? null,
        oddsStatus,
        oddsSource: normalized.source.odds?.source ?? null,
        dataStatus: {
          currentRace: "active",
          pastRuns: "active",
          odds: oddsStatus,
          intelligence: "tm-index-v0",
        },
        horses: runners,
      },
    ],
    join: normalized.join,
    source: normalized.source,
  };
};

const validateCandidate = (candidate) => {
  const errors = [];
  const race = candidate.races?.[0];
  const horses = race?.horses ?? [];

  if (!race) errors.push("race is missing");
  if (horses.length !== 16) errors.push(`runners must be 16 but got ${horses.length}`);
  if (candidate.meta?.date !== "2026-07-12") errors.push(`meta.date mismatch: ${candidate.meta?.date}`);
  if (race?.track !== candidate.meta?.venue) errors.push(`track mismatch: ${race?.track}`);
  if (race?.number !== 11) errors.push(`race number mismatch: ${race?.number}`);
  if (race?.grade !== "G3") errors.push(`grade mismatch: ${race?.grade}`);
  if (!race?.surface) errors.push("surface is missing");
  if (race?.distance !== 2000) errors.push(`distance mismatch: ${race?.distance}`);

  const horseNumbers = horses.map((horse) => horse.number);
  const expected = Array.from({ length: 16 }, (_, index) => index + 1);
  if (horseNumbers.some((number, index) => number !== expected[index])) {
    errors.push(`horse numbers must be 1-16: ${horseNumbers.join(", ")}`);
  }

  const duplicateHorseNumbers = duplicates(horseNumbers);
  const duplicateHorseNames = duplicates(horses.map((horse) => normalizeHorseKey(horse.name)));
  const duplicateRaceEntryIds = duplicates(horses.map((horse) => horse.id));
  if (duplicateHorseNumbers.length) errors.push(`duplicate horse numbers: ${duplicateHorseNumbers.join(", ")}`);
  if (duplicateHorseNames.length) errors.push(`duplicate horse names: ${duplicateHorseNames.join(", ")}`);
  if (duplicateRaceEntryIds.length) errors.push(`duplicate raceEntryIds: ${duplicateRaceEntryIds.join(", ")}`);

  const pastRunCount = horses.reduce((sum, horse) => sum + (horse.pastRuns?.length ?? 0), 0);
  if (pastRunCount !== 311) errors.push(`pastRuns total must be 311 but got ${pastRunCount}`);

  const oddsJoinCount = horses.filter((horse) => horse.odds != null && horse.popularity != null).length;
  if (oddsJoinCount !== 16) errors.push(`odds join must be 16 but got ${oddsJoinCount}`);
  const indexCount = horses.filter((horse) => horse.tmIndex != null && horse.analysis?.status === "tm-index-v0").length;
  if (indexCount !== 16) errors.push(`tmIndex v0 must be 16 but got ${indexCount}`);

  for (const horse of horses) {
    for (const key of FACTOR_KEYS) {
      if (horse.analysis?.factors?.[key] == null) errors.push(`${horse.name}: factors.${key} is missing`);
    }
    if (!horse.analysis?.insight?.length) errors.push(`${horse.name}: insight is missing`);
    if (!horse.analysis?.confidenceReasons?.length) errors.push(`${horse.name}: confidenceReasons is missing`);
    if (!horse.analysis?.pedigree?.lines?.length || !horse.analysis?.pedigree?.scores) {
      errors.push(`${horse.name}: analysis.pedigree is missing`);
    }
  }

  const invalidNumbers = findInvalidNumbers(candidate);
  if (invalidNumbers.length) errors.push(`invalid numeric values: ${invalidNumbers.join(", ")}`);

  return {
    errors,
    summary: {
      runners: horses.length,
      horseNumberCount: horseNumbers.length,
      jockeyCount: horses.filter((horse) => horse.jockey).length,
      carriedWeightCount: horses.filter((horse) => horse.carriedWeight != null).length,
      trainerCount: horses.filter((horse) => horse.trainer).length,
      pastRunCount,
      pedigreeJoinCount: horses.filter((horse) => horse.dataStatus.pedigree === "active").length,
      trainingSuccessCount: horses.filter((horse) => horse.dataStatus.training === "active").length,
      trainingPartialCount: horses.filter((horse) => horse.dataStatus.training === "missing").length,
      oddsJoinCount,
      tmIndexCount: indexCount,
      topSignal: [...horses].sort((a, b) => b.tmIndex - a.tmIndex)[0]?.name,
      duplicateHorseNumberCount: duplicateHorseNumbers.length,
      duplicateHorseNameCount: duplicateHorseNames.length,
      duplicateRaceEntryIdCount: duplicateRaceEntryIds.length,
    },
  };
};

const normalized = JSON.parse(readFileSync(NORMALIZED_PATH, "utf8"));
const candidate = buildCandidate(normalized);
const validation = validateCandidate(candidate);

if (validation.errors.length) {
  validation.errors.forEach((error) => console.error(`[ERROR] ${error}`));
  process.exit(1);
}

const json = JSON.stringify(candidate, null, 2) + "\n";
writeFileSync(OUT_PATH, json);

console.log(
  JSON.stringify(
    {
      out: OUT_PATH,
      sha256: createHash("sha256").update(json).digest("hex"),
      summary: validation.summary,
    },
    null,
    2
  )
);
