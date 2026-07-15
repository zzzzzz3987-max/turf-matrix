const COURSE_GROUPS = {
  small: ["福島", "小倉", "函館", "札幌"],
  wide: ["東京", "新潟"],
  steep: ["中山", "中京", "阪神"],
  flat: ["京都", "小倉", "函館", "札幌", "新潟"],
};

const COURSE_BIAS_PROFILES = [
  {
    key: "fukushima_turf_2000",
    course: "福島",
    surface: "芝",
    distance: 2000,
    label: "福島芝2000m",
    sourceRefs: ["https://keiba-course.com/course/fukushima-turf-2000/"],
    summary: "短い直線の小回りコース。細かなアップダウンと直線の緩坂があり、見た目以上にスタミナと持続力を要求します。",
    shape: { turn: "right", layout: "small", corners: 4, straight: "short", hill: "mild", firstCorner: "long" },
    traits: { speed: 0.5, power: 0.82, stamina: 0.92, sustain: 1 },
    styleBias: ["先行", "早め差し", "持続型"],
    bloodBias: ["Kingmambo系", "Roberto系", "欧州スタミナ系"],
    bloodBiasIds: ["kingmambo", "roberto", "european_stamina", "stay_gold", "heart_cry"],
    bloodFitTags: ["小回り", "中距離", "持続戦", "消耗戦", "パワー", "スタミナ", "底力"],
    caution: ["開催後半は外差し寄りになる可能性", "瞬発力だけのタイプは割引"],
  },
  {
    key: "kokura_turf_2000",
    course: "小倉",
    surface: "芝",
    distance: 2000,
    label: "小倉芝2000m",
    sourceRefs: ["https://keiba-course.com/course/kokura-turf-2000/"],
    summary: "小回りで平坦、直線が短いコース。スタートから1角まで長く、コーナー4つの器用さと高速馬場への対応を評価します。",
    shape: { turn: "right", layout: "small", corners: 4, straight: "short", hill: "flat", firstCorner: "long" },
    traits: { speed: 0.82, power: 0.68, stamina: 0.72, sustain: 0.86 },
    styleBias: ["先行", "立ち回り型", "スピード持続型"],
    bloodBias: ["Sunday Silence系", "Kingmambo系", "Northern Dancer系"],
    bloodBiasIds: ["sunday_silence", "deep_impact", "kingmambo", "mr_prospector", "northern_dancer"],
    bloodFitTags: ["小回り", "平坦", "高速馬場", "先行", "立ち回り", "機動力"],
    caution: ["差し馬は位置取りと機動力が必要", "外を回し続けるタイプはロスに注意"],
  },
  {
    key: "hakodate_turf_2000",
    course: "函館",
    surface: "芝",
    distance: 2000,
    label: "函館芝2000m",
    sourceRefs: ["https://keiba-course.com/course/hakodate-turf-2000/"],
    summary: "洋芝、短い直線、平坦寄りの小回り。時計が掛かりやすく、パワーとスタミナ、持続力を重視します。",
    shape: { turn: "right", layout: "small", corners: 4, straight: "very_short", hill: "flat", turf: "european" },
    traits: { speed: 0.45, power: 0.95, stamina: 0.9, sustain: 0.88 },
    styleBias: ["先行", "パワー型", "持続型"],
    bloodBias: ["Roberto系", "欧州スタミナ系", "Northern Dancer系"],
    bloodBiasIds: ["roberto", "european_stamina", "harbinger", "danzig", "stay_gold"],
    bloodFitTags: ["洋芝", "パワー", "スタミナ", "持続戦", "道悪", "先行"],
    caution: ["軽い瞬発力タイプは過信しない", "洋芝適性を重視"],
  },
  {
    key: "sapporo_turf_2000",
    course: "札幌",
    surface: "芝",
    distance: 2000,
    label: "札幌芝2000m",
    sourceRefs: ["https://keiba-course.com/course/sapporo-turf-2000/"],
    summary: "平坦な小回りで直線が短い洋芝コース。立ち回り、パワー、持続力を重視します。",
    shape: { turn: "right", layout: "small", corners: 4, straight: "short", hill: "flat", turf: "european" },
    traits: { speed: 0.55, power: 0.9, stamina: 0.82, sustain: 0.85 },
    styleBias: ["先行", "立ち回り型", "パワー型"],
    bloodBias: ["Roberto系", "欧州スタミナ系", "Kingmambo系"],
    bloodBiasIds: ["roberto", "european_stamina", "harbinger", "kingmambo", "danzig"],
    bloodFitTags: ["洋芝", "小回り", "パワー", "持続戦", "立ち回り", "スタミナ"],
    caution: ["直線一気は割引", "洋芝と小回りの両対応を確認"],
  },
  {
    key: "chukyo_turf_2000",
    course: "中京",
    surface: "芝",
    distance: 2000,
    label: "中京芝2000m",
    sourceRefs: ["https://keiba-course.com/course/chukyo-turf-2000/"],
    summary: "左回りで直線が長く、急坂を含むパワー型コース。持続力と坂をこなす底力を評価します。",
    shape: { turn: "left", layout: "wide", corners: 4, straight: "long", hill: "steep", firstCorner: "normal" },
    traits: { speed: 0.58, power: 0.95, stamina: 0.85, sustain: 0.9 },
    styleBias: ["差し", "持続型", "坂対応型"],
    bloodBias: ["Roberto系", "欧州スタミナ系", "Sunday Silence系"],
    bloodBiasIds: ["roberto", "european_stamina", "stay_gold", "heart_cry", "sunday_silence"],
    bloodFitTags: ["急坂", "パワー", "持続戦", "底力", "スタミナ", "差し"],
    caution: ["平坦巧者は坂対応を確認", "内で窮屈になるタイプは注意"],
  },
  {
    key: "kyoto_turf_2000",
    course: "京都",
    surface: "芝",
    distance: 2000,
    label: "京都芝2000m",
    sourceRefs: ["https://keiba-course.com/course/kyoto-turf-2000/"],
    summary: "内回りで3コーナーの坂から下りでペースアップしやすい。器用さ、スピード、瞬発力を評価します。",
    shape: { turn: "right", layout: "inner", corners: 4, straight: "medium_short", hill: "third_corner", firstCorner: "normal" },
    traits: { speed: 0.88, power: 0.58, stamina: 0.68, sustain: 0.78 },
    styleBias: ["先行", "機動力型", "瞬発型"],
    bloodBias: ["Sunday Silence系", "Kingmambo系", "Northern Dancer系"],
    bloodBiasIds: ["sunday_silence", "deep_impact", "kingmambo", "northern_dancer", "mr_prospector"],
    bloodFitTags: ["平坦", "瞬発力", "トップスピード", "機動力", "先行", "高速馬場"],
    caution: ["下りで動けないタイプは割引", "重い馬場では評価を補正"],
  },
  {
    key: "niigata_turf_2000_outer",
    course: "新潟",
    surface: "芝",
    distance: 2000,
    layout: "外",
    label: "新潟芝2000m外",
    sourceRefs: ["https://keiba-course.com/course/niigata-turf-2000-out/"],
    summary: "日本最長級の直線を持つ外回り。高速馬場でスピードと瞬発力、長い直線で脚を使える能力を評価します。",
    shape: { turn: "left", layout: "outer", corners: 2, straight: "very_long", hill: "mostly_flat", firstCorner: "very_long" },
    traits: { speed: 0.95, power: 0.45, stamina: 0.62, sustain: 0.78 },
    styleBias: ["差し", "追込", "瞬発型"],
    bloodBias: ["Sunday Silence系", "Roberto系", "Kingmambo系"],
    bloodBiasIds: ["deep_impact", "sunday_silence", "grey_sovereign", "heart_cry", "kingmambo"],
    bloodFitTags: ["長い直線", "高速馬場", "瞬発力", "トップスピード", "差し", "中距離"],
    caution: ["小回り向きの立ち回り型は割引", "長い直線で脚を使えるか確認"],
  },
  {
    key: "niigata_turf_2000_inner",
    course: "新潟",
    surface: "芝",
    distance: 2000,
    layout: "内",
    label: "新潟芝2000m内",
    sourceRefs: ["https://keiba-course.com/course/niigata-turf-2000-in/"],
    summary: "平坦な内回りで直線は外回りほど長くない。高速馬場への対応と先行力、立ち回りを評価します。",
    shape: { turn: "left", layout: "inner", corners: 4, straight: "medium", hill: "flat", firstCorner: "long" },
    traits: { speed: 0.88, power: 0.55, stamina: 0.68, sustain: 0.8 },
    styleBias: ["逃げ", "先行", "立ち回り型"],
    bloodBias: ["Sunday Silence系", "Kingmambo系", "Roberto系"],
    bloodBiasIds: ["sunday_silence", "kingmambo", "mr_prospector", "northern_dancer", "roberto"],
    bloodFitTags: ["平坦", "高速馬場", "先行", "立ち回り", "機動力", "小回り"],
    caution: ["外回り向きの末脚一辺倒は割引", "内回りの位置取りを確認"],
  },
  {
    key: "nakayama_turf_2000",
    course: "中山",
    surface: "芝",
    distance: 2000,
    label: "中山芝2000m",
    sourceRefs: ["https://keiba-course.com/course/nakayama-turf-2000/"],
    summary: "内回りでコーナー4つ、急坂と高低差があるコース。器用さ、パワー、持続力を評価します。",
    shape: { turn: "right", layout: "inner", corners: 4, straight: "short", hill: "steep", firstCorner: "long" },
    traits: { speed: 0.65, power: 0.95, stamina: 0.82, sustain: 0.86 },
    styleBias: ["先行", "機動力型", "持続型"],
    bloodBias: ["Roberto系", "Kingmambo系", "Sunday Silence系"],
    bloodBiasIds: ["roberto", "kingmambo", "stay_gold", "heart_cry", "sunday_silence"],
    bloodFitTags: ["急坂", "小回り", "パワー", "持続戦", "底力", "中距離"],
    caution: ["坂で止まるタイプは割引", "外を回しすぎる差し馬は注意"],
  },
];

const courseGroup = (course) => {
  if (COURSE_GROUPS.small.includes(course)) return "small";
  if (COURSE_GROUPS.wide.includes(course)) return "wide";
  if (COURSE_GROUPS.steep.includes(course)) return "steep";
  return "standard";
};

const matchesProfile = (profile, race) => {
  const distance = Number(race?.distance) || 0;
  if (profile.course && profile.course !== race?.course && profile.course !== race?.track) return false;
  if (profile.surface && profile.surface !== race?.surface) return false;
  if (profile.distance && Number(profile.distance) !== distance) return false;
  if (profile.minDistance && distance < profile.minDistance) return false;
  if (profile.maxDistance && distance > profile.maxDistance) return false;
  if (profile.layout && race?.layout && profile.layout !== race.layout) return false;
  return true;
};

const findCourseBias = (race) => COURSE_BIAS_PROFILES.find((profile) => matchesProfile(profile, race)) ?? null;

export { COURSE_GROUPS, COURSE_BIAS_PROFILES, courseGroup, findCourseBias };
