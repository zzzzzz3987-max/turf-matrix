const normalizeSireName = (value) =>
  String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[＊*$.'’\-\s]+/g, "")
    .trim();

const SIRE_PROFILES = [
  {
    id: "saturnalia",
    names: ["サートゥルナーリア", "Saturnalia"],
    ancestry: ["ロードカナロア", "シーザリオ"],
    traits: ["切れ味", "スピード", "中距離性能"],
    summary: "ロードカナロア由来のスピードに、シーザリオ牝系の切れ味と中距離性能を重ねる構成です。",
    sourceType: "curated_knowledge",
    scoreApplied: false,
  },
];

const findSireProfile = (name) => {
  const normalized = normalizeSireName(name);
  return SIRE_PROFILES.find((profile) =>
    profile.names.some((candidate) => normalizeSireName(candidate) === normalized)
  ) ?? null;
};

export { SIRE_PROFILES, findSireProfile, normalizeSireName };
