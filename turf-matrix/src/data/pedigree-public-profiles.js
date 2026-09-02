export const PEDIGREE_PUBLIC_PROFILE_DEFINITIONS = [
  {
    id: "thunder_snow",
    names: ["サンダースノー", "Thunder Snow"],
    ancestry: ["Helmet", "Eastern Joy"],
    traits: ["スピード", "パワー", "持続力", "ダート適性"],
    summary: "父Helmetを通じたスピードに、芝1600m級の速力とダート1900〜2000mを走り切るパワー・持続力を併せ持つ構成です。",
    sourceRefs: [
      "https://www.darley.co.jp/ja/stallions/our-stallions/thunder-snow",
      "https://www.jbis.or.jp/horse/0001226963/sire/record/",
    ],
  },
];

const normalizeProfileName = (value) => String(value ?? "")
  .normalize("NFKC")
  .toLowerCase()
  .replace(/[＊*$.'’\-\s]+/g, "")
  .trim();

export const findPedigreePublicProfile = (name) => {
  const normalized = normalizeProfileName(name);
  return PEDIGREE_PUBLIC_PROFILE_DEFINITIONS.find((profile) =>
    profile.names.some((candidate) => normalizeProfileName(candidate) === normalized)
  ) ?? null;
};
