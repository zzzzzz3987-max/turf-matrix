const COURSE_SIRE_EVIDENCE = [
  {
    key: "niigata_turf_1000",
    course: "新潟",
    surface: "芝",
    distance: 1000,
    sourceUrl: "https://keiba-course.com/course/niigata-turf-1000/",
    sires: {
      "ビッグアーサー": { wins: 5, seconds: 4, thirds: 1, losses: 24, winRate: 0.147, hitRate: 0.294, winReturn: 87, placeReturn: 56 },
      "アジアエクスプレス": { wins: 5, seconds: 0, thirds: 0, losses: 16, winRate: 0.238, hitRate: 0.238, winReturn: 434, placeReturn: 110 },
      "ディスクリートキャット": { wins: 4, seconds: 1, thirds: 1, losses: 25, winRate: 0.129, hitRate: 0.194, winReturn: 158, placeReturn: 71 },
      "フォーウィールドライブ": { wins: 3, seconds: 1, thirds: 2, losses: 5, winRate: 0.273, hitRate: 0.545, winReturn: 172, placeReturn: 101 },
      "ロードカナロア": { wins: 3, seconds: 1, thirds: 7, losses: 32, winRate: 0.07, hitRate: 0.256, winReturn: 92, placeReturn: 96 },
      "イスラボニータ": { wins: 2, seconds: 3, thirds: 0, losses: 13, winRate: 0.111, hitRate: 0.278, winReturn: 216, placeReturn: 113 },
      "アルアイン": { wins: 2, seconds: 1, thirds: 4, losses: 6, winRate: 0.154, hitRate: 0.538, winReturn: 66, placeReturn: 95 },
      "アメリカンペイトリオット": { wins: 2, seconds: 1, thirds: 2, losses: 16, winRate: 0.095, hitRate: 0.238, winReturn: 50, placeReturn: 58 },
    },
  },
  {
    key: "sapporo_turf_1800",
    course: "札幌",
    surface: "芝",
    distance: 1800,
    sourceUrl: "https://keiba-course.com/course/sapporo-turf-1800/",
    sires: {
      "ドゥラメンテ": { wins: 9, seconds: 0, thirds: 3, losses: 11, winRate: 0.391, hitRate: 0.522, winReturn: 206, placeReturn: 93 },
      "キズナ": { wins: 4, seconds: 3, thirds: 2, losses: 20, winRate: 0.138, hitRate: 0.31, winReturn: 74, placeReturn: 55 },
      "キタサンブラック": { wins: 3, seconds: 5, thirds: 2, losses: 9, winRate: 0.158, hitRate: 0.526, winReturn: 108, placeReturn: 154 },
      "ロードカナロア": { wins: 3, seconds: 4, thirds: 3, losses: 19, winRate: 0.103, hitRate: 0.345, winReturn: 20, placeReturn: 83 },
      "ダノンバラード": { wins: 2, seconds: 4, thirds: 5, losses: 13, winRate: 0.083, hitRate: 0.458, winReturn: 50, placeReturn: 117 },
      "エピファネイア": { wins: 2, seconds: 3, thirds: 4, losses: 17, winRate: 0.077, hitRate: 0.346, winReturn: 16, placeReturn: 69 },
      "スクリーンヒーロー": { wins: 2, seconds: 3, thirds: 0, losses: 2, winRate: 0.286, hitRate: 0.714, winReturn: 160, placeReturn: 138 },
      "ゴールドシップ": { wins: 2, seconds: 1, thirds: 6, losses: 17, winRate: 0.077, hitRate: 0.346, winReturn: 54, placeReturn: 158 },
      "サートゥルナーリア": { wins: 2, seconds: 0, thirds: 3, losses: 7, winRate: 0.167, hitRate: 0.417, winReturn: 45, placeReturn: 35 },
    },
  },
];

const normalize = (value) => String(value ?? "").normalize("NFKC").toLowerCase().replace(/\s+/g, "");

const findCourseSireEvidence = ({ course, surface, distance, sire }) => {
  const profile = COURSE_SIRE_EVIDENCE.find((candidate) =>
    candidate.course === course && candidate.surface === surface && candidate.distance === Number(distance)
  );
  if (!profile || !sire) return null;
  const entry = Object.entries(profile.sires).find(([name]) => normalize(name) === normalize(sire));
  if (!entry) return null;
  const [name, statistic] = entry;
  return {
    key: profile.key,
    sire: name,
    starts: statistic.wins + statistic.seconds + statistic.thirds + statistic.losses,
    ...statistic,
    sourceUrl: profile.sourceUrl,
    status: "reference-only",
  };
};

export { COURSE_SIRE_EVIDENCE, findCourseSireEvidence };
