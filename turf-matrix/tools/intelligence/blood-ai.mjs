import { RACE_DAY_CONDITION } from "./constants.mjs";

const clamp = (value, min = 35, max = 96) => Math.max(min, Math.min(max, Math.round(value)));

const namesByBranches = (pedigree, branches) => {
  const byBranch = new Map((pedigree?.ancestors ?? []).map((ancestor) => [ancestor.branch, ancestor.name]));
  return branches.map((branch) => byBranch.get(branch)).filter(Boolean);
};

const scoreLabel = (score) => (score >= 86 ? "強み" : score >= 76 ? "標準以上" : "補助材料");

const normalizeBloodName = (value) =>
  String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, "");

const bloodNamePool = (pedigree) => {
  if (!pedigree) return [];
  return [
    pedigree.sire,
    pedigree.dam,
    pedigree.broodmareSire,
    pedigree.sireSire,
    pedigree.sireDam,
    pedigree.damSire,
    pedigree.damDam,
    ...(pedigree.ancestors ?? []).map((ancestor) => ancestor.name),
  ]
    .filter(Boolean)
    .map((name) => ({ raw: name, normalized: normalizeBloodName(name) }));
};

const bloodlineRules = [
  {
    key: "kingmambo",
    label: "キングマンボ内包",
    weight: 14,
    terms: ["kingmambo", "キングマンボ", "キングカメハメハ", "kingkamehameha", "ロードカナロア", "ルーラーシップ", "ドゥラメンテ", "レイデオロ", "ラブリーデイ"],
    text: "福島芝2000mで必要な馬力と持続スピードを補強",
  },
  {
    key: "european",
    label: "欧州スタミナ",
    weight: 9,
    terms: ["sadler", "サドラー", "nureyev", "ヌレイエフ", "tonybin", "トニービン", "galileo", "ガリレオ", "danehill", "デインヒル", "monsun", "モンズン"],
    text: "稍重で最後まで脚を使うスタミナを補助",
  },
  {
    key: "bottomPower",
    label: "底力",
    weight: 8,
    terms: ["ribot", "リボー", "graustark", "グロースターク", "hismajesty", "ヒズマジェスティ", "roberto", "ロベルト", "ブライアンズタイム", "シンボリクリスエス", "モーリス", "スクリーンヒーロー"],
    text: "早めに動いて踏ん張る競馬への耐性を評価",
  },
  {
    key: "staminaFamily",
    label: "持続スタミナ",
    weight: 6,
    terms: ["ステイゴールド", "オルフェーヴル", "ゴールドシップ", "ハーツクライ", "ジャングルポケット"],
    text: "小回り中距離で長く脚を使う土台を確認",
  },
];

const buildRaceBiasMatch = (pedigree) => {
  const pool = bloodNamePool(pedigree);
  if (!pool.length) {
    return {
      score: 50,
      grade: "未取得",
      matched: [],
      summary: "血統データ未取得のため、七夕賞適合は参考外",
    };
  }

  const matched = bloodlineRules
    .map((rule) => {
      const hits = pool
        .filter((name) => rule.terms.some((term) => name.normalized.includes(normalizeBloodName(term))))
        .map((name) => name.raw);
      return hits.length ? {
        key: rule.key,
        label: rule.label,
        weight: rule.weight,
        text: rule.text,
        hits: [...new Set(hits)].slice(0, 4),
      } : null;
    })
    .filter(Boolean);

  const score = clamp(56 + matched.reduce((sum, item) => sum + item.weight, 0), 45, 94);
  const grade = score >= 82 ? "高" : score >= 68 ? "中" : "低";
  const summary = matched.length
    ? `${matched.map((item) => item.label).join("・")}を確認。${RACE_DAY_CONDITION.summary}`
    : `強い七夕賞血統バイアスは限定的。${RACE_DAY_CONDITION.summary}`;

  return { score, grade, matched, summary };
};

const buildBloodStrengths = (scores) => {
  const candidates = [
    { key: "stamina", label: "スタミナ補強", text: "中距離で最後まで脚を使う土台" },
    { key: "sustain", label: "持続力", text: "長く脚を使う流れへの対応力" },
    { key: "speed", label: "スピード", text: "位置を取りにいく基礎スピード" },
    { key: "burst", label: "瞬発力", text: "直線で反応する加速性能" },
    { key: "family", label: "底力", text: "牝系から見る踏ん張りの裏付け" },
  ];

  return candidates
    .map((item) => ({ ...item, score: scores[item.key] }))
    .filter((item) => typeof item.score === "number")
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
};

