import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { buildBloodProfile } from "../intelligence/blood-ai.mjs";
import { buildRaceContext } from "../intelligence/race-context.mjs";
import { FEMALE_LINE_RULES } from "../intelligence/dictionaries/female-line-dictionary.mjs";
import { findCourseSireEvidence } from "../intelligence/dictionaries/course-sire-evidence.mjs";

const registrationsPath = resolve("tools/jvlink/output/week-registrations.json");
const targetsPath = resolve("tools/jvlink/output/target-horses.json");
const pedigreesPath = resolve("tools/jvlink/output/current-graded-pedigrees.json");
const outputPath = resolve("tools/jvlink/output/current-graded-blood-review.json");
const reportPath = resolve("tools/jvlink/output/current-graded-blood-review.md");

for (const inputPath of [registrationsPath, targetsPath, pedigreesPath]) {
  if (!existsSync(inputPath)) {
    console.error(`[ERROR] Required review input is missing: ${inputPath}`);
    process.exit(2);
  }
}

const readJson = (path) => JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
const registrations = readJson(registrationsPath);
const targets = readJson(targetsPath);
const pedigrees = readJson(pedigreesPath);

const COURSE_NAMES = {
  "01": "札幌",
  "02": "函館",
  "03": "福島",
  "04": "新潟",
  "05": "東京",
  "06": "中山",
  "07": "中京",
  "08": "京都",
  "09": "阪神",
  "10": "小倉",
};

const GRADE_NAMES = { A: "G1", B: "G2", C: "G3", F: "J-G1", G: "J-G2", H: "J-G3", L: "L" };
const MOJIBAKE_PATTERN = /譛|繧|隱|陦|蠑|荳|縺|逶|髯|蜿|鬥|雎|蟇/;
const surfaceFromTrackCode = (code) => {
  const value = String(code ?? "").trim();
  if (/^(1[0-9]|2[0-2])$/.test(value)) return "芝";
  if (/^2[3-9]$/.test(value)) return "ダート";
  if (/^5[1-9]$/.test(value)) return "障害";
  return null;
};
const safeRaceName = (race, course) => {
  const name = String(race.raceName ?? "").trim();
  return name && !MOJIBAKE_PATTERN.test(name) ? name : `${course}${race.raceNo}R`;
};
const raceKey = (courseCode, raceNo) => `${courseCode}|${Number(raceNo)}`;
const normalizeName = (value) => String(value ?? "").normalize("NFKC").toLowerCase().replace(/\s+/g, "");
const tailFemaleAncestors = (pedigree) => (pedigree.ancestors ?? [])
  .filter((ancestor) => /^dam(?:\.dam)*$/.test(ancestor.branch));
const matchTailFemaleRules = (pedigree) => {
  const ancestors = tailFemaleAncestors(pedigree);
  return FEMALE_LINE_RULES
    .map((rule) => {
      const hits = ancestors.filter((ancestor) =>
        rule.terms.some((term) => normalizeName(ancestor.name).includes(normalizeName(term)))
      );
      return hits.length ? { id: rule.id, label: rule.label, hits: hits.map((hit) => hit.name), fit: rule.fit } : null;
    })
    .filter(Boolean);
};

const pedigreeById = new Map(pedigrees.horses.map((horse) => [horse.bloodRegistrationNumber, horse]));
const targetByRace = new Map();
for (const target of targets.horses) {
  for (const entry of target.entries ?? []) {
    const key = raceKey(entry.courseCode, entry.raceNo);
    if (!targetByRace.has(key)) targetByRace.set(key, []);
    targetByRace.get(key).push(target);
  }
}

