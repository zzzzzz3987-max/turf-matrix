const clamp = (value, min = 35, max = 96) => Math.max(min, Math.min(max, Math.round(value)));

const normalizeName = (value) => String(value ?? "").normalize("NFKC").toLowerCase().replace(/\s+/g, "");

const LINE_RULES = [
  { label: "Kingmambo系", terms: ["kingmambo", "キングマンボ", "キングカメハメハ", "ロードカナロア"], traits: { speed: 1, power: 0.8, sustain: 0.55 } },
  { label: "Roberto系", terms: ["roberto", "ロベルト", "ブライアンズタイム", "シンボリクリスエス"], traits: { power: 1, sustain: 0.85, stamina: 0.65 } },
  { label: "欧州持続型", terms: ["sadler", "サドラー", "galileo", "ガリレオ", "monsun", "モンズン"], traits: { stamina: 1, sustain: 0.9, power: 0.6 } },
  { label: "Northern Dancer系", terms: ["northerndancer", "ノーザンダンサー", "danzig", "ダンジグ", "danehill", "デインヒル"], traits: { speed: 0.75, power: 0.65, sustain: 0.7 } },
  { label: "Sunday Silence系", terms: ["sundaysilence", "サンデーサイレンス", "ディープインパクト", "ハーツクライ"], traits: { speed: 0.8, stamina: 0.65, sustain: 0.7 } },
];

const pedigreeNames = (horse) => {
  const pedigree = horse.pedigree;
  return [
    pedigree?.sire,
    pedigree?.dam,
    pedigree?.broodmareSire,
    pedigree?.sireSire,
    pedigree?.sireDam,
    pedigree?.damSire,
    pedigree?.damDam,
    ...(pedigree?.ancestors ?? []).map((ancestor) => ancestor.name),
    horse.currentRace?.sire,
    horse.currentRace?.dam,
    horse.currentRace?.broodmareSire,
  ].filter(Boolean);
};

const matchLines = (horse) => {
  const names = pedigreeNames(horse);
  const normalized = names.map(normalizeName);
  return LINE_RULES.map((rule) => {
    const hits = names.filter((_, index) => rule.terms.some((term) => normalized[index].includes(normalizeName(term))));
    return hits.length ? { ...rule, hits: [...new Set(hits)].slice(0, 4) } : null;
  }).filter(Boolean);
};

const traitScore = (matches, context, trait) => {
  const affinity = matches.reduce((best, match) => Math.max(best, match.traits[trait] ?? 0), 0);
  return clamp(54 + affinity * 24 * (context?.traits?.[trait] ?? 0.5));
};

const scoreBlood = (horse, context) => {
  const names = pedigreeNames(horse);
  if (!names.length) return 50;
  const matches = matchLines(horse);
  const profile = ["speed", "power", "stamina", "sustain"].map((trait) => traitScore(matches, context, trait));
  const completeness = Math.min(10, names.length / 3);
  return clamp(profile.reduce((sum, value) => sum + value, 0) / profile.length + completeness);
};

const buildPedigreeAnalysis = (horse, bloodScore, context) => {
  const pedigree = horse.pedigree;
  const matches = matchLines(horse);
  const scores = {
    course: bloodScore,
    distance: bloodScore,
    going: context?.going ? bloodScore : 50,
    lap: traitScore(matches, context, "sustain"),
    family: bloodScore,
    speed: traitScore(matches, context, "speed"),
    stamina: traitScore(matches, context, "stamina"),
    burst: traitScore(matches, context, "speed"),
    sustain: traitScore(matches, context, "sustain"),
  };
  const strengths = matches.slice(0, 3).map((match) => ({
    key: match.label,
    label: match.label,
    text: `${match.hits.join("・")}を確認。${context?.profile ?? "距離条件"}への適性を評価。`,
    score: bloodScore,
  }));
  const line = (role, name, fallback) => ({ role, name: name ?? "未取得", note: name ? fallback : "血統情報は一部未取得" });
  const headline = strengths.length
    ? `${strengths.map((item) => item.label).join("・")}を確認。${context?.profile ?? "距離条件"}への適性を評価。`
    : `取得できた血統情報から${context?.profile ?? "距離条件"}への基礎適性を評価。`;

  return {
    headline,
    strengths,
    lines: [
      line("父系", pedigree?.sire ?? horse.currentRace?.sire, "スピード・持続力への影響を評価"),
      line("母系", pedigree?.dam ?? horse.currentRace?.dam, "スタミナ・底力への影響を評価"),
      line("母父", pedigree?.broodmareSire ?? horse.currentRace?.broodmareSire, "機動力と補完要素を評価"),
      line("牝系", pedigree?.damDam, "牝系の持続力と底力を評価"),
    ],
    structure: {
      ancestorCount: pedigree?.ancestors?.length ?? 0,
      completeness: pedigree?.ancestors?.length >= 28 ? "4代取得済み" : pedigree ? "一部取得" : "未取得",
    },
    raceBias: {
      score: bloodScore,
      grade: bloodScore >= 82 ? "高" : bloodScore >= 68 ? "中" : "低",
      matched: matches,
      summary: `${context?.summary ?? "レース条件未取得"} ${headline}`,
    },
    scores,
  };
};

export { scoreBlood, buildPedigreeAnalysis };
