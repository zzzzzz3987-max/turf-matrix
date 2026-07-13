const clamp = (value, min = 35, max = 96) => Math.max(min, Math.min(max, Math.round(value)));

const normalizeName = (value) => String(value ?? "").normalize("NFKC").toLowerCase().replace(/\s+/g, "");

const LINE_RULES = [
  {
    label: "Kingmambo系",
    terms: ["kingmambo", "キングマンボ", "キングカメハメハ", "ロードカナロア", "ルーラーシップ"],
    traits: { speed: 0.8, power: 0.8, sustain: 0.75, stamina: 0.55 },
    note: "機動力と持続力を補強。小回りや中距離で評価しやすい血統ラインです。",
  },
  {
    label: "Roberto系",
    terms: ["roberto", "ロベルト", "ブライアンズタイム", "シンボリクリスエス", "エピファネイア"],
    traits: { power: 1, sustain: 0.9, stamina: 0.75 },
    note: "底力と持続力を補強。時計や馬場がタフになった時に評価を上げます。",
  },
  {
    label: "欧州持続型",
    terms: ["sadler", "サドラー", "galileo", "ガリレオ", "monsun", "モンズン"],
    traits: { stamina: 1, sustain: 0.95, power: 0.65 },
    note: "スタミナと持続力を補強。消耗戦や長く脚を使う展開でプラスです。",
  },
  {
    label: "Northern Dancer系",
    terms: ["northerndancer", "ノーザンダンサー", "danzig", "ダンジグ", "danehill", "デインヒル"],
    traits: { speed: 0.75, power: 0.65, sustain: 0.7 },
    note: "スピードと前向きさを補強。流れに乗る競馬で評価できます。",
  },
  {
    label: "Sunday Silence系",
    terms: ["sundaysilence", "サンデーサイレンス", "ディープインパクト", "ハーツクライ", "ステイゴールド"],
    traits: { speed: 0.78, stamina: 0.65, sustain: 0.72 },
    note: "瞬発力と持続力の土台。近走内容と合わせて評価します。",
  },
];

const TRAIT_LABELS = {
  speed: "スピード",
  power: "パワー",
  stamina: "スタミナ",
  sustain: "持続力",
};

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

const leadingTraits = (matches, context) =>
  ["speed", "power", "stamina", "sustain"]
    .map((trait) => ({ trait, label: TRAIT_LABELS[trait], score: traitScore(matches, context, trait) }))
    .sort((a, b) => b.score - a.score);

const scoreBlood = (horse, context) => {
  const names = pedigreeNames(horse);
  if (!names.length) return 50;
  const matches = matchLines(horse);
  const profile = leadingTraits(matches, context).map((item) => item.score);
  const completeness = Math.min(10, names.length / 3);
  return clamp(profile.reduce((sum, value) => sum + value, 0) / profile.length + completeness);
};

const buildLine = (role, name, note) => ({
  role,
  name: name ?? "未取得",
  note: name ? note : "血統情報は一部未取得です。",
});

const buildPedigreeAnalysis = (horse, bloodScore, context) => {
  const pedigree = horse.pedigree;
  const matches = matchLines(horse);
  const traits = leadingTraits(matches, context);
  const topTraits = traits.slice(0, 2).map((item) => item.label).join("・");
  const matchedLabels = matches.map((match) => match.label);
  const baseSummary = matches.length
    ? `${matchedLabels.slice(0, 2).join("・")}を確認。${topTraits}を今回条件の強みとして評価します。`
    : `取得済みの4代血統から、${context?.profile ?? "今回条件"}への基礎適性を評価します。`;

  const strengths = matches.slice(0, context?.depth === "full" ? 4 : 2).map((match) => ({
    key: match.label,
    label: match.label,
    text: `${match.hits.join("・")}を確認。${match.note}`,
    score: bloodScore,
  }));

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

  return {
    headline: baseSummary,
    strengths,
    lines: [
      buildLine("父系", pedigree?.sire ?? horse.currentRace?.sire, "主にスピード・持続力の土台として評価します。"),
      buildLine("母系", pedigree?.dam ?? horse.currentRace?.dam, "スタミナ・底力の補強要素として評価します。"),
      buildLine("母父", pedigree?.broodmareSire ?? horse.currentRace?.broodmareSire, "機動力と馬場適性の補助要素として評価します。"),
      buildLine("牝系", pedigree?.damDam, "牝系の持続力と底力を確認します。"),
    ],
    structure: {
      ancestorCount: pedigree?.ancestors?.length ?? 0,
      completeness: pedigree?.ancestors?.length >= 28 ? "4代取得済み" : pedigree ? "一部取得" : "未取得",
    },
    raceBias: {
      score: bloodScore,
      grade: bloodScore >= 82 ? "高" : bloodScore >= 68 ? "中" : "低",
      matched: matches,
      summary: `${context?.summary ?? "レース条件未取得"}。${baseSummary}`,
    },
    traits,
    scores,
  };
};

export { scoreBlood, buildPedigreeAnalysis };