const races = registrations.races.map((race) => {
  const course = COURSE_NAMES[race.courseCode] ?? race.courseCode;
  const surface = surfaceFromTrackCode(race.trackCode);
  const raceName = safeRaceName(race, course);
  const grade = GRADE_NAMES[race.gradeCode] ?? null;
  const raceData = {
    id: race.raceKey,
    raceDate: race.raceDate,
    course,
    raceNo: race.raceNo,
    raceName,
    grade,
    surface,
    distance: Number(race.distance),
    weather: null,
    going: null,
  };
  const context = buildRaceContext(raceData);
  const horses = (targetByRace.get(raceKey(race.courseCode, race.raceNo)) ?? []).map((target) => {
    const pedigree = pedigreeById.get(target.bloodRegistrationNumber);
    if (!pedigree || pedigree.status !== "active") {
      return {
        bloodRegistrationNumber: target.bloodRegistrationNumber,
        horseName: target.horseName,
        status: "missing",
      };
    }
    const horse = {
      name: target.horseName,
      horseName: target.horseName,
      pedigree,
      currentRace: { ...raceData, horseName: target.horseName },
    };
    const profile = buildBloodProfile(horse, context);
    const directFemaleLine = tailFemaleAncestors(pedigree);
    const matchedTailFemaleLines = matchTailFemaleRules(pedigree);
    const courseSireEvidence = findCourseSireEvidence({ ...raceData, sire: pedigree.sire });
    return {
      bloodRegistrationNumber: target.bloodRegistrationNumber,
      horseName: target.horseName,
      status: profile.status,
      confidence: profile.confidence,
      coverage: profile.coverage,
      score: profile.score,
      displayScore: profile.displayScore,
      contributionDiagnostics: profile.contributionDiagnostics,
      components: profile.components,
      pedigree: {
        sire: pedigree.sire,
        sireSire: pedigree.sireSire,
        sireDam: pedigree.sireDam,
        dam: pedigree.dam,
        broodmareSire: pedigree.broodmareSire,
        damDam: pedigree.damDam,
      },
      matchedLines: profile.matches.map((match) => ({
        id: match.id,
        label: match.label,
        roles: match.roles,
        hits: match.hits,
        fit: match.fit,
        courseMatched: profile.courseMatches.some((candidate) => candidate.id === match.id),
        courseMatchStrength: match.courseMatchStrength ?? 0,
      })),
      matchedMaternalRules: profile.femaleMatches.map((match) => ({
        id: match.id,
        label: match.label,
        roles: match.roles,
        hits: match.hits,
        fit: match.fit,
        courseMatched: profile.femaleCourseMatches.some((candidate) => candidate.id === match.id),
        courseMatchStrength: match.courseMatchStrength ?? 0,
      })),
      backgroundRules: profile.backgroundMatches.map((match) => ({
        id: match.id,
        label: match.label,
        roles: match.roles,
        hits: match.hits,
        reason: match.reason,
        signal: match.signal,
      })),
      directFemaleLine,
      matchedTailFemaleLines,
      statistics: profile.statistics.map((statistic) => ({
        entityType: statistic.entityType,
        name: statistic.name,
        scope: statistic.scope,
        sampleSize: statistic.sampleSize,
        uniqueHorseCount: statistic.uniqueHorseCount,
        winRate: statistic.winRate,
        hitRate: statistic.hitRate,
        adjustment: statistic.adjustment,
      })),
      statisticsAdjustment: profile.statisticsAdjustment,
      statisticsApplied: profile.statisticsApplied,
      courseSireEvidence,
      sourceUrl: pedigree.sourceUrl,
    };
  }).sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.horseName.localeCompare(b.horseName, "ja"));
  return {
    ...raceData,
    registrationCount: race.registrationCount,
    targetTraits: context.traits,
    bloodBias: context.bloodBias,
    bloodFitTags: context.bloodFitTags,
    bloodMajorTags: context.bloodMajorTags,
    horseCount: horses.length,
    horses,
  };
});

const output = {
  schemaVersion: 1,
  status: "review-only",
  sourceDate: registrations.raceDate,
  generatedAt: new Date().toISOString(),
  productionWeekDataUpdated: false,
  sourcePaths: { registrationsPath, targetsPath, pedigreesPath },
  raceCount: races.length,
  horseCount: races.reduce((sum, race) => sum + race.horseCount, 0),
  activeCount: races.flatMap((race) => race.horses).filter((horse) => horse.status !== "missing").length,
  races,
};

