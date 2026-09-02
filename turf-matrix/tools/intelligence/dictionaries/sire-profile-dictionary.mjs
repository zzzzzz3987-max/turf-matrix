import { PEDIGREE_PUBLIC_PROFILE_DEFINITIONS } from "../../../src/data/pedigree-public-profiles.js";

const normalizeSireName = (value) =>
  String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[＊*$.'’\-\s]+/g, "")
    .trim();

const PROFILE_TRAIT_VECTORS = {
  "切れ味": { speed: 0.96, power: 0.45, stamina: 0.55, sustain: 0.68 },
  "トップスピード": { speed: 1, power: 0.5, stamina: 0.35, sustain: 0.62 },
  "スピード": { speed: 0.95, power: 0.58, stamina: 0.4, sustain: 0.64 },
  "先行力": { speed: 0.92, power: 0.75, stamina: 0.42, sustain: 0.7 },
  "機動力": { speed: 0.84, power: 0.72, stamina: 0.5, sustain: 0.76 },
  "パワー": { speed: 0.62, power: 0.98, stamina: 0.66, sustain: 0.78 },
  "持続力": { speed: 0.65, power: 0.72, stamina: 0.74, sustain: 0.98 },
  "スタミナ": { speed: 0.42, power: 0.7, stamina: 1, sustain: 0.9 },
  "短距離適性": { speed: 0.98, power: 0.72, stamina: 0.3, sustain: 0.62 },
  "マイル適性": { speed: 0.88, power: 0.68, stamina: 0.55, sustain: 0.78 },
  "中距離性能": { speed: 0.65, power: 0.7, stamina: 0.84, sustain: 0.94 },
  "長距離適性": { speed: 0.42, power: 0.68, stamina: 1, sustain: 0.94 },
  "道悪対応": { speed: 0.52, power: 0.98, stamina: 0.78, sustain: 0.88 },
  "芝適性": { speed: 0.82, power: 0.58, stamina: 0.65, sustain: 0.8 },
  "ダート適性": { speed: 0.72, power: 0.96, stamina: 0.58, sustain: 0.78 },
  "洋芝適性": { speed: 0.58, power: 0.94, stamina: 0.82, sustain: 0.9 },
  "欧州適性": { speed: 0.52, power: 0.82, stamina: 0.92, sustain: 0.94 },
};

const buildProfileTraitVector = (traits) => {
  const vectors = (traits ?? []).map((trait) => PROFILE_TRAIT_VECTORS[trait]).filter(Boolean);
  if (!vectors.length) return null;
  return Object.fromEntries(["speed", "power", "stamina", "sustain"].map((key) => [
    key,
    Number((vectors.reduce((sum, vector) => sum + vector[key], 0) / vectors.length).toFixed(4)),
  ]));
};

const profile = (id, names, ancestry, traits, summary, options = {}) => ({
  id,
  names,
  ancestry,
  traits,
  traitVector: buildProfileTraitVector(traits),
  summary,
  sourceType: options.sourceType ?? "curated_pedigree_knowledge",
  ...(options.sourceRefs?.length ? { sourceRefs: options.sourceRefs } : {}),
  scoreApplied: true,
});

const BASE_SIRE_PROFILES = [
  profile("saturnalia", ["サートゥルナーリア", "Saturnalia"], ["ロードカナロア", "シーザリオ"], ["切れ味", "スピード", "中距離性能"], "ロードカナロア由来のスピードに、シーザリオ牝系の切れ味と中距離性能を重ねる構成です。"),
  profile("epiphaneia", ["エピファネイア", "Epiphaneia"], ["シンボリクリスエス", "シーザリオ"], ["パワー", "持続力", "中距離性能"], "Roberto系のパワーと持続力に、シーザリオ牝系の中距離性能と機動力を重ねる構成です。"),
  profile("bricks_and_mortar", ["ブリックスアンドモルタル", "Bricks and Mortar"], ["Giant's Causeway", "Beyond the Waves"], ["パワー", "持続力", "芝適性"], "Giant's Causewayを経るStorm Cat系のパワーと持続力を軸に、芝で長く脚を使う性質を伝える構成です。"),
  profile("orfevre", ["オルフェーヴル", "Orfevre"], ["ステイゴールド", "オリエンタルアート"], ["スタミナ", "持続力", "道悪対応"], "Stay Gold系のスタミナと持続力に、母系のパワーを重ねる中長距離型の構成です。"),
  profile("silver_state", ["シルバーステート", "Silver State"], ["ディープインパクト", "シルヴァースカヤ"], ["スピード", "切れ味", "マイル適性"], "Deep Impact由来のスピードと切れ味を中心に、芝のマイルから中距離へつながる構成です。"),
  profile("drefong", ["ドレフォン", "Drefong"], ["Gio Ponti", "Eltimaas"], ["スピード", "パワー", "ダート適性"], "Storm Cat系の先行スピードとパワーを軸に、短距離からマイルのダート適性を伝える構成です。"),
  profile("mikki_isle", ["ミッキーアイル", "Mikki Isle"], ["ディープインパクト", "スターアイル"], ["先行力", "スピード", "短距離適性"], "Deep Impact系のスピードに、母系の前向きさを重ねた短距離・マイル型の構成です。"),
  profile("lord_kanaloa", ["ロードカナロア", "Lord Kanaloa"], ["キングカメハメハ", "レディブラッサム"], ["スピード", "持続力", "短距離適性"], "King Kamehameha系の機動力とパワーに、母系の速度持続力を重ねた短距離・マイル型です。"),
  profile("kizuna", ["キズナ", "Kizuna"], ["ディープインパクト", "キャットクイル"], ["切れ味", "持続力", "中距離性能"], "Deep Impact由来の切れ味に、Storm Catを持つ母系のパワーと持続力を補う構成です。"),
  profile("satono_aladdin", ["サトノアラジン", "Satono Aladdin"], ["ディープインパクト", "マジックストーム"], ["スピード", "切れ味", "マイル適性"], "Deep Impactのトップスピードに、Storm Cat系のパワーを重ねた芝マイル寄りの構成です。"),
  profile("tower_of_london", ["タワーオブロンドン", "Tower of London"], ["Raven's Pass", "スノーパイン"], ["スピード", "パワー", "短距離適性"], "Raven's Pass由来のスピードに、母系の欧州型持続力を重ねた短距離・マイル型の構成です。"),
  profile("big_arthur", ["ビッグアーサー", "Big Arthur"], ["サクラバクシンオー", "シヤボナ"], ["先行力", "スピード", "短距離適性"], "Sakura Bakushin O系の純粋な短距離スピードに、母系のパワーを補うスプリント型です。"),
  profile("henny_hughes", ["ヘニーヒューズ", "Henny Hughes"], ["Hennessy", "Meadow Flyer"], ["先行力", "スピード", "ダート適性"], "Hennessyを経るStorm Cat系の先行スピードとパワーを強く伝えるダート短距離型です。"),
  profile("maurice", ["モーリス", "Maurice"], ["スクリーンヒーロー", "メジロフランシス"], ["パワー", "持続力", "マイル適性"], "Roberto系のパワーと持続力に、メジロ牝系のスタミナを重ねるマイル・中距離型です。"),
  profile("real_steel", ["リアルスティール", "Real Steel"], ["ディープインパクト", "ラヴズオンリーミー"], ["切れ味", "持続力", "中距離性能"], "Deep Impactの切れ味に、Storm Catを持つ母系のパワーと持続力を重ねる構成です。"),
  profile("rey_de_oro", ["レイデオロ", "Rey de Oro"], ["キングカメハメハ", "ラドラーダ"], ["機動力", "持続力", "中距離性能"], "King Kamehameha系の機動力とパワーに、牝系の中距離性能を重ねる構成です。"),
  profile("frankel", ["Frankel", "フランケル"], ["Galileo", "Kind"], ["スピード", "持続力", "欧州適性"], "Galileo系の持続力とスタミナに、Danehillを持つ母系のスピードを重ねる欧州型です。"),
  profile("curren_black_hill", ["カレンブラックヒル", "Curren Black Hill"], ["ダイワメジャー", "チャールストンハーバー"], ["先行力", "パワー", "マイル適性"], "Daiwa Major系の先行スピードとパワーを受け継ぐ短距離・マイル型です。"),
  profile("gold_ship", ["ゴールドシップ", "Gold Ship"], ["ステイゴールド", "ポイントフラッグ"], ["スタミナ", "持続力", "道悪対応"], "Stay Gold系のスタミナと持続力に、母系の底力を重ねる中長距離型です。"),
  profile("copano_rickey", ["コパノリッキー", "Copano Rickey"], ["ゴールドアリュール", "コパノニキータ"], ["先行力", "パワー", "ダート適性"], "Gold Allure系のダート適性と先行力に、母系の北米型パワーを重ねる構成です。"),
  profile("screen_hero", ["スクリーンヒーロー", "Screen Hero"], ["グラスワンダー", "ランニングヒロイン"], ["パワー", "持続力", "中距離性能"], "Grass Wonderを経るRoberto系のパワーと持続力を中心とする中距離型です。"),
  profile("suave_richard", ["スワーヴリチャード", "Suave Richard"], ["ハーツクライ", "ピラミマ"], ["持続力", "パワー", "中距離性能"], "Heart's Cry系の持続力に、Unbridled's Songを持つ母系のスピードとパワーを重ねます。"),
  profile("daiwa_major", ["ダイワメジャー", "Daiwa Major"], ["サンデーサイレンス", "スカーレットブーケ"], ["先行力", "パワー", "マイル適性"], "Sunday Silenceのスピードに、スカーレット牝系のパワーと持続力を重ねるマイル型です。"),
  profile("duramente", ["ドゥラメンテ", "Duramente"], ["キングカメハメハ", "アドマイヤグルーヴ"], ["スピード", "パワー", "中距離性能"], "King Kamehameha系のスピードとパワーに、Admire Groove牝系の持続力を重ねる構成です。"),
  profile("mind_your_biscuits", ["マインドユアビスケッツ", "Mind Your Biscuits"], ["Posse", "Jazzmane"], ["スピード", "パワー", "ダート適性"], "Deputy Minister系へつながる父系のスピードとパワーを軸にしたダート短距離・マイル型です。"),
  profile("leontes", ["リオンディーズ", "Leontes"], ["キングカメハメハ", "シーザリオ"], ["機動力", "パワー", "中距離性能"], "King Kamehameha系の機動力とパワーに、シーザリオ牝系の中距離性能を重ねます。"),
  profile("le_vent_se_leve", ["ルヴァンスレーヴ", "Le Vent Se Leve"], ["シンボリクリスエス", "マエストラーレ"], ["パワー", "持続力", "ダート適性"], "Symboli Kris Sを経るRoberto系のパワーと持続力を軸にしたダート中距離型です。"),

  profile("deep_impact", ["ディープインパクト", "Deep Impact"], ["サンデーサイレンス", "ウインドインハーヘア"], ["切れ味", "トップスピード", "中距離性能"], "Sunday Silenceの瞬発力に、母系の欧州型スタミナを重ねる芝中距離型です。"),
  profile("king_kamehameha", ["キングカメハメハ", "King Kamehameha"], ["Kingmambo", "マンファス"], ["機動力", "パワー", "持続力"], "Kingmambo系のスピードとパワーに、母系の持続力を重ねる万能型です。"),
  profile("kurofune", ["クロフネ", "Kurofune"], ["French Deputy", "Blue Avenue"], ["スピード", "パワー", "ダート適性"], "Deputy Minister系のパワーと先行スピードを中心に、芝・ダート双方へ対応する構成です。"),
  profile("gold_allure", ["ゴールドアリュール", "Gold Allure"], ["サンデーサイレンス", "ニキーヤ"], ["先行力", "パワー", "ダート適性"], "Sunday Silenceのスピードに、Nureyevを持つ母系のパワーを重ねたダート型です。"),
  profile("hearts_cry", ["ハーツクライ", "Heart's Cry", "Hearts Cry"], ["サンデーサイレンス", "アイリッシュダンス"], ["持続力", "スタミナ", "中距離性能"], "Sunday Silenceの瞬発力に、母系のスタミナと長く脚を使う持続力を重ねます。"),
  profile("harbinger", ["ハービンジャー", "Harbinger"], ["Dansili", "Penang Pearl"], ["パワー", "持続力", "洋芝適性"], "Danehill系のスピードに、欧州型のパワーと持続力を重ねる芝中距離型です。"),
  profile("symboli_kris_s", ["シンボリクリスエス", "Symboli Kris S"], ["Kris S.", "Tee Kay"], ["パワー", "持続力", "中距離性能"], "Roberto系のパワーと持続力を強く伝える中距離型です。"),
  profile("manhattan_cafe", ["マンハッタンカフェ", "Manhattan Cafe"], ["サンデーサイレンス", "サトルチェンジ"], ["スタミナ", "持続力", "長距離適性"], "Sunday Silenceの瞬発力に、母系のスタミナを重ねる中長距離型です。"),
  profile("majestic_warrior", ["Majestic Warrior", "マジェスティックウォリアー"], ["A.P. Indy", "Dream Supreme"], ["パワー", "先行力", "ダート適性"], "A.P. Indy系のパワーと持続力を中心とするダート型です。"),
  profile("tapit", ["Tapit", "タピット"], ["Pulpit", "Tap Your Heels"], ["スピード", "パワー", "ダート適性"], "A.P. Indy系の持続力に、Unbridled系を持つ母系のスピードとパワーを重ねます。"),
  profile("admire_moon", ["アドマイヤムーン", "Admire Moon"], ["エンドスウィープ", "マイケイティーズ"], ["スピード", "機動力", "短距離適性"], "End Sweep系のスピードと機動力を中心とする短距離・マイル型です。"),
  profile("south_vigorous", ["サウスヴィグラス", "South Vigorous"], ["エンドスウィープ", "ダーケストスター"], ["先行力", "パワー", "ダート適性"], "End Sweep系の先行スピードとパワーを強く伝えるダート短距離型です。"),
  profile("sunday_silence", ["サンデーサイレンス", "Sunday Silence"], ["Halo", "Wishing Well"], ["切れ味", "持続力", "芝適性"], "Halo系の瞬発力と勝負根性を日本の芝へ広く伝えた基幹血統です。"),
  profile("stay_gold", ["ステイゴールド", "Stay Gold"], ["サンデーサイレンス", "ゴールデンサッシュ"], ["スタミナ", "持続力", "道悪対応"], "Sunday Silence系の中でもスタミナと持続力、タフな条件への対応力を伝えます。"),
  profile("special_week", ["スペシャルウィーク", "Special Week"], ["サンデーサイレンス", "キャンペンガール"], ["スタミナ", "持続力", "中距離性能"], "Sunday Silenceの瞬発力に、母系のスタミナと持続力を重ねる中長距離型です。"),
  profile("neo_universe", ["ネオユニヴァース", "Neo Universe"], ["サンデーサイレンス", "ポインテッドパス"], ["パワー", "持続力", "中距離性能"], "Sunday Silence系の中でもパワーと持続力を備える中距離型です。"),
  profile("french_deputy", ["フレンチデピュティ", "French Deputy"], ["Deputy Minister", "Mitterand"], ["パワー", "先行力", "ダート適性"], "Deputy Minister系のパワーと先行力を伝える芝・ダート兼用型です。"),
  profile("real_impact", ["リアルインパクト", "Real Impact"], ["ディープインパクト", "トキオリアリティー"], ["スピード", "持続力", "マイル適性"], "Deep Impactのトップスピードに、母系の短距離スピードを重ねるマイル型です。"),
];

const sourcedProfile = (id, names, ancestry, traits, summary, sourceRefs) =>
  profile(id, names, ancestry, traits, summary, { sourceRefs });

const displayProfile = (id, names, ancestry, traits, summary, sourceRefs) => ({
  ...profile(id, names, ancestry, traits, summary, { sourceRefs }),
  scoreApplied: false,
});

// Display-only profiles deepen the explanation without changing Blood or TM INDEX.
// Promote them to SIRE_PROFILES only after the existing score acceptance checks pass.
const DISPLAY_ONLY_SIRE_PROFILES = [
  ...PEDIGREE_PUBLIC_PROFILE_DEFINITIONS.map((definition) => displayProfile(
    definition.id,
    definition.names,
    definition.ancestry,
    definition.traits,
    definition.summary,
    definition.sourceRefs,
  )),
];

const FOREIGN_SIRE_PROFILE_CANDIDATES = [
  sourcedProfile(
    "siskin",
    ["シスキン", "Siskin"],
    ["First Defence", "Bird Flown"],
    ["スピード", "切れ味", "マイル適性", "芝適性"],
    "First DefenceのスピードにOasis Dreamを持つ母系を重ね、芝の短距離からマイルで切れ味を発揮した構成です。",
    ["https://shadai-ss.com/stallion/siskin/", "https://www.racingpost.com/bloodstock/news/irish-2000-guineas-hero-siskin-to-stand-at-shadai-stallion-station-amdcb9m5wCtW/"]
  ),
  sourcedProfile(
    "nashville",
    ["Nashville", "ナッシュビル"],
    ["Speightstown", "Veronique"],
    ["トップスピード", "先行力", "短距離適性", "ダート適性"],
    "Speightstown系の先行スピードを受け継ぎ、ダート6ハロンで高い速度性能を示した短距離型です。",
    ["https://cdn.bloodhorse.com/stallion-register/pdfs/nashville.pdf"]
  ),
  sourcedProfile(
    "mitole",
    ["Mitole", "ミトーリ"],
    ["Eskendereya", "Indian Miss"],
    ["トップスピード", "パワー", "短距離適性", "ダート適性"],
    "EskendereyaにIndian Charlieを持つ母系を重ねた、北米ダートの短距離速度とパワーを強く示す構成です。",
    ["https://www.spendthriftfarm.com/stallions/mitole/", "https://cdn.bloodhorse.com/stallion-register/pdfs/mitole.pdf"]
  ),
  sourcedProfile(
    "jack_christopher",
    ["Jack Christopher", "ジャッククリストファー"],
    ["Munnings", "Rushin No Blushin"],
    ["トップスピード", "パワー", "マイル適性", "ダート適性"],
    "Munnings由来の速度とパワーを軸に、北米ダート6ハロンから1マイルでG1級の性能を示した構成です。",
    ["https://coolmore.com/en/america/stallion/jack-christopher/"]
  ),
  sourcedProfile(
    "war_pass",
    ["War Pass", "ウォーパス"],
    ["Cherokee Run", "Vue"],
    ["先行力", "スピード", "マイル適性", "ダート適性"],
    "Cherokee Runの先行力にMr. Prospectorを持つ母系を重ねた、北米ダートの2歳・マイル型です。",
    ["https://www.ctba.com/wp-content/uploads/2013/stallion-directory/KAFWAIN.pdf"]
  ),
  sourcedProfile(
    "mineshaft",
    ["Mineshaft", "マインシャフト"],
    ["A.P. Indy", "Prospectors Delite"],
    ["パワー", "持続力", "中距離性能", "ダート適性"],
    "A.P. Indyの持続力とスタミナにMr. Prospectorを持つ母系の速度を重ねた北米ダート中距離型です。",
    ["https://lanesend.com/mineshaft", "https://cdn.bloodhorse.com/stallion-register/pdfs/mineshaft.pdf"]
  ),
  sourcedProfile(
    "practical_joke",
    ["Practical Joke", "プラクティカルジョーク"],
    ["Into Mischief", "Halo Humor"],
    ["スピード", "パワー", "マイル適性", "ダート適性"],
    "Into Mischiefのスピードとパワーを軸に、北米ダート7ハロンから1マイルでG1実績を残した構成です。",
    ["https://cdn.bloodhorse.com/stallion-register/pdfs/practicaljoke.pdf"]
  ),
];

const SIRE_PROFILES = [...BASE_SIRE_PROFILES, ...FOREIGN_SIRE_PROFILE_CANDIDATES];

const PEDIGREE_DISPLAY_PROFILES = [...SIRE_PROFILES, ...DISPLAY_ONLY_SIRE_PROFILES];

const findSireProfileIn = (name, profiles = SIRE_PROFILES) => {
  const normalized = normalizeSireName(name);
  return profiles.find((profile) =>
    profile.names.some((candidate) => normalizeSireName(candidate) === normalized)
  ) ?? null;
};

const findSireProfile = (name) => findSireProfileIn(name, SIRE_PROFILES);
const findPedigreeDisplayProfile = (name) => findSireProfileIn(name, PEDIGREE_DISPLAY_PROFILES);

export {
  BASE_SIRE_PROFILES,
  DISPLAY_ONLY_SIRE_PROFILES,
  FOREIGN_SIRE_PROFILE_CANDIDATES,
  PEDIGREE_DISPLAY_PROFILES,
  PROFILE_TRAIT_VECTORS,
  SIRE_PROFILES,
  buildProfileTraitVector,
  findPedigreeDisplayProfile,
  findSireProfile,
  findSireProfileIn,
  normalizeSireName,
};