const buildPedigreeAnalysis = (horse, bloodScore) => {
  const pedigree = horse.pedigree;
  const raceBias = buildRaceBiasMatch(pedigree);
  const sireLine = [
    pedigree?.sire,
    pedigree?.sireSire,
    ...namesByBranches(pedigree, ["sire.sire.sire", "sire.sire.sire.sire"]),
  ].filter(Boolean);
  const damLine = [
    pedigree?.dam,
    pedigree?.damSire,
    ...namesByBranches(pedigree, ["dam.sire.sire", "dam.sire.sire.sire"]),
  ].filter(Boolean);
  const bmsLine = [
    pedigree?.broodmareSire,
    ...namesByBranches(pedigree, ["dam.sire.sire", "dam.sire.sire.sire", "dam.sire.dam"]),
  ].filter(Boolean);
  const familyLine = [
    pedigree?.damDam,
    ...namesByBranches(pedigree, ["dam.dam.sire", "dam.dam.sire.sire", "dam.dam.dam"]),
  ].filter(Boolean);
  const ancestorCount = pedigree?.ancestors?.length ?? 0;
  const scores = {
    course: bloodScore,
    distance: clamp(bloodScore + 2),
    going: clamp(bloodScore + 3),
    lap: clamp(bloodScore - 2),
    family: bloodScore,
    speed: clamp(bloodScore - 1),
    stamina: clamp(bloodScore + 3),
    burst: clamp(bloodScore - 3),
    sustain: clamp(bloodScore + 4),
  };
  const strengths = [
    {
      key: "raceBias",
      label: `七夕賞適合 ${raceBias.grade}`,
      text: raceBias.summary,
      score: raceBias.score,
    },
    ...buildBloodStrengths(scores),
  ].slice(0, 4);
  const headline = strengths.length
    ? `${raceBias.grade !== "低" ? "七夕賞血統バイアスに合致" : "血統バイアスは補助評価"}。${strengths.slice(1, 3).map((item) => item.label).join("・")}を確認`
    : "4代血統の取得状態を確認";

  return {
    headline,
    strengths,
    lines: [
      {
        role: "父系",
        name: pedigree?.sire ?? horse.currentRace?.sire ?? "未取得",
        note: sireLine.length >= 3 ? `${sireLine.slice(0, 3).join(" → ")} からスピードと持続力の土台を確認` : "父系情報を4代血統から参照",
      },
      {
        role: "母系",
        name: pedigree?.dam ?? horse.currentRace?.dam ?? "未取得",
        note: damLine.length >= 3 ? `${damLine.slice(0, 3).join(" → ")} から底力と距離耐性を確認` : "母系情報を4代血統から参照",
      },
      {
        role: "母父",
        name: pedigree?.broodmareSire ?? horse.currentRace?.broodmareSire ?? "未取得",
        note: bmsLine.length >= 2 ? `${bmsLine.slice(0, 3).join(" → ")} から瞬発力と機動力を補助評価` : "母父を補助評価に使用",
      },
      {
        role: "牝系",
        name: pedigree?.damDam ?? "未取得",
        note: familyLine.length >= 2 ? `${familyLine.slice(0, 3).join(" → ")} からスタミナと底力の補強を確認` : "牝系の取得状態を確認",
      },
    ],
    structure: {
      ancestorCount,
      sireLine,
      damLine,
      bmsLine,
      familyLine,
      completeness: ancestorCount >= 28 ? "4代取得済み" : ancestorCount >= 20 ? "一部取得" : "取得不足",
    },
    raceBias,
    scores,
  };
};

const scoreBlood = (horse) => {
  const pedigree = horse.pedigree;
  if (!pedigree) return 50;
  const ancestorCount = pedigree.ancestors?.length ?? 0;
  const base = 60 + Math.min(18, ancestorCount * 0.6);
  const completeness = [pedigree.sire, pedigree.dam, pedigree.broodmareSire, pedigree.sireSire, pedigree.damDam].filter(Boolean).length;
  const raceBias = buildRaceBiasMatch(pedigree);
  return clamp(base + completeness * 2 + Math.max(0, (raceBias.score - 64) * 0.35));
};

export { scoreBlood, buildPedigreeAnalysis };