const formatRate = (value) => Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "--";
const lines = [
  `# 今週重賞 血統レビュー候補 (${output.sourceDate})`,
  "",
  "> レビュー専用です。TM INDEX、Blood AI本番値、week-data.jsonには自動反映しません。",
  "",
  `- 対象: ${output.raceCount}レース / ${output.horseCount}頭`,
  `- 血統取得: ${output.activeCount}/${output.horseCount}頭`,
  "- 入力: 父・父父・父母・母・母父・母母",
  "- 評価: 父系 / 母系 / 直系牝系 / コース / 距離 / 配合 / 蓄積統計を分離",
  "- 注記: 現行Blood AIのfemaleMatchesは母側全般です。本レポートでは母母を遡る直系牝系を別欄で監査します。",
  "",
];

for (const race of races) {
  lines.push(
    `## ${race.course}${race.raceNo}R ${race.raceName} ${race.grade ?? ""}`.trim(),
    "",
    `- 条件: ${race.surface ?? "未取得"}${race.distance}m`,
    `- 対象特性: ${Object.entries(race.targetTraits).map(([key, value]) => `${key} ${Number(value).toFixed(2)}`).join(" / ")}`,
    `- コース血統条件: ${(race.bloodFitTags ?? []).join(" / ") || "辞書条件なし"}`,
    "",
    "| 馬 | Blood候補 | 父系 | 母系 | Course | Distance | Confidence | 主な照合 | 直系牝系 | コース種牡馬実績 | 蓄積統計 |",
    "|---|---:|---:|---:|---:|---:|---|---|---|---|---|",
  );
  for (const horse of race.horses) {
    const matches = [...(horse.matchedLines ?? []), ...(horse.matchedMaternalRules ?? [])]
      .map((match) => `${match.label}${match.courseMatched ? "*" : ""}`)
      .join(" / ") || "辞書照合なし";
    const statistics = (horse.statistics ?? [])
      .map((item) => `${item.name} n=${item.sampleSize}/${item.uniqueHorseCount}頭 複勝${formatRate(item.hitRate)}`)
      .join("<br>") || "有効統計なし";
    const femaleLine = (horse.directFemaleLine ?? []).map((ancestor) => ancestor.name).join(" → ") || "未取得";
    const femaleMatch = (horse.matchedTailFemaleLines ?? []).map((match) => match.label).join(" / ");
    const sireEvidence = horse.courseSireEvidence
      ? `${horse.courseSireEvidence.sire} ${horse.courseSireEvidence.starts}走 勝率${formatRate(horse.courseSireEvidence.winRate)} 複勝${formatRate(horse.courseSireEvidence.hitRate)}`
      : "有効統計なし";
    lines.push(`| ${horse.horseName} | ${horse.score ?? "--"} | ${horse.components?.paternal ?? "--"} | ${horse.components?.maternal ?? "--"} | ${horse.components?.course ?? "--"} | ${horse.components?.distance ?? "--"} | ${horse.confidence ?? "low"} | ${matches} | ${femaleLine}${femaleMatch ? `<br>${femaleMatch}` : "<br>辞書未照合"} | ${sireEvidence} | ${statistics} |`);
  }
  lines.push("");
}

mkdirSync(dirname(outputPath), { recursive: true });
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
writeFileSync(reportPath, `${lines.join("\n")}\n`, "utf8");

console.log(JSON.stringify({
  output: outputPath,
  report: reportPath,
  raceCount: output.raceCount,
  horseCount: output.horseCount,
  activeCount: output.activeCount,
  perRace: races.map((race) => ({
    race: `${race.course}${race.raceNo}R ${race.raceName}`,
    horses: race.horseCount,
    top: race.horses.slice(0, 5).map((horse) => `${horse.horseName}:${horse.score ?? "--"}`),
    lowConfidence: race.horses.filter((horse) => horse.confidence === "low").length,
  })),
}, null, 2));
